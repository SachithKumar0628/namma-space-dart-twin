"""Camera reconstruction stage: real SfM -> sparse model, PLY and poses."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import numpy as np

from ..engines import colmap_engine
from ..errors import PipelineCancelled
from ..utils.logging import utc_now
from ..utils.ply import read_ply_header_and_xyz


def reconstruct_cameras(
    images_dir: Path,
    work_dir: Path,
    assets_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    result = colmap_engine.run_sfm(
        images_dir,
        work_dir,
        logger=logger,
        progress=progress,
        cancel=cancel,
    )

    if cancel is not None and cancel():
        raise PipelineCancelled("Reconstruction cancelled by the user.")

    try:
        import pycolmap  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"pycolmap disappeared mid-run: {exc}") from exc

    model = pycolmap.Reconstruction(result.modelPath)
    assets_dir.mkdir(parents=True, exist_ok=True)

    sparse_ply = assets_dir / "point-cloud.ply"
    try:
        model.export_PLY(str(sparse_ply))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Could not export the sparse PLY: {exc}") from exc
    point_stats = read_ply_header_and_xyz(sparse_ply, max_points=200_000)

    poses = colmap_engine.export_camera_poses(model, assets_dir / "cameras.json")
    representative = poses.get("representative")

    viewer_camera = None
    if representative:
        position = np.asarray(representative["position"], dtype=np.float64)
        direction = np.asarray(representative["direction"], dtype=np.float64)
        look_distance = max(1.2, float(point_stats["radius"]) * 0.65)
        look_at = position + direction * look_distance
        viewer_camera = {
            "position": [round(float(v), 6) for v in position],
            "lookAt": [round(float(v), 6) for v in look_at],
            "up": representative.get("up") or [0.0, 1.0, 0.0],
            "image": representative.get("image"),
        }

    logger(
        f"SfM registered {result.registeredImages}/{result.inputImages} cameras, "
        f"{result.sparsePoints:,} sparse points, {result.reprojectionErrorPx:.3f}px "
        f"mean reprojection error"
    )
    for warning in result.warnings:
        logger(f"SfM warning: {warning}")

    return {
        "status": "passed",
        "sfm": result.as_dict(),
        "sparsePly": str(sparse_ply),
        "pointCloudStats": point_stats,
        "poses": poses,
        "posesPath": str(assets_dir / "cameras.json"),
        "viewerCamera": viewer_camera,
        "finishedAt": utc_now(),
    }
