"""Reconstruction orchestrator.

The pipeline is deliberate about what actually ran:

    uploads -> ingestion (FFmpeg + quality) -> pycolmap SfM
            -> COLMAP dense MVS (restricted by VRAM) -> Open3D/Blender mesh
            -> Gaussian splats (gsplat preferred, Brush fallback)
            -> validation -> manifest

Failures in the optional dense/mesh/splat stages are recorded as
failed/skipped with their real reason; they never silently become fake assets.
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any, Callable, Sequence

try:
    from .config import SETTINGS, find_brush  # re-exported for API compatibility
    from .errors import (
        EngineUnavailable,
        PipelineCancelled,
        ReconstructionError,
        StageFailed,
    )
    from .stages.camera_reconstruction import reconstruct_cameras
    from .stages.dense_reconstruction import run_dense
    from .stages.gaussian_training import train_gaussians
    from .stages.ingestion import ingest
    from .stages.mesh_generation import generate_mesh
    from .stages.scene_export import build_stats, final_checks, write_manifest
    from .stages.scene_validation import validate_assets
    from .utils.logging import PipelineLogger, StageRecorder, utc_now
    from .utils.ply import read_ply_header_and_xyz
except ImportError:  # pragma: no cover - standalone execution
    from config import SETTINGS, find_brush  # re-exported for API compatibility
    from errors import (
        EngineUnavailable,
        PipelineCancelled,
        ReconstructionError,
        StageFailed,
    )
    from stages.camera_reconstruction import reconstruct_cameras
    from stages.dense_reconstruction import run_dense
    from stages.gaussian_training import train_gaussians
    from stages.ingestion import ingest
    from stages.mesh_generation import generate_mesh
    from stages.scene_export import build_stats, final_checks, write_manifest
    from stages.scene_validation import validate_assets
    from utils.logging import PipelineLogger, StageRecorder, utc_now
    from utils.ply import read_ply_header_and_xyz

PIPELINE_VERSION = "0.2.0"

ProgressCallback = Callable[[str, int, str], None]
CancelCheck = Callable[[], bool]

__all__ = [
    "PIPELINE_VERSION",
    "ReconstructionError",
    "PipelineCancelled",
    "StageFailed",
    "EngineUnavailable",
    "reconstruct",
    "find_brush",
    "read_ply_stats",
    "clean_splat_ply",
]


def read_ply_stats(path: Path) -> dict[str, Any]:
    """Backwards-compatible helper used by older callers."""
    return read_ply_header_and_xyz(Path(path), max_points=200_000)


def clean_splat_ply(path: Path, logger: Callable[[str], None] | None = None) -> dict[str, Any]:
    """Backwards-compatible Gaussian cleanup wrapper."""
    from .stages.scene_validation import clean_gaussian_outliers

    return clean_gaussian_outliers(Path(path), logger)


def _emit(progress: ProgressCallback | None, stage: str, percent: int, message: str) -> None:
    if progress is not None:
        progress(stage, max(0, min(99, int(percent))), message)


def _cancelled(cancel: CancelCheck | None) -> bool:
    return bool(cancel is not None and cancel())


def _stage_progress(progress: ProgressCallback | None, stage: str) -> Callable[[int, str], None]:
    return lambda percent, message: _emit(progress, stage, percent, message)


def reconstruct(
    images: Sequence[Path],
    work_dir: Path,
    assets_dir: Path,
    log_path: Path,
    progress: ProgressCallback,
    *,
    cancel: CancelCheck | None = None,
    job_id: str = "local",
) -> dict[str, Any]:
    started = time.time()
    work_dir = Path(work_dir)
    assets_dir = Path(assets_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)

    logger = PipelineLogger(log_path)
    recorder = StageRecorder(work_dir / "stages.jsonl", logger)
    warnings: list[str] = []

    ingestion: dict[str, Any] = {}
    cameras: dict[str, Any] = {}
    dense: dict[str, Any] = {"status": "skipped", "reason": "not reached"}
    mesh: dict[str, Any] = {"status": "skipped", "reason": "not reached"}
    splat: dict[str, Any] = {"status": "skipped", "reason": "not reached"}

    try:
        logger(f"Reconstruction started for job {job_id} with {len(images)} uploaded file(s)")

        # ------------------------------------------------------------- ingest
        if _cancelled(cancel):
            raise PipelineCancelled("Reconstruction cancelled by the user.")
        recorder.start("ingestion")
        _emit(progress, "ingest", 2, "Validating uploads and decoding video")
        try:
            ingestion = ingest(
                [Path(item) for item in images],
                work_dir,
                logger=logger,
                progress=_stage_progress(progress, "ingest"),
                cancel=cancel,
            )
        except ReconstructionError as exc:
            recorder.finish("ingestion", "failed", error=str(exc))
            raise
        warnings.extend(ingestion.get("warnings") or [])
        recorder.finish(
            "ingestion",
            "passed",
            inputs={
                "uploaded": len(images),
                "images": ingestion.get("inputImages"),
                "videos": ingestion.get("inputVideos"),
            },
            outputs={
                "preparedImages": ingestion.get("preparedCount"),
                "extractedFrames": ingestion.get("extractedFrames"),
            },
            metrics={
                "qualityKept": ingestion.get("quality", {}).get("kept"),
                "qualityRejected": ingestion.get("quality", {}).get("rejected"),
                "meanSharpness": ingestion.get("quality", {}).get("meanSharpness"),
            },
        )

        prepared_dir = Path(ingestion["preparedDirectory"])

        # ---------------------------------------------------------------- SfM
        if _cancelled(cancel):
            raise PipelineCancelled("Reconstruction cancelled by the user.")
        recorder.start("sfm")
        try:
            cameras = reconstruct_cameras(
                prepared_dir,
                work_dir,
                assets_dir,
                logger=logger,
                progress=_stage_progress(progress, "sfm"),
                cancel=cancel,
            )
        except ReconstructionError as exc:
            recorder.finish("sfm", "failed", error=str(exc))
            raise
        sfm = cameras["sfm"]
        warnings.extend(sfm.get("warnings") or [])
        recorder.finish(
            "sfm",
            "passed",
            inputs={"images": sfm.get("inputImages")},
            outputs={
                "registeredImages": sfm.get("registeredImages"),
                "sparsePoints": sfm.get("sparsePoints"),
                "modelPath": sfm.get("modelPath"),
            },
            metrics={
                "reprojectionErrorPx": sfm.get("reprojectionErrorPx"),
                "modelsFound": sfm.get("modelsFound"),
                "device": sfm.get("device"),
                "matching": sfm.get("matching"),
            },
        )
        _emit(
            progress,
            "sfm",
            71,
            f"Recovered {sfm['registeredImages']}/{sfm['inputImages']} cameras "
            f"and {sfm['sparsePoints']:,} points",
        )

        # -------------------------------------------------------------- dense
        if _cancelled(cancel):
            raise PipelineCancelled("Reconstruction cancelled by the user.")
        recorder.start("dense")
        dense = run_dense(
            prepared_dir,
            Path(sfm["modelPath"]),
            work_dir,
            logger=logger,
            progress=_stage_progress(progress, "dense"),
            cancel=cancel,
        )
        recorder.finish(
            "dense",
            dense.get("status", "skipped"),
            inputs={"images": sfm.get("inputImages"), "model": sfm.get("modelPath")},
            outputs={"densePly": dense.get("densePly"), "points": dense.get("points")},
            metrics={"maxImageSize": SETTINGS.dense_max_image_size},
            error=dense.get("reason") if dense.get("status") == "failed" else None,
        )
        if dense.get("status") == "failed":
            warnings.append(f"Dense MVS failed: {dense.get('reason')}")

        # --------------------------------------------------------------- mesh
        if _cancelled(cancel):
            raise PipelineCancelled("Reconstruction cancelled by the user.")
        recorder.start("mesh")
        mesh = generate_mesh(
            dense,
            assets_dir,
            logger=logger,
            progress=_stage_progress(progress, "mesh"),
            cancel=cancel,
        )
        recorder.finish(
            "mesh",
            mesh.get("status", "skipped"),
            inputs={"densePly": dense.get("densePly")},
            outputs={"meshPly": mesh.get("meshPly"), "meshGlb": mesh.get("meshGlb")},
            metrics=mesh.get("mesh") or {},
            error=mesh.get("reason") if mesh.get("status") == "failed" else None,
        )
        if mesh.get("status") == "failed":
            warnings.append(f"Mesh generation failed: {mesh.get('reason')}")

        # -------------------------------------------------------------- splat
        if _cancelled(cancel):
            raise PipelineCancelled("Reconstruction cancelled by the user.")
        recorder.start("splat")
        splat = train_gaussians(
            prepared_dir,
            Path(sfm["modelPath"]),
            work_dir,
            assets_dir,
            logger=logger,
            progress=_stage_progress(progress, "splat"),
            cancel=cancel,
        )
        recorder.finish(
            "splat",
            splat.get("status", "skipped"),
            inputs={"images": sfm.get("inputImages")},
            outputs={"splatPly": splat.get("splatPly")},
            metrics={
                "gaussians": splat.get("gaussians"),
                "engine": splat.get("engine"),
                "vram": splat.get("vram"),
            },
            error=splat.get("reason") if splat.get("status") == "failed" else None,
        )
        if splat.get("status") == "skipped":
            warnings.append(f"Gaussian splatting skipped: {splat.get('reason')}")

        # ---------------------------------------------------------- validation
        recorder.start("validation")
        validation = validate_assets(assets_dir)
        if not validation.get("pointCloud", {}).get("ok"):
            raise ReconstructionError(
                "The sparse point cloud failed validation: "
                + str(validation.get("pointCloud", {}).get("error"))
            )
        recorder.finish("validation", "passed", outputs=validation)

        # ------------------------------------------------------------ manifest
        recorder.start("manifest")
        stats = build_stats(
            job_id=job_id,
            ingestion=ingestion,
            cameras=cameras,
            dense=dense,
            mesh=mesh,
            splat=splat,
            warnings=warnings,
        )
        stats["validation"] = final_checks(assets_dir)
        stats["durationSeconds"] = round(time.time() - started, 1)
        write_manifest(
            assets_dir,
            job_id=job_id,
            stats=stats,
            ingestion=ingestion,
            cameras=cameras,
            dense=dense,
            mesh=mesh,
            splat=splat,
            validation=validation,
        )
        recorder.finish("manifest", "passed", outputs={"manifest": "manifest.json"})
        _emit(progress, "finalizing", 98, "Writing the reconstruction manifest")

        logger(
            f"Reconstruction finished in {stats['durationSeconds']}s | {stats['engine']} | "
            f"{stats['registeredImages']}/{stats['inputImages']} cameras | "
            f"{stats['splatCount']:,} splats | {stats['meshTriangleCount'] or 0:,} triangles"
        )
        return stats

    except PipelineCancelled:
        logger("Reconstruction cancelled.")
        raise
    except ReconstructionError:
        logger("Reconstruction failed: " + json.dumps({"error": "see log"}))
        raise
    except Exception as exc:  # noqa: BLE001 - surface a usable message to the UI
        logger(f"Unexpected reconstruction failure: {exc}")
        raise ReconstructionError(f"Reconstruction failed: {exc}") from exc
    finally:
        logger.close()
        if not SETTINGS.keep_work:
            # Keep originals + assets; drop the heavy COLMAP/Brush workspace.
            for name in ("images", "extracted", "dense", "dataset", "sparse"):
                shutil.rmtree(work_dir / name, ignore_errors=True)
