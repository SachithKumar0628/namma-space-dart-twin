"""COLMAP engines: pycolmap for structure-from-motion and the COLMAP CLI for
dense multi-view stereo.

pycolmap wheels on Windows are CPU-only. The standalone COLMAP build *is*
CUDA-enabled, so dense stereo uses the CLI and reports the device truthfully.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Callable

import numpy as np

from ..config import SETTINGS
from ..errors import EngineUnavailable, PipelineCancelled, ReconstructionError, StageFailed

try:  # keep the module importable so /health can report the real state
    import pycolmap  # type: ignore
except Exception as exc:  # pragma: no cover - depends on local environment
    pycolmap = None  # type: ignore[assignment]
    PYCOLMAP_IMPORT_ERROR = str(exc)
else:
    PYCOLMAP_IMPORT_ERROR = ""

CancelCheck = Callable[[], bool]


@dataclass
class SfmResult:
    modelPath: str
    inputImages: int
    registeredImages: int
    sparsePoints: int
    reprojectionErrorPx: float
    modelsFound: int
    device: str
    engine: str
    matching: str
    warnings: list[str]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _require_pycolmap() -> Any:
    if pycolmap is None:
        raise EngineUnavailable(
            "COLMAP support is not installed in this Python environment. "
            "Run `pip install -r reconstruction_service/requirements.txt`."
            + (f" ({PYCOLMAP_IMPORT_ERROR})" if PYCOLMAP_IMPORT_ERROR else "")
        )
    return pycolmap


def _check_cancel(cancel: CancelCheck | None) -> None:
    if cancel is not None and cancel():
        raise PipelineCancelled("Reconstruction cancelled by the user.")


def _effective_device(colmap: Any) -> str:
    requested = SETTINGS.sfm_device
    has_cuda = bool(getattr(colmap, "has_cuda", False))
    if requested == "cpu":
        return "cpu"
    if requested == "cuda":
        if not has_cuda:
            raise EngineUnavailable(
                "DART_SFM_DEVICE=cuda was requested but this pycolmap build has no "
                "CUDA support (pip wheels on Windows are CPU-only). Use "
                "DART_SFM_DEVICE=auto or install a CUDA-enabled COLMAP."
            )
        return "cuda"
    return "cuda" if has_cuda else "cpu"


def _image_world_up(image: Any) -> np.ndarray | None:
    """Recover world-up from an upright camera's orientation."""
    try:
        pose = image.cam_from_world
        pose = pose() if callable(pose) else pose
        rotation = pose.rotation
        matrix = rotation.matrix() if callable(rotation.matrix) else rotation.matrix
        matrix = np.asarray(matrix, dtype=np.float64)
    except Exception:  # noqa: BLE001 - one bad pose must not fail the run
        return None
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        return None
    up = -matrix.T @ np.array([0.0, 1.0, 0.0], dtype=np.float64)
    norm = float(np.linalg.norm(up))
    return up / norm if norm > 1e-8 else None


def _representative_camera(reconstruction: Any) -> dict[str, Any] | None:
    """Choose the registered photo with the most observations as the viewer start."""
    best: tuple[int, np.ndarray, np.ndarray, str] | None = None
    up_vectors: list[np.ndarray] = []
    for image in reconstruction.images.values():
        try:
            position = np.asarray(image.projection_center(), dtype=np.float64)
            direction = np.asarray(image.viewing_direction(), dtype=np.float64)
        except Exception:  # noqa: BLE001
            continue
        up = _image_world_up(image)
        if up is not None:
            up_vectors.append(up)
        if position.shape != (3,) or direction.shape != (3,):
            continue
        if not np.isfinite(position).all() or not np.isfinite(direction).all():
            continue
        norm = float(np.linalg.norm(direction))
        if norm <= 1e-8:
            continue
        try:
            observed_value = getattr(image, "num_points3D", 0)
            observed = int(observed_value() if callable(observed_value) else observed_value)
        except Exception:  # noqa: BLE001
            observed = 0
        candidate = (observed, position, direction / norm, str(image.name))
        if best is None or candidate[0] > best[0]:
            best = candidate
    if best is None:
        return None

    _, position, direction, name = best
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


