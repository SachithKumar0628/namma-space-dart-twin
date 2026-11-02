"""Scene export: manifest, asset metadata and viewer hints."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..utils.filesystem import atomic_write_json, sha256_file
from ..utils.logging import utc_now
from ..utils.ply import validate_glb, validate_ply


def _asset(path: Path, kind: str, url: str, job_id: str) -> dict[str, Any]:
    return {
        "file": path.name,
        "kind": kind,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "url": f"/v1/jobs/{job_id}/assets/{url}",
    }


def collect_assets(assets_dir: Path, job_id: str) -> dict[str, dict[str, Any]]:
    assets: dict[str, dict[str, Any]] = {}
    if (assets_dir / "scene.ply").is_file():
        assets["splat"] = _asset(assets_dir / "scene.ply", "gaussian_ply", "scene.ply", job_id)
    if (assets_dir / "mesh.glb").is_file():
        assets["mesh"] = _asset(assets_dir / "mesh.glb", "glb", "mesh.glb", job_id)
    if (assets_dir / "mesh.ply").is_file():
        assets["meshPly"] = _asset(assets_dir / "mesh.ply", "mesh_ply", "mesh.ply", job_id)
    if (assets_dir / "point-cloud.ply").is_file():
        assets["pointCloud"] = _asset(
            assets_dir / "point-cloud.ply", "point_ply", "point-cloud.ply", job_id
        )
    if (assets_dir / "cameras.json").is_file():
        assets["cameras"] = _asset(assets_dir / "cameras.json", "camera_poses", "cameras.json", job_id)
    return assets


def build_stats(
    *,
    job_id: str,
    ingestion: dict[str, Any],
    cameras: dict[str, Any],
    dense: dict[str, Any],
    mesh: dict[str, Any],
    splat: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any]:
    sfm = cameras.get("sfm", {})
    quality = ingestion.get("quality", {})
    asset_paths = {}

    engine_bits = [sfm.get("engine") or "COLMAP SfM"]
    if dense.get("status") == "passed":
        engine_bits.append("COLMAP dense MVS")
    if mesh.get("status") == "passed":
        engine_bits.append("Open3D + Blender mesh")
    if splat.get("status") == "passed":
        engine_bits.append(splat.get("engineLabel") or "Gaussian splatting")

    stats: dict[str, Any] = {
        "jobId": job_id,
        "engine": " + ".join(engine_bits),
        "sfmEngine": sfm.get("engine"),
        "sfmDevice": sfm.get("device"),
        "sfmMatching": sfm.get("matching"),
        "splatEngine": splat.get("engineLabel") if splat.get("status") == "passed" else None,
        "cameraModel": "SIMPLE_RADIAL",
        "inputImages": ingestion.get("preparedCount", sfm.get("inputImages", 0)),
        "uploadedImages": ingestion.get("inputImages", 0),
        "uploadedVideos": ingestion.get("inputVideos", 0),
        "extractedFrames": ingestion.get("extractedFrames", 0),
        "qualityKept": quality.get("kept"),
        "qualityRejected": quality.get("rejected"),
        "meanSharpness": quality.get("meanSharpness"),
        "registeredImages": sfm.get("registeredImages", 0),
        "registrationRatePercent": round(
            (sfm.get("registeredImages", 0) / max(1, sfm.get("inputImages", 1))) * 100, 1
        ),
        "sparsePoints": sfm.get("sparsePoints", 0),
        "pointCloudCount": cameras.get("pointCloudStats", {}).get("count", 0),
        "splatCount": splat.get("gaussians", 0),
        "splatFilterRemoved": (splat.get("cleanup") or {}).get("removed", 0),
        "reprojectionErrorPx": sfm.get("reprojectionErrorPx"),
        "denseStatus": dense.get("status", "skipped"),
        "densePoints": dense.get("points"),
        "denseReason": dense.get("reason"),
        "meshStatus": mesh.get("status", "skipped"),
        "meshTriangleCount": (mesh.get("mesh") or {}).get("triangles"),
        "meshVertexCount": (mesh.get("mesh") or {}).get("vertices"),
        "meshReason": mesh.get("reason"),
        "splatStatus": splat.get("status", "skipped"),
        "splatReason": splat.get("reason"),
        "sceneCenter": cameras.get("pointCloudStats", {}).get("center"),
        "sceneRadius": cameras.get("pointCloudStats", {}).get("radius"),
        "viewerCamera": cameras.get("viewerCamera"),
        "warnings": warnings,
        "lastGeneratedAt": utc_now(),
    }
    if stats["splatCount"]:
        facts = splat.get("facts") or {}
        stats["splatCenter"] = facts.get("center")
        stats["splatRadius"] = facts.get("radius")
    else:
        stats["splatCenter"] = None
        stats["splatRadius"] = None
    return stats


def write_manifest(
    assets_dir: Path,
    *,
    job_id: str,
    stats: dict[str, Any],
    ingestion: dict[str, Any],
    cameras: dict[str, Any],
    dense: dict[str, Any],
    mesh: dict[str, Any],
    splat: dict[str, Any],
    validation: dict[str, Any],
) -> dict[str, Any]:
    assets = collect_assets(assets_dir, job_id)
    manifest = {
        "jobId": job_id,
        "generatedAt": stats.get("lastGeneratedAt"),
        "stats": stats,
        "assets": assets,
        "validation": validation,
        "dataset": {
            "uploadedImages": ingestion.get("inputImages"),
            "uploadedVideos": ingestion.get("inputVideos"),
            "extractedFrames": ingestion.get("extractedFrames"),
            "preparedImages": ingestion.get("preparedCount"),
            "quality": ingestion.get("quality"),
            "warnings": ingestion.get("warnings"),
        },
        "stages": {
            "ingestion": ingestion.get("quality", {}),
            "sfm": cameras.get("sfm", {}),
            "dense": dense,
            "mesh": mesh,
            "splat": {
                key: value
                for key, value in splat.items()
                if key in {"status", "engine", "engineLabel", "gaussians", "durationSeconds", "vram", "reason", "cleanup"}
            },
        },
    }
    atomic_write_json(assets_dir / "manifest.json", manifest)
    return manifest


def final_checks(assets_dir: Path) -> dict[str, Any]:
    """Return a compact validation summary for the manifest and job response."""
    checks = {}
    for path, expected, validator in (
        (assets_dir / "scene.ply", "gaussian", validate_ply),
        (assets_dir / "mesh.glb", None, validate_glb),
        (assets_dir / "point-cloud.ply", "points", validate_ply),
    ):
        if path.is_file():
            facts = validator(path) if expected is None else validator(path, expected=expected)
            checks[path.name] = facts
    return checks
