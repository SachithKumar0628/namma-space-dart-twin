"""Gaussian-splat training stage.

Engine priority is explicit and reported:

``gsplat``  preferred when its CUDA backend is buildable;
``brush``   proven fallback on this laptop and the current default;
``auto``    gsplat when ready, otherwise Brush, otherwise skipped.

The stage never invents Gaussians. If no trainer can run, the job continues
with the photogrammetric assets and the reason is recorded.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from ..config import SETTINGS
from ..engines import brush_engine, gsplat_engine
from ..errors import EngineUnavailable, PipelineCancelled, StageFailed
from ..utils.ply import validate_ply
from .scene_validation import clean_gaussian_outliers


def _select_engine() -> tuple[str | None, dict[str, Any]]:
    status = gsplat_engine.gsplat_status()
    preference = SETTINGS.splat_engine
    if preference == "gsplat":
        return "gsplat", status
    if preference == "brush":
        return ("brush" if brush_engine.brush_available() else None), status
    if preference not in {"auto", ""}:
        return None, status
    if status.get("ready"):
        return "gsplat", status
    if brush_engine.brush_available():
        return "brush", status
    return None, status


def train_gaussians(
    prepared_images_dir: Path,
    sparse_model: Path,
    work_dir: Path,
    assets_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    engine, gsplat_info = _select_engine()
    if engine is None:
        reason = (
            "No Gaussian trainer is available. gsplat: "
            + (gsplat_info.get("reason") or "not ready")
            + ". Brush: not found (place brush_app.exe in .tools/brush)."
        )
        logger(f"Gaussian splatting skipped: {reason}")
        return {"status": "skipped", "reason": reason, "engine": None}

    dataset_dir = work_dir / "dataset"
    dataset_images = dataset_dir / "images"
    dataset_sparse = dataset_dir / "sparse" / "0"
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir, ignore_errors=True)
    dataset_images.mkdir(parents=True, exist_ok=True)
    for image in sorted(prepared_images_dir.glob("*.jpg")):
        shutil.copy2(image, dataset_images / image.name)
    shutil.copytree(sparse_model, dataset_sparse)
    logger(f"Prepared COLMAP dataset for {engine}: {len(list(dataset_images.glob('*.jpg')))} images")

    if progress:
        progress(78, f"Starting Gaussian training with {engine}")

    try:
        if engine == "gsplat":
            result = gsplat_engine.train(
                dataset_dir, assets_dir, logger=logger, progress=progress, cancel=cancel
            )
        else:
            result = brush_engine.train(
                dataset_dir, assets_dir, logger=logger, progress=progress, cancel=cancel
            )
    except PipelineCancelled:
        raise
    except (StageFailed, EngineUnavailable) as exc:
        logger(f"Gaussian training failed ({engine}): {exc}")
        return {"status": "failed", "reason": str(exc), "engine": engine, "gsplat": gsplat_info}
    except Exception as exc:  # noqa: BLE001 - report unexpected trainer crashes
        logger(f"Gaussian training failed unexpectedly ({engine}): {exc}")
        return {
            "status": "failed",
            "reason": f"Unexpected {engine} failure: {exc}",
            "engine": engine,
            "gsplat": gsplat_info,
        }

    splat_path = Path(result["path"])
    cleanup = clean_gaussian_outliers(splat_path, logger)
    facts = validate_ply(splat_path, expected="gaussian")
    if not facts.get("ok"):
        return {
            "status": "failed",
            "reason": f"Trainer produced an invalid Gaussian PLY: {facts.get('error')}",
            "engine": engine,
            "gsplat": gsplat_info,
        }

    logger(f"{engine} output validated: {facts['vertexCount']:,} Gaussians")
    return {
        "status": "passed",
        "engine": engine,
        "engineLabel": result.get("engine", engine),
        "splatPly": str(splat_path),
        "gaussians": facts["vertexCount"],
        "cleanup": cleanup,
        "facts": facts,
        "durationSeconds": result.get("durationSeconds"),
        "vram": result.get("vram"),
        "log": result.get("log"),
        "gsplat": gsplat_info,
    }
