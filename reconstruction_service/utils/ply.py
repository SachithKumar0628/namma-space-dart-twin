"""Binary/ASCII PLY parsing used for validation and geometry statistics.

This intentionally does not depend on Open3D or plyfile so the API process can
validate a 54 MB Gaussian PLY without importing the whole geometry stack.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


PLY_TYPES = {
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

GAUSSIAN_PROPERTIES = {"f_dc_0", "f_dc_1", "f_dc_2", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "opacity"}
MESH_PROPERTIES = {"vertex_indices"}


class PlyError(ValueError):
    pass


@dataclass
class PlyHeader:
    format: str
    vertex_count: int
    vertex_properties: list[tuple[str, str]]
    elements: list[tuple[str, int]]
    data_offset: int
    raw: str


def parse_header(path: Path) -> PlyHeader:
    with path.open("rb") as handle:
        header = bytearray()
        while True:
            line = handle.readline()
            if not line:
                raise PlyError(f"{path.name} is not a valid PLY file")
            header.extend(line)
            if line.strip() == b"end_header":
                break
            if len(header) > 4_000_000:
                raise PlyError(f"{path.name} has an oversized PLY header")
        offset = handle.tell()

    text = header.decode("ascii", errors="replace")
    if not text.startswith("ply"):
        raise PlyError(f"{path.name} is not a PLY file")

    fmt_match = re.search(r"^format\s+(\S+)\s+(\S+)", text, re.MULTILINE)
    if not fmt_match:
        raise PlyError(f"{path.name} has no PLY format line")
    fmt = f"{fmt_match.group(1)} {fmt_match.group(2)}"

    elements: list[tuple[str, int]] = []
    vertex_props: list[tuple[str, str]] = []
    current = ""
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "element" and len(parts) >= 3:
            current = parts[1]
            elements.append((current, int(parts[2])))
        elif parts[0] == "property" and len(parts) == 3 and current == "vertex":
            if parts[1] in PLY_TYPES:
                vertex_props.append((parts[2], PLY_TYPES[parts[1]]))

    vertex_count = next((count for name, count in elements if name == "vertex"), 0)
    return PlyHeader(fmt, vertex_count, vertex_props, elements, offset, text)


def read_vertices(path: Path, *, max_points: int | None = None) -> np.ndarray:
    """Read the vertex element as a structured numpy array."""
    header = parse_header(path)
    if header.vertex_count == 0:
        raise PlyError(f"{path.name} has no vertices")
    if not header.vertex_properties:
        raise PlyError(f"{path.name} has no numeric vertex properties")
    dtype = np.dtype(header.vertex_properties)
    count = header.vertex_count
    with path.open("rb") as handle:
        handle.seek(header.data_offset)
        if header.format.startswith("ascii"):
            rows = []
            for _ in range(count):
                line = handle.readline().decode("ascii", errors="replace").strip()
                if not line:
                    continue
                rows.append([float(value) for value in line.split()[: len(dtype.names or ())]])
            array = np.asarray(rows, dtype=np.float64)
            if array.size == 0:
                raise PlyError(f"{path.name} has no vertex data")
            structured = np.zeros(array.shape[0], dtype=dtype)
            for index, name in enumerate(dtype.names or ()):
                structured[name] = array[:, index]
            return structured

        if max_points is not None and count > max_points:
            # Stream the payload in blocks and keep every stride-th vertex so a
            # multi-gigabyte dense cloud never has to be materialised at once.
            stride = max(1, count // max_points)
            block_rows = 1_000_000
            kept: list[np.ndarray] = []
            row = 0
            while row < count:
                rows = min(block_rows, count - row)
                payload = handle.read(rows * dtype.itemsize)
                if len(payload) < rows * dtype.itemsize:
                    raise PlyError(f"{path.name} is truncated")
                block = np.frombuffer(payload, dtype=dtype, count=rows)
                offset = (-row) % stride
                if offset < rows:
                    kept.append(block[offset::stride])
                row += rows
            if not kept:
                raise PlyError(f"{path.name} has no vertex data")
            return np.concatenate(kept)

        payload = handle.read(count * dtype.itemsize)
    if len(payload) < count * dtype.itemsize:
        raise PlyError(f"{path.name} is truncated")
    return np.frombuffer(payload, dtype=dtype, count=count)


def read_ply_header_and_xyz(path: Path, *, max_points: int | None = None) -> dict[str, Any]:
    header = parse_header(path)
    names = {name for name, _ in header.vertex_properties}
    if not {"x", "y", "z"}.issubset(names):
        raise PlyError(f"{path.name} has no XYZ vertex coordinates")
    vertices = read_vertices(path, max_points=max_points)
    xyz = np.column_stack([vertices["x"], vertices["y"], vertices["z"]]).astype(np.float64)
    xyz = xyz[np.isfinite(xyz).all(axis=1)]
    if xyz.size == 0:
        raise PlyError(f"{path.name} has no finite points")
    minimum = xyz.min(axis=0)
    maximum = xyz.max(axis=0)
    low = np.percentile(xyz, 1.0, axis=0)
    high = np.percentile(xyz, 99.0, axis=0)
    center = (low + high) / 2.0
    distances = np.linalg.norm(xyz - center, axis=1)
    radius = float(np.percentile(distances, 99.0))
    if not np.isfinite(radius) or radius <= 0:
        radius = float(np.linalg.norm(maximum - minimum) / 2.0) or 1.0
    return {
        "count": int(header.vertex_count),
        "sampled": int(xyz.shape[0]),
        "center": [round(float(value), 6) for value in center],
        "radius": round(float(radius), 6),
        "boundsMin": [round(float(value), 6) for value in minimum],
        "boundsMax": [round(float(value), 6) for value in maximum],
        "properties": sorted(names),
    }


def ply_kind(path: Path) -> str:
    """Classify a PLY as gaussian, mesh or points from its header only."""
    header = parse_header(path)
    names = {name for name, _ in header.vertex_properties}
    elements = {name for name, _ in header.elements}
    if GAUSSIAN_PROPERTIES.issubset(names):
        return "gaussian"
    if "face" in elements:
        return "mesh"
    return "points"


def validate_ply(path: Path, expected: str | None = None) -> dict[str, Any]:
    """Validate structure and return facts used by the manifest and viewer."""
    if not path.is_file():
        return {"ok": False, "error": "file missing"}
    try:
        header = parse_header(path)
    except (OSError, PlyError) as exc:
        return {"ok": False, "error": str(exc)}

    kind = ply_kind(path)
    facts: dict[str, Any] = {
        "ok": True,
        "kind": kind,
        "format": header.format,
        "vertexCount": header.vertex_count,
        "elements": [{"name": name, "count": count} for name, count in header.elements],
        "properties": [name for name, _ in header.vertex_properties],
        "bytes": path.stat().st_size,
    }
    if expected and expected != kind:
        facts["ok"] = False
        facts["error"] = f"expected a {expected} PLY but found {kind}"

    if kind == "gaussian":
        required = GAUSSIAN_PROPERTIES
        missing = sorted(required - set(facts["properties"]))
        facts["missingGaussianProperties"] = missing
        if missing:
            facts["ok"] = False
            facts["error"] = "Gaussian PLY is missing attributes: " + ", ".join(missing)
        else:
            try:
                stats = read_ply_header_and_xyz(path, max_points=200_000)
                facts.update(
                    {
                        "center": stats["center"],
                        "radius": stats["radius"],
                        "boundsMin": stats["boundsMin"],
                        "boundsMax": stats["boundsMax"],
                    }
                )
            except PlyError as exc:
                facts["ok"] = False
                facts["error"] = str(exc)
    elif kind == "points":
        try:
            stats = read_ply_header_and_xyz(path, max_points=200_000)
            facts.update(
                {
                    "center": stats["center"],
                    "radius": stats["radius"],
                    "boundsMin": stats["boundsMin"],
                    "boundsMax": stats["boundsMax"],
                }
            )
        except PlyError as exc:
            facts["ok"] = False
            facts["error"] = str(exc)
    return facts


def validate_glb(path: Path) -> dict[str, Any]:
    """Validate the GLB container header and JSON chunk."""
    if not path.is_file():
        return {"ok": False, "error": "file missing"}
    size = path.stat().st_size
    with path.open("rb") as handle:
        header = handle.read(12)
        if len(header) < 12 or header[:4] != b"glTF":
            return {"ok": False, "error": "not a GLB file (missing glTF magic)", "bytes": size}
        version = int.from_bytes(header[4:8], "little")
        declared = int.from_bytes(header[8:12], "little")
        if declared != size:
            return {
                "ok": False,
                "error": f"GLB length mismatch: header says {declared}, file is {size}",
                "bytes": size,
            }
        chunk_length = int.from_bytes(handle.read(4), "little")
        chunk_type = handle.read(4)
        if chunk_type != b"JSON":
            return {"ok": False, "error": "first GLB chunk is not JSON", "bytes": size}
        payload = handle.read(chunk_length)
    import json

    try:
        gltf = json.loads(payload.decode("utf-8").rstrip("\x00 "))
    except ValueError as exc:
        return {"ok": False, "error": f"invalid GLB JSON chunk: {exc}", "bytes": size}

    meshes = gltf.get("meshes", [])
    primitives = sum(len(mesh.get("primitives", [])) for mesh in meshes)
    if not meshes or primitives == 0:
        return {"ok": False, "error": "GLB contains no mesh primitives", "bytes": size}
    return {
        "ok": True,
        "kind": "glb",
        "bytes": size,
        "version": version,
        "meshes": len(meshes),
        "primitives": primitives,
        "materials": len(gltf.get("materials", [])),
        "nodes": len(gltf.get("nodes", [])),
    }
