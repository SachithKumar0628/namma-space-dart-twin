"""Asset validation and Gaussian outlier cleanup."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Callable

import numpy as np

from ..utils.ply import parse_header, read_vertices, validate_glb, validate_ply


def clean_gaussian_outliers(
    path: Path,
    logger: Callable[[str], None] | None = None,
    scale_factor: float = 4.0,
) -> dict[str, Any]:
    """Drop oversized floaters from a Gaussian PLY.

    Splat scale is relative to COLMAP's arbitrary world scale, so the cutoff is
    derived from the median splat size rather than a fixed metre value. The
    rewrite preserves every attribute and only changes the vertex count.
    """
    result: dict[str, Any] = {"removed": 0, "kept": 0, "scaleLimit": None}
    try:
        raw = path.read_bytes()
        header = parse_header(path)
    except (OSError, ValueError):
        return result

    names = {name for name, _ in header.vertex_properties}
    if not {"scale_0", "scale_1", "scale_2"}.issubset(names):
        return result
    if any(name != "vertex" and count > 0 for name, count in header.elements):
        # Additional elements (faces, edges) make a raw rewrite unsafe.
        return result

    try:
        vertices = read_vertices(path)
    except ValueError:
        return result
    if vertices.size == 0:
        return result

    scales = np.exp(
        np.column_stack([vertices["scale_0"], vertices["scale_1"], vertices["scale_2"]]).astype(
            np.float64
        )
    )
    max_scale = scales.max(axis=1)
    finite = np.isfinite(max_scale) & (max_scale > 0)
    if not finite.any():
        return result
    median = float(np.median(max_scale[finite]))
    if not np.isfinite(median) or median <= 0:
        return result
    limit = median * max(1.5, scale_factor)
    keep = finite & (max_scale <= limit)
    kept = int(keep.sum())
    original = int(header.vertex_count)
    if kept < max(200, int(original * 0.3)) or kept == original:
        return result

    match = re.search(rb"end_header\r?\n", raw)
    if not match:
        return result
    header_bytes = raw[: match.end()]
    new_header = re.sub(
        rb"(element\s+vertex\s+)\d+",
        rb"\g<1>" + str(kept).encode("ascii"),
        header_bytes,
        count=1,
    )
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(new_header + vertices[keep].tobytes())
    os.replace(temporary, path)

    result.update(removed=original - kept, kept=kept, scaleLimit=round(limit, 6))
    if logger:
        logger(
            f"Removed {result['removed']:,} oversized Gaussians "
            f"(kept {kept:,}; max scale {limit:.3f})"
        )
    return result


def validate_assets(assets_dir: Path) -> dict[str, Any]:
    """Validate every reconstruction artefact before the job is marked complete."""
    checks: dict[str, Any] = {}

    sparse = assets_dir / "point-cloud.ply"
    if sparse.is_file():
        checks["pointCloud"] = validate_ply(sparse, expected="points")

    splat = assets_dir / "scene.ply"
    if splat.is_file():
        checks["splat"] = validate_ply(splat, expected="gaussian")

    mesh = assets_dir / "mesh.ply"
    if mesh.is_file():
        checks["meshPly"] = validate_ply(mesh)

    glb = assets_dir / "mesh.glb"
    if glb.is_file():
        checks["meshGlb"] = validate_glb(glb)

    cameras = assets_dir / "cameras.json"
    if cameras.is_file():
        try:
            import json

            payload = json.loads(cameras.read_text(encoding="utf-8"))
            registered = int(payload.get("registeredImages") or 0)
            checks["cameras"] = {
                "ok": registered > 0 and bool(payload.get("cameras")),
                "registeredImages": registered,
                "bytes": cameras.stat().st_size,
            }
        except Exception as exc:  # noqa: BLE001
            checks["cameras"] = {"ok": False, "error": str(exc)}

    return checks