def export_camera_poses(reconstruction: Any, path: Path) -> dict[str, Any]:
    """Write the real registered camera poses as JSON for the viewer."""
    cameras: list[dict[str, Any]] = []
    for image in reconstruction.images.values():
        try:
            position = np.asarray(image.projection_center(), dtype=np.float64)
            direction = np.asarray(image.viewing_direction(), dtype=np.float64)
            pose = image.cam_from_world
            pose = pose() if callable(pose) else pose
            center = np.asarray(pose.translation, dtype=np.float64)
        except Exception:  # noqa: BLE001
            continue
        up = _image_world_up(image)
        cameras.append(
            {
                "name": str(image.name),
                "position": [round(float(v), 6) for v in position],
                "viewingDirection": [round(float(v), 6) for v in direction],
                "up": [round(float(v), 6) for v in (up if up is not None else (0.0, 1.0, 0.0))],
                "cameraCenter": [round(float(v), 6) for v in center],
                "numPoints3D": int(getattr(image, "num_points3D", 0) or 0),
            }
        )
    payload = {
        "cameraModel": str(getattr(reconstruction, "camera_model", "unknown")),
        "registeredImages": len(cameras),
        "cameras": cameras,
        "representative": _representative_camera(reconstruction),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def run_sfm(
    images_dir: Path,
    workspace: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: CancelCheck | None = None,
) -> SfmResult:
    """Run real SfM and export binary model, PLY and camera poses."""
    colmap = _require_pycolmap()
    _check_cancel(cancel)

    image_paths = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if len(image_paths) < SETTINGS.min_images:
        raise ReconstructionError(
            f"Only {len(image_paths)} usable image(s) remain; at least {SETTINGS.min_images} "
            "overlapping photos are required."
        )

    device = _effective_device(colmap)
    threads = SETTINGS.sfm_threads
    use_gpu = device == "cuda"
    database_path = workspace / "database.db"
    sparse_dir = workspace / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    logger(
        f"pycolmap {getattr(colmap, '__version__', 'unknown')} | device={device} | "
        f"images={len(image_paths)} | threads={threads}"
    )

    if progress:
        progress(8, f"Extracting SIFT features from {len(image_paths)} images")
    extraction = colmap.FeatureExtractionOptions()
    extraction.use_gpu = use_gpu
    extraction.num_threads = threads
    extraction.max_image_size = SETTINGS.max_image_size
    extraction.sift.max_num_features = SETTINGS.max_features
    try:
        colmap.extract_features(
            database_path,
            images_dir,
            camera_mode=colmap.CameraMode.AUTO,
            reader_options=colmap.ImageReaderOptions(camera_model="SIMPLE_RADIAL"),
            extraction_options=extraction,
            device=colmap.Device.cuda if use_gpu else colmap.Device.cpu,
        )
    except Exception as exc:  # noqa: BLE001
        raise StageFailed(f"SIFT feature extraction failed: {exc}") from exc
    _check_cancel(cancel)

    if progress:
        progress(26, "Matching features between overlapping images")
    matching_options = colmap.FeatureMatchingOptions()
    matching_options.use_gpu = use_gpu
    matching_options.num_threads = threads
    matching_options.max_num_matches = SETTINGS.max_matches
    exhaustive = len(image_paths) <= SETTINGS.exhaustive_match_limit
    try:
        if exhaustive:
            colmap.match_exhaustive(
                database_path,
                matching_options=matching_options,
                device=colmap.Device.cuda if use_gpu else colmap.Device.cpu,
            )
        else:
            colmap.match_sequential(
                database_path,
                matching_options=matching_options,
                device=colmap.Device.cuda if use_gpu else colmap.Device.cpu,
            )
    except Exception as exc:  # noqa: BLE001
        raise StageFailed(f"Feature matching failed: {exc}") from exc
    _check_cancel(cancel)

    if progress:
        progress(52, "Recovering camera poses and sparse geometry")
    options = colmap.IncrementalPipelineOptions()
    options.multiple_models = True
    options.min_model_size = 3
    options.ba_use_gpu = use_gpu
    options.num_threads = threads
    options.extract_colors = True
    options.triangulation.ignore_two_view_tracks = False
    options.triangulation.min_angle = 1.0
    options.mapper.init_min_num_inliers = 15
    options.mapper.abs_pose_min_num_inliers = 8
    options.mapper.init_min_tri_angle = 2.0
    try:
        reconstructions = colmap.incremental_mapping(
            database_path,
            images_dir,
            sparse_dir,
            options=options,
        )
    except Exception as exc:  # noqa: BLE001
        raise StageFailed(f"Incremental mapping failed: {exc}") from exc
    _check_cancel(cancel)

    if not reconstructions:
        raise ReconstructionError(
            "COLMAP could not align these images. Capture overlapping views of the "
            "same room (about 70% overlap) with good lighting and try again."
        )

    values = list(reconstructions.values()) if isinstance(reconstructions, dict) else list(reconstructions)
    reconstruction = max(values, key=lambda item: item.num_reg_images())
    registered = int(reconstruction.num_reg_images())
    points = int(reconstruction.num_points3D())
    minimum = max(
        SETTINGS.min_images,
        int(math.ceil(len(image_paths) * SETTINGS.min_registration_rate)),
    )
    if registered < minimum or points < 20:
        raise ReconstructionError(
            f"Only {registered}/{len(image_paths)} images registered and {points} points "
            f"were triangulated; at least {minimum} images are required. Capture "
            "overlapping views of the same surfaces with about 70% overlap."
        )

    try:
        reprojection = float(reconstruction.compute_mean_reprojection_error())
    except Exception:  # noqa: BLE001
        reprojection = 0.0

    model_path = sparse_dir / "0"
    model_path.mkdir(parents=True, exist_ok=True)
    try:
        reconstruction.write_binary(model_path)
    except Exception as exc:  # noqa: BLE001
        raise StageFailed(f"Could not write the COLMAP binary model: {exc}") from exc

    warnings: list[str] = []
    if len(values) > 1:
        warnings.append(
            f"COLMAP found {len(values)} disconnected models; the largest "
            f"({registered} images) was used and the others were ignored."
        )
    if not exhaustive:
        warnings.append(
            f"{len(image_paths)} images exceed the exhaustive-matching limit "
            f"({SETTINGS.exhaustive_match_limit}); sequential matching was used."
        )

    return SfmResult(
        modelPath=str(model_path),
        inputImages=len(image_paths),
        registeredImages=registered,
        sparsePoints=points,
        reprojectionErrorPx=round(reprojection, 3),
        modelsFound=len(values),
        device=device,
        engine=f"pycolmap {getattr(colmap, '__version__', '')}".strip(),
        matching="exhaustive" if exhaustive else "sequential",
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# COLMAP CLI dense MVS
# ---------------------------------------------------------------------------


def _run_colmap_cli(
    args: list[str],
    *,
    log_path: Path,
    timeout: int,
    cancel: CancelCheck | None = None,
) -> None:
    colmap = SETTINGS.colmap_binary
    if colmap is None:
        raise EngineUnavailable(
            "The COLMAP executable was not found. Set COLMAP_BINARY to colmap.exe "
            "to enable dense multi-view stereo."
        )
    command = [str(colmap), *args]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", errors="replace") as log:
        log.write(f"\n$ {subprocess.list2cmdline(command)}\n")
        log.flush()
        try:
            process = subprocess.Popen(
                command,
                stdout=log,
                stderr=subprocess.STDOUT,
                cwd=str(log_path.parent),
            )
        except OSError as exc:
            raise EngineUnavailable(f"Could not start COLMAP: {exc}") from exc

        started = time.time()
        while process.poll() is None:
            if cancel is not None and cancel():
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise PipelineCancelled("Reconstruction cancelled by the user.")
            if time.time() - started > timeout:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise StageFailed(
                    f"COLMAP stage exceeded the {timeout}s timeout: {args[0]}"
                )
            time.sleep(1.0)

    if process.returncode != 0:
        raise StageFailed(
            f"COLMAP '{args[0]}' failed with exit code {process.returncode}. "
            f"See {log_path.name} for details."
        )


def run_dense_mvs(
    images_dir: Path,
    sparse_model: Path,
    dense_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: CancelCheck | None = None,
) -> dict[str, Any]:
    """Undistort, run PatchMatch stereo, fuse to a dense point cloud.

    Returns statistics including the fused PLY path. Raises on failure so the
    orchestrator can record 'failed' instead of pretending a sparse cloud is
    dense.
    """
    dense_dir.mkdir(parents=True, exist_ok=True)
    log_path = dense_dir / "dense.log"
    timeout = SETTINGS.dense_timeout_seconds
    max_size = SETTINGS.dense_max_image_size

    if progress:
        progress(73, "Undistorting images for dense stereo")
    _run_colmap_cli(
        [
            "image_undistorter",
            "--image_path",
            str(images_dir),
            "--input_path",
            str(sparse_model),
            "--output_path",
            str(dense_dir),
            "--output_type",
            "COLMAP",
            "--max_image_size",
            str(max_size),
        ],
        log_path=log_path,
        timeout=1800,
        cancel=cancel,
    )

    if progress:
        progress(76, f"Running CUDA PatchMatch stereo at {max_size}px")
    _run_colmap_cli(
        [
            "patch_match_stereo",
            "--workspace_path",
            str(dense_dir),
            "--workspace_format",
            "COLMAP",
            "--PatchMatchStereo.geom_consistency",
            "true",
            "--PatchMatchStereo.max_image_size",
            str(max_size),
            "--PatchMatchStereo.gpu_index",
            str(SETTINGS.dense_gpu_index),
        ],
        log_path=log_path,
        timeout=timeout,
        cancel=cancel,
    )

    if progress:
        progress(82, "Fusing depth maps into a dense point cloud")
    fused = dense_dir / "fused.ply"
    if fused.exists():
        try:
            fused.unlink()
        except OSError:
            pass
    _run_colmap_cli(
        [
            "stereo_fusion",
            "--workspace_path",
            str(dense_dir),
            "--workspace_format",
            "COLMAP",
            "--input_type",
            "geometric",
            "--output_path",
            str(fused),
        ],
        log_path=log_path,
        timeout=timeout,
        cancel=cancel,
    )

    if not fused.is_file() or fused.stat().st_size < 1024:
        raise StageFailed("Stereo fusion produced no usable dense point cloud.")

    from ..utils.ply import read_ply_header_and_xyz

    stats = read_ply_header_and_xyz(fused, max_points=400_000)
    if stats["count"] < 1000:
        raise StageFailed(
            f"Dense fusion produced only {stats['count']} points; the result is not "
            "usable as a dense reconstruction."
        )
    logger(
        f"Dense cloud: {stats['count']:,} points, bounds "
        f"{stats['boundsMin']} .. {stats['boundsMax']}"
    )
    return {
        "path": str(fused),
        "points": stats["count"],
        "boundsMin": stats["boundsMin"],
        "boundsMax": stats["boundsMax"],
        "maxImageSize": max_size,
        "device": "cuda (COLMAP CLI)",
        "log": str(log_path),
    }
