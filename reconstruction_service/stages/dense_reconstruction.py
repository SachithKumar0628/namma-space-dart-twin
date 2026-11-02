"""Dense multi-view stereo stage.

Dense reconstruction is a *real* MVS pass (COLMAP image_undistorter +
PatchMatch stereo + stereo fusion). It is never simulated with the sparse
cloud, and it is allowed to fail without failing the whole job: the result is
reported honestly as failed/skipped.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from ..config import SETTINGS
from ..engines import colmap_engine
from ..errors import EngineUnavailable, PipelineCancelled, StageFailed
from ..utils.gpu_monitor import gpu_status, preflight_gpu


def run_dense(
    images_dir: Path,
    sparse_model: Path,
    work_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if not SETTINGS.dense_enabled:
        return {
            "status": "skipped",
            "reason": "Dense reconstruction is disabled (DART_DENSE_ENABLED=0).",
            "densePly": None,
        }
    if SETTINGS.colmap_binary is None:
        return {
            "status": "skipped",
            "reason": (
                "The COLMAP executable is required for dense MVS and was not found. "
                "Set COLMAP_BINARY to colmap.exe."
            ),
            "densePly": None,
        }

    ok, message, gpu = preflight_gpu(1200)
    if not ok:
        return {
            "status": "skipped",
            "reason": message,
            "gpu": gpu,
            "densePly": None,
        }

    dense_dir = work_dir / "dense"
    try:
        stats = colmap_engine.run_dense_mvs(
            images_dir,
            sparse_model,
            dense_dir,
            logger=logger,
            progress=progress,
            cancel=cancel,
        )
    except PipelineCancelled:
        raise
    except (StageFailed, EngineUnavailable) as exc:
        logger(f"Dense reconstruction failed: {exc}")
        return {
            "status": "failed",
            "reason": str(exc),
            "gpu": gpu,
            "densePly": None,
        }
    except Exception as exc:  # noqa: BLE001 - never hide an unexpected failure
        logger(f"Dense reconstruction failed unexpectedly: {exc}")
        return {
            "status": "failed",
            "reason": f"Unexpected dense reconstruction failure: {exc}",
            "gpu": gpu,
            "densePly": None,
        }

    # Report the *real* point count from the fused cloud.
    return {
        "status": "passed",
        "densePly": stats["path"],
        "points": stats["points"],
        "boundsMin": stats["boundsMin"],
        "boundsMax": stats["boundsMax"],
        "maxImageSize": stats["maxImageSize"],
        "device": stats["device"],
        "log": stats["log"],
        "gpu": gpu,
    }
