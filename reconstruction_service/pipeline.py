"""Photo reconstruction pipeline: COLMAP structure-from-motion + Gaussian splatting.

The pipeline is intentionally self-contained and synchronous. The FastAPI layer
runs it on a single background worker so uploads and job polling stay responsive.

Stages:
  1. Normalise uploaded photos (EXIF rotation, sRGB JPEG, max 1600 px).
  2. Recover camera poses and a sparse point cloud with pycolmap (CPU).
  3. Export a COLMAP dataset for Brush.
  4. Train Gaussian splats with Brush and export a .ply scene.
  5. Return asset names plus real reconstruction statistics.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence

import numpy as np
from PIL import Image, ImageOps

try:  # Keep the service importable so /health can report a missing dependency.
    import pycolmap  # type: ignore
except Exception as exc:  # pragma: no cover - depends on local environment
    pycolmap = None  # type: ignore[assignment]
    PYCOLMAP_IMPORT_ERROR = str(exc)
else:
    PYCOLMAP_IMPORT_ERROR = ""

Image.MAX_IMAGE_PIXELS = 160_000_000

PIPELINE_VERSION = "0.1.0"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ProgressCallback = Callable[[str, int, str], None]


class ReconstructionError(RuntimeError):
    """A reconstruction failed for a reason the user can act on."""


class BrushUnavailable(ReconstructionError):
    """Brush is missing or could not finish; sparse SfM is still usable."""


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PipelineLogger:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._file = path.open("a", encoding="utf-8", buffering=1)

    def __call__(self, message: str) -> None:
        line = f"[{_utc_now()}] {message}\n"
        self._file.write(line)
        self._file.flush()
        try:
            print(line, end="", flush=True)
        except Exception:
            pass

    def close(self) -> None:
        try:
            self._file.close()
        except Exception:
            pass


def find_brush(root: Path | str | None = None) -> Path | None:
    """Locate the Brush Gaussian-splatting executable."""
    root_path = Path(root) if root else PROJECT_ROOT
    candidates: list[Path] = []

    configured = os.getenv("BRUSH_BINARY", "").strip()
    if configured:
        configured_path = Path(os.path.expanduser(configured))
        candidates.append(
            configured_path if configured_path.is_absolute() else root_path / configured_path
        )

    candidates.extend(
        [
            root_path / ".tools" / "brush" / "brush_app.exe",
            root_path / ".tools" / "brush" / "brush_app",
            root_path / "brush_app.exe",
            root_path / "brush_app",
        ]
    )
    for name in ("brush_app", "brush", "brush-app"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))

    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def _prepare_images(images: Sequence[Path], destination: Path, logger: PipelineLogger) -> list[Path]:
    if len(images) < 3:
        raise ReconstructionError(
            "At least 3 overlapping photos are required for photogrammetry. "
            "Upload 8–30 photos taken around the room for a usable scan."
        )

    destination.mkdir(parents=True, exist_ok=True)
    max_dimension = _int_env("DART_MAX_IMAGE_SIZE", 1600, 640, 3200)
    prepared: list[Path] = []

    for index, source in enumerate(images):
        try:
            with Image.open(source) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
                if max(image.size) > max_dimension:
                    image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
                output = destination / f"frame_{index:03d}.jpg"
                image.save(output, "JPEG", quality=92, optimize=True)
                prepared.append(output)
                logger(
                    f"Prepared {source.name} -> {output.name} "
                    f"({image.width}x{image.height})"
                )
        except Exception as exc:
            raise ReconstructionError(
                f"Could not read photo '{source.name}'. Use JPEG, PNG or WebP images."
            ) from exc

    return prepared


def _load_colmap() -> Any:
    if pycolmap is None:
        detail = f" ({PYCOLMAP_IMPORT_ERROR})" if PYCOLMAP_IMPORT_ERROR else ""
        raise ReconstructionError(
            "COLMAP support is not installed. Run "
            "`pip install -r reconstruction_service/requirements.txt`" + detail
        )
    return pycolmap


def _sfm_device() -> Any:
    """Resolve the COLMAP compute device from the DART_SFM_DEVICE env var.

    Values: auto (prefer CUDA GPU, fall back to CPU), cuda (GPU required),
    cpu (CPU only). Defaults to auto so photogrammetry runs on the NVIDIA GPU
    when one is present (e.g. RTX 3050 with CUDA driver) and degrades
    gracefully to CPU otherwise.
    """
    colmap = _load_colmap()
    value = os.getenv("DART_SFM_DEVICE", "auto").strip().lower()
    if value == "cpu":
        return colmap.Device.cpu
    if value == "cuda":
        return colmap.Device.cuda
    return colmap.Device.auto  # auto


def read_ply_stats(path: Path) -> dict[str, Any]:
    """Read the vertex count and world-space bounds from a binary PLY file."""
    ply_types = {
        "char": "i1",
        "int8": "i1",
        "uchar": "u1",
        "uint8": "u1",
        "short": "<i2",
        "int16": "<i2",
        "ushort": "<u2",
        "uint16": "<u2",
        "int": "<i4",
        "int32": "<i4",
        "uint": "<u4",
        "uint32": "<u4",
        "float": "<f4",
        "float32": "<f4",
        "double": "<f8",
        "float64": "<f8",
    }

    with path.open("rb") as handle:
        header = bytearray()
        while True:
            line = handle.readline()
            if not line:
                raise ReconstructionError(f"Invalid PLY file: {path.name}")
            header.extend(line)
            if line.strip() == b"end_header":
                break
            if len(header) > 2_000_000:
                raise ReconstructionError(f"PLY header is too large: {path.name}")

        text = header.decode("ascii", errors="replace")
        vertex_match = re.search(r"element\s+vertex\s+(\d+)", text)
        if not vertex_match:
            raise ReconstructionError(f"PLY file has no vertex element: {path.name}")
        vertex_count = int(vertex_match.group(1))
        if vertex_count <= 0:
            raise ReconstructionError(f"PLY file has no points: {path.name}")

        fields: list[tuple[str, str]] = []
        for line in text.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[0] == "property" and parts[1] in ply_types:
                fields.append((parts[2], ply_types[parts[1]]))

        if not {"x", "y", "z"}.issubset({name for name, _ in fields}):
            raise ReconstructionError(f"PLY file has no XYZ coordinates: {path.name}")

        dtype = np.dtype(fields)
        payload = handle.read(vertex_count * dtype.itemsize)

    if len(payload) < vertex_count * dtype.itemsize:
        raise ReconstructionError(f"PLY file is truncated: {path.name}")

    vertices = np.frombuffer(payload, dtype=dtype, count=vertex_count)
    xyz = np.column_stack(
        [vertices["x"], vertices["y"], vertices["z"]]
    ).astype(np.float64, copy=False)
    xyz = xyz[np.isfinite(xyz).all(axis=1)]
    if xyz.shape[0] == 0:
        raise ReconstructionError(f"PLY file has no finite points: {path.name}")

    minimum = xyz.min(axis=0)
    maximum = xyz.max(axis=0)

    # Gaussian-splat exports commonly contain a handful of far outlier
    # gaussians. Using the absolute bounding box would park the camera 60 m
    # away from a 5 m room, so frame the robust 98% core of the cloud instead.
    low = np.percentile(xyz, 1.0, axis=0)
    high = np.percentile(xyz, 99.0, axis=0)
    center = (low + high) / 2.0
    distances = np.linalg.norm(xyz - center, axis=1)
    radius = float(np.percentile(distances, 99.0))
    if not np.isfinite(radius) or radius <= 0:
        radius = float(np.linalg.norm(maximum - minimum) / 2.0)
    if not np.isfinite(radius) or radius <= 0:
        radius = 1.0

    return {
        "count": int(xyz.shape[0]),
        "center": [round(float(value), 6) for value in center],
        "radius": round(radius, 6),
        "boundsMin": [round(float(value), 6) for value in minimum],
        "boundsMax": [round(float(value), 6) for value in maximum],
    }


def clean_splat_ply(
    path: Path,
    logger: PipelineLogger | None = None,
    scale_factor: float = 4.0,
) -> dict[str, Any]:
    """Drop oversized outlier Gaussians from a Brush export.

    Brush occasionally leaves a small number of very large Gaussians around the
    edges of a scan. They are visually dominant in a browser viewer (long
    streaks and haze) and are usually unsupported floaters rather than real
    surfaces. Splat scale is relative to the arbitrary COLMAP reconstruction
    scale, so the cutoff is derived from the median splat size instead of a
    fixed metre value.
    """
    result: dict[str, Any] = {
        "removed": 0,
        "kept": 0,
        "scaleLimit": None,
    }
    try:
        raw = path.read_bytes()
    except OSError:
        return result

    match = re.search(rb"end_header\r?\n", raw)
    if not match:
        return result
    header_bytes = raw[: match.end()]
    header = header_bytes.decode("ascii", errors="replace")
    vertex_match = re.search(r"element\s+vertex\s+(\d+)", header)
    if not vertex_match:
        return result
    if re.search(r"element\s+(?!vertex\b)\w+\s+\d+", header):
        # Additional elements (e.g. faces) make rewriting riskier. Brush's
        # splat exports are vertex-only, so leave anything else untouched.
        return result

    vertex_count = int(vertex_match.group(1))
    fields: list[tuple[str, str]] = []
    ply_types = {
        "float": "<f4",
        "float32": "<f4",
        "double": "<f8",
        "float64": "<f8",
        "uchar": "u1",
        "uint8": "u1",
        "char": "i1",
        "int8": "i1",
        "ushort": "<u2",
        "uint16": "<u2",
        "short": "<i2",
        "int16": "<i2",
        "uint": "<u4",
        "uint32": "<u4",
        "int": "<i4",
        "int32": "<i4",
    }
    for line in header.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[0] == "property" and parts[1] in ply_types:
            fields.append((parts[2], ply_types[parts[1]]))

    names = {name for name, _ in fields}
    if not {"scale_0", "scale_1", "scale_2"}.issubset(names):
        return result

    dtype = np.dtype(fields)
    payload = raw[match.end() :]
    if len(payload) < vertex_count * dtype.itemsize:
        return result
    vertices = np.frombuffer(
        payload, dtype=dtype, count=vertex_count
    )
    scales = np.exp(
        np.column_stack(
            [vertices["scale_0"], vertices["scale_1"], vertices["scale_2"]]
        ).astype(np.float64, copy=False)
    )
    max_scale = scales.max(axis=1)
    finite = np.isfinite(max_scale) & (max_scale > 0)
    if not finite.any():
        return result

    median_scale = float(np.median(max_scale[finite]))
    if not np.isfinite(median_scale) or median_scale <= 0:
        return result
    limit = median_scale * max(1.5, scale_factor)
    keep = finite & (max_scale <= limit)
    kept = int(keep.sum())
    if kept < max(200, int(vertex_count * 0.3)) or kept == vertex_count:
        return result

    new_header = re.sub(
        rb"(element\s+vertex\s+)\d+",
        rb"\g<1>" + str(kept).encode("ascii"),
        header_bytes,
        count=1,
    )
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(new_header + vertices[keep].tobytes())
    os.replace(temporary, path)
    result.update(removed=vertex_count - kept, kept=kept, scaleLimit=round(limit, 6))
    if logger:
        logger(
            f"Removed {result['removed']:,} oversized Gaussians "
            f"(kept {kept:,}; max scale {limit:.3f})"
        )
    return result


def _image_world_up(image: Any) -> np.ndarray | None:
    """Estimate world-space gravity up from one registered camera pose.

    COLMAP's camera +Y axis points down the image. An upright photo therefore
    maps world up to -R * (0, 1, 0), where R is the world-to-camera rotation.
    Averaging this across the photo set recovers a stable up vector even though
    COLMAP's world frame itself has no gravity alignment.
    """
    try:
        pose = image.cam_from_world
        pose = pose() if callable(pose) else pose
        rotation = pose.rotation
        matrix = rotation.matrix() if callable(rotation.matrix) else rotation.matrix
        matrix = np.asarray(matrix, dtype=np.float64)
    except Exception:  # noqa: BLE001 - a single bad pose should not fail SfM
        return None
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        return None
    up = -matrix.T @ np.array([0.0, 1.0, 0.0], dtype=np.float64)
    norm = float(np.linalg.norm(up))
    if norm <= 1e-8:
        return None
    return up / norm


def _representative_camera(reconstruction: Any) -> dict[str, Any] | None:
    """Pick a real photo pose for the viewer's initial camera.

    Starting outside the reconstructed bounds gives a poor photoreal view. A
    registered camera points into the captured surfaces at eye height, so it is
    a much better default while still allowing free orbit afterwards.
    """
    best: tuple[int, np.ndarray, np.ndarray, str] | None = None
    up_vectors: list[np.ndarray] = []
    for image in reconstruction.images.values():
        try:
            position = np.asarray(image.projection_center(), dtype=np.float64)
            direction = np.asarray(image.viewing_direction(), dtype=np.float64)
        except Exception:  # noqa: BLE001 - a single bad pose should not fail SfM
            continue
        up_vector = _image_world_up(image)
        if up_vector is not None:
            up_vectors.append(up_vector)
        if (
            position.shape != (3,)
            or direction.shape != (3,)
            or not np.isfinite(position).all()
            or not np.isfinite(direction).all()
        ):
            continue
        norm = float(np.linalg.norm(direction))
        if norm <= 1e-8:
            continue
        try:
            observed_value = getattr(image, "num_points3D", 0)
            observed = int(
                observed_value() if callable(observed_value) else observed_value
            )
        except Exception:  # noqa: BLE001
            observed = 0
        candidate = (observed, position, direction / norm, str(image.name))
        if best is None or candidate[0] > best[0]:
            best = candidate

    if best is None:
        return None
    _, position, direction, name = best

    # Use the camera constellation's average up vector. If the photos disagree
    # (mixed portrait/landscape rotations), fall back to the viewer's standard
    # y-up convention rather than applying an arbitrary roll.
    world_up = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    if up_vectors:
        mean_up = np.mean(np.stack(up_vectors, axis=0), axis=0)
        norm = float(np.linalg.norm(mean_up))
        if np.isfinite(norm) and norm > 0.5:
            world_up = mean_up / norm

    return {
        "position": [round(float(value), 6) for value in position],
        "direction": [round(float(value), 6) for value in direction],
        "up": [round(float(value), 6) for value in world_up],
        "image": name,
    }


def _brush_command(
    brush: Path,
    dataset_dir: Path,
    output_dir: Path,
) -> list[str]:
    steps = _int_env("DART_SPLAT_STEPS", 8000, 100, 30000)
    resolution = _int_env("DART_SPLAT_RESOLUTION", 720, 320, 1920)
    max_splats = _int_env("DART_SPLAT_MAX", 250000, 10000, 2000000)
    export_every = max(500, steps // 2)

    return [
        str(brush),
        str(dataset_dir),
        "--total-steps",
        str(steps),
        "--max-resolution",
        str(resolution),
        "--max-splats",
        str(max_splats),
        "--export-every",
        str(export_every),
        "--export-path",
        str(output_dir),
        "--export-name",
        "scene.ply",
    ]


def _run_brush(
    brush: Path,
    dataset_dir: Path,
    output_dir: Path,
    work_dir: Path,
    logger: PipelineLogger,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "scene.ply"
    if output_path.exists():
        output_path.unlink()

    command = _brush_command(brush, dataset_dir, output_dir)
    logger("Running Brush: " + subprocess.list2cmdline(command))
    timeout = _int_env("DART_SPLAT_TIMEOUT", 1800, 120, 14400)

    try:
        with (work_dir / "brush.log").open("a", encoding="utf-8", buffering=1) as log:
            completed = subprocess.run(
                command,
                cwd=str(work_dir),
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=timeout,
                check=False,
            )
    except subprocess.TimeoutExpired as exc:
        raise BrushUnavailable(
            f"Gaussian splatting exceeded the {timeout}s limit. "
            "The sparse COLMAP point cloud is still available."
        ) from exc
    except OSError as exc:
        raise BrushUnavailable(f"Could not start Brush: {exc}") from exc

    if completed.returncode != 0:
        raise BrushUnavailable(
            f"Brush exited with code {completed.returncode}. "
            "The sparse COLMAP point cloud is still available."
        )
    if not output_path.is_file() or output_path.stat().st_size < 10_000:
        raise BrushUnavailable(
            "Brush finished without producing a usable splat file. "
            "The sparse COLMAP point cloud is still available."
        )

    return output_path


def reconstruct(
    images: Sequence[Path],
    work_dir: Path,
    assets_dir: Path,
    log_path: Path,
    progress: ProgressCallback,
) -> dict[str, Any]:
    """Run COLMAP SfM followed by Brush Gaussian splatting."""
    started = time.time()
    logger = PipelineLogger(log_path)
    work_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    image_list = [Path(path) for path in images if Path(path).is_file()]

    try:
        logger(f"Reconstruction started with {len(image_list)} uploaded photos")
        progress("prepare", 3, "Reading and normalising photos")
        prepared = _prepare_images(image_list, work_dir / "images", logger)
        camera_count = len(prepared)

        colmap = _load_colmap()
        device = _sfm_device()
        logger(f"pycolmap {getattr(colmap, '__version__', 'unknown')} (device={device})")

        threads = _int_env("DART_SFM_THREADS", min(8, os.cpu_count() or 4), 1, 64)
        database_path = work_dir / "database.db"
        sparse_dir = work_dir / "sparse"
        sparse_dir.mkdir(parents=True, exist_ok=True)

        progress("features", 8, f"Extracting features from {camera_count} photos")
        extraction = colmap.FeatureExtractionOptions()
        extraction.use_gpu = device != colmap.Device.cpu
        extraction.num_threads = threads
        extraction.max_image_size = _int_env("DART_MAX_IMAGE_SIZE", 1600, 640, 3200)
        extraction.sift.max_num_features = _int_env("DART_MAX_FEATURES", 8192, 1024, 32768)

        colmap.extract_features(
            database_path,
            work_dir / "images",
            camera_mode=colmap.CameraMode.SINGLE,
            reader_options=colmap.ImageReaderOptions(camera_model="SIMPLE_RADIAL"),
            extraction_options=extraction,
            device=device,
        )
        progress("features", 26, f"Features extracted from {camera_count} photos")

        progress("matching", 30, "Matching overlapping photos")
        matching = colmap.FeatureMatchingOptions()
        matching.use_gpu = device != colmap.Device.cpu
        matching.num_threads = threads
        matching.max_num_matches = _int_env("DART_MAX_MATCHES", 32768, 4096, 65536)
        colmap.match_exhaustive(
            database_path,
            matching_options=matching,
            device=device,
        )
        progress("matching", 52, "Photo overlap verified")

        progress("mapping", 56, "Recovering camera poses and sparse geometry")
        options = colmap.IncrementalPipelineOptions()
        options.multiple_models = False
        options.min_model_size = 3
        options.ba_use_gpu = device != colmap.Device.cpu
        options.num_threads = threads
        options.extract_colors = True
        options.mapper.init_min_num_inliers = _int_env("DART_INIT_MIN_INLIERS", 30, 12, 500)
        options.mapper.abs_pose_min_num_inliers = _int_env(
            "DART_POSE_MIN_INLIERS", 12, 6, 200
        )
        options.mapper.init_min_tri_angle = _float_env("DART_INIT_MIN_TRIANGLE", 4.0, 1.0, 30.0)

        reconstructions = colmap.incremental_mapping(
            database_path,
            work_dir / "images",
            sparse_dir,
            options=options,
        )
        if not reconstructions:
            raise ReconstructionError(
                "COLMAP could not align these photos. Capture overlapping views of "
                "the same room (about 70% overlap) with good lighting and try again."
            )

        reconstruction = max(
            reconstructions.values(), key=lambda item: item.num_reg_images()
        )
        registered = int(reconstruction.num_reg_images())
        points = int(reconstruction.num_points3D())
        minimum_registered = max(
            3,
            int(
                np.ceil(
                    camera_count
                    * _float_env("DART_MIN_REGISTRATION_RATE", 0.34, 0.25, 1.0)
                )
            ),
        )
        if registered < minimum_registered or points < 20:
            registration_rate = registered / max(camera_count, 1)
            raise ReconstructionError(
                f"Only {registered}/{camera_count} photos were registered "
                f"({registration_rate:.0%}); at least {minimum_registered} are required. "
                "Capture overlapping views of the same surfaces, keep about 70% overlap, "
                "and avoid unrelated rooms or blurry frames."
            )

        try:
            mean_reprojection_error = float(reconstruction.compute_mean_reprojection_error())
        except Exception:
            mean_reprojection_error = 0.0

        representative_camera = _representative_camera(reconstruction)
        if representative_camera:
            logger(
                f"Viewer camera from {representative_camera['image']} "
                f"at {representative_camera['position']}"
            )

        logger(
            f"SfM recovered {registered}/{camera_count} cameras and {points} sparse points "
            f"(mean reprojection error {mean_reprojection_error:.3f}px)"
        )
        progress(
            "mapping",
            70,
            f"Recovered {registered}/{camera_count} cameras and {points:,} points",
        )

        progress("export", 73, "Exporting sparse point cloud")
        point_cloud_path = assets_dir / "point-cloud.ply"
        reconstruction.export_PLY(point_cloud_path)
        point_cloud_stats = read_ply_stats(point_cloud_path)

        dataset_dir = work_dir / "dataset"
        dataset_images = dataset_dir / "images"
        if dataset_images.exists():
            shutil.rmtree(dataset_images)
        shutil.copytree(work_dir / "images", dataset_images)
        sparse_output = dataset_dir / "sparse" / "0"
        sparse_output.mkdir(parents=True, exist_ok=True)
        reconstruction.write_binary(sparse_output)
        logger(f"Wrote Brush dataset to {dataset_dir}")

        splat_stats: dict[str, Any] | None = None
        splat_cleanup: dict[str, Any] = {"removed": 0, "kept": 0, "scaleLimit": None}
        splat_path = assets_dir / "scene.ply"
        brush_warning = ""
        brush = find_brush()
        if brush:
            progress("splatting", 78, "Training Gaussian splats with Brush")
            try:
                _run_brush(
                    brush,
                    dataset_dir,
                    assets_dir,
                    work_dir,
                    logger,
                )
                splat_cleanup = clean_splat_ply(splat_path, logger)
                splat_stats = read_ply_stats(splat_path)
                logger(
                    f"Brush produced {splat_stats['count']:,} Gaussian splats"
                )
                progress(
                    "splatting",
                    93,
                    f"Trained {splat_stats['count']:,} Gaussian splats",
                )
            except BrushUnavailable as exc:
                brush_warning = str(exc)
                logger(f"Gaussian splatting unavailable: {exc}")
                if splat_path.exists():
                    splat_path.unlink()
                progress(
                    "export",
                    90,
                    "Splat training unavailable — keeping the COLMAP point cloud",
                )
        else:
            brush_warning = (
                "Brush Gaussian splatting executable not found. Install Brush and place "
                "brush_app.exe in .tools/brush or set BRUSH_BINARY."
            )
            logger(brush_warning)
            progress(
                "export",
                90,
                "Gaussian splatting not installed — keeping the COLMAP point cloud",
            )

        scene_stats = splat_stats or point_cloud_stats
        viewer_camera = None
        if representative_camera:
            camera_position = np.asarray(
                representative_camera["position"], dtype=np.float64
            )
            camera_direction = np.asarray(
                representative_camera["direction"], dtype=np.float64
            )
            look_distance = max(1.2, float(scene_stats["radius"]) * 0.65)
            camera_look_at = camera_position + camera_direction * look_distance
            viewer_camera = {
                "position": [
                    round(float(value), 6) for value in camera_position
                ],
                "lookAt": [
                    round(float(value), 6) for value in camera_look_at
                ],
                "up": [
                    round(float(value), 6)
                    for value in representative_camera.get("up") or (0.0, 1.0, 0.0)
                ],
                "image": representative_camera["image"],
            }

        duration = round(time.time() - started, 1)
        stats: dict[str, Any] = {
            "engine": (
                "COLMAP SfM (CUDA GPU) + Brush Gaussian Splatting"
                if splat_stats
                else "COLMAP SfM (CUDA GPU, sparse point cloud)"
            ),
            "sfmEngine": f"pycolmap {getattr(colmap, '__version__', '')} (device={device})".strip(),
            "splatEngine": "Brush Gaussian Splatting" if splat_stats else None,
            "cameraModel": "SIMPLE_RADIAL",
            "inputImages": camera_count,
            "registeredImages": registered,
            "registrationRatePercent": round(registered / max(camera_count, 1) * 100, 1),
            "sparsePoints": points,
            "pointCloudCount": point_cloud_stats["count"],
            "splatCount": splat_stats["count"] if splat_stats else 0,
            "splatFilterRemoved": int(splat_cleanup.get("removed") or 0),
            "reprojectionErrorPx": round(mean_reprojection_error, 3),
            "durationSeconds": duration,
            "lastGeneratedAt": _utc_now(),
            "sceneCenter": scene_stats["center"],
            "sceneRadius": scene_stats["radius"],
            "splatCenter": splat_stats["center"] if splat_stats else None,
            "splatRadius": splat_stats["radius"] if splat_stats else None,
            "viewerCamera": viewer_camera,
            "brushWarning": brush_warning or None,
        }
        logger(
            f"Reconstruction finished in {duration}s "
            f"({stats['engine']})"
        )
        progress("finalizing", 98, "Writing reconstruction manifest")
        return stats
    except ReconstructionError:
        logger("Reconstruction failed: " + traceback.format_exc(limit=6))
        raise
    except Exception as exc:  # noqa: BLE001 - expose a useful job error
        logger("Unexpected reconstruction failure: " + traceback.format_exc())
        raise ReconstructionError(f"Reconstruction failed: {exc}") from exc
    finally:
        logger.close()
