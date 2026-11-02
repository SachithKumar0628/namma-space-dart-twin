"""Mesh stage: dense cloud -> Poisson surface -> GLB.

The input must be a *dense* fused cloud. If dense MVS did not run, the stage is
reported as skipped rather than surfacing a Poisson mesh of the sparse cloud as
a dense reconstruction.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from ..config import SETTINGS
from ..engines import blender_engine, open3d_engine
from ..errors import EngineUnavailable, PipelineCancelled, StageFailed


def generate_mesh(
    dense_result: dict[str, Any],
    assets_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if dense_result.get("status") != "passed" or not dense_result.get("densePly"):
        return {
            "status": "skipped",
            "reason": (
                "No dense point cloud is available. Mesh generation is only valid for "
                "dense MVS output; the sparse cloud is exported separately."
            ),
            "meshPly": None,
            "meshGlb": None,
        }

    if cancel is not None and cancel():
        raise PipelineCancelled("Reconstruction cancelled by the user.")

    if progress:
        progress(86, "Reconstructing a dense surface mesh")
    mesh_ply = assets_dir / "mesh.ply"
    glb_path = assets_dir / "mesh.glb"
    try:
        stats = open3d_engine.mesh_from_dense_cloud(
            Path(dense_result["densePly"]),
            mesh_ply,
            target_triangles=SETTINGS.mesh_target_triangles,
            poisson_depth=SETTINGS.mesh_poisson_depth,
            logger=logger,
        )
    except (StageFailed, EngineUnavailable) as exc:
        logger(f"Mesh generation failed: {exc}")
        return {"status": "failed", "reason": str(exc), "meshPly": None, "meshGlb": None}
    except Exception as exc:  # noqa: BLE001
        logger(f"Mesh generation failed unexpectedly: {exc}")
        return {
            "status": "failed",
            "reason": f"Unexpected mesh failure: {exc}",
            "meshPly": None,
            "meshGlb": None,
        }

    if cancel is not None and cancel():
        raise PipelineCancelled("Reconstruction cancelled by the user.")

    if progress:
        progress(89, "Converting the mesh to GLB")
    try:
        glb = blender_engine.export_glb(mesh_ply, glb_path, logger=logger)
    except (EngineUnavailable, StageFailed) as exc:
        logger(f"GLB export failed: {exc}")
        return {
            "status": "partial",
            "reason": f"Mesh PLY is available but GLB export failed: {exc}",
            "meshPly": str(mesh_ply),
            "meshGlb": None,
            "mesh": stats,
        }
    except Exception as exc:  # noqa: BLE001
        logger(f"GLB export failed unexpectedly: {exc}")
        return {
            "status": "partial",
            "reason": f"Mesh PLY is available but GLB export failed: {exc}",
            "meshPly": str(mesh_ply),
            "meshGlb": None,
            "mesh": stats,
        }

    logger(
        f"Mesh ready: {stats['triangles']:,} triangles, GLB {glb['bytes'] / (1024 * 1024):.1f} MB "
        f"({glb.get('exporter')})"
    )
    return {
        "status": "passed",
        "meshPly": str(mesh_ply),
        "meshGlb": str(glb_path),
        "mesh": stats,
        "glb": glb,
    }
