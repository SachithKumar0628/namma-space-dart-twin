"""
3D Gaussian Splatting training and PLY-to-.splat conversion module.

Orchestrates the training subprocess and converts the resulting PLY point cloud
into the compact binary .splat format consumed by web viewers.
"""

from __future__ import annotations

import math
import struct
import subprocess
import sys
from pathlib import Path
from typing import Callable

import numpy as np

# Spherical-harmonics C0 constant (band 0, order 0)
SH_C0: float = 0.28209479177387814


# ---------------------------------------------------------------------------
# PLY reader – self-contained, handles standard 3DGS output
# ---------------------------------------------------------------------------

def _read_ply(ply_path: Path) -> dict[str, np.ndarray]:
    """Parse a binary-little-endian PLY produced by 3D Gaussian Splatting."""
    with open(ply_path, "rb") as fh:
        header_lines: list[str] = []
        while True:
            raw_line = fh.readline()
            line = raw_line.decode("ascii", errors="replace").strip()
            header_lines.append(line)
            if line == "end_header":
                break

        vertex_count = 0
        properties: list[tuple[str, str]] = []
        in_vertex_element = False

        for line in header_lines:
            parts = line.split()
            if len(parts) >= 3 and parts[0] == "element" and parts[1] == "vertex":
                vertex_count = int(parts[2])
                in_vertex_element = True
                continue
            if parts[0] == "element" and parts[1] != "vertex":
                in_vertex_element = False
                continue
            if in_vertex_element and parts[0] == "property":
                dtype_str = parts[1]
                prop_name = parts[2]
                properties.append((dtype_str, prop_name))

        if vertex_count == 0:
            raise ValueError(f"PLY file {ply_path} contains 0 vertices.")

        ply_to_np = {
            "float": "f4",
            "float32": "f4",
            "double": "f8",
            "float64": "f8",
            "uchar": "u1",
            "uint8": "u1",
            "int": "i4",
            "int32": "i4",
            "uint": "u4",
            "uint32": "u4",
            "short": "i2",
            "int16": "i2",
            "ushort": "u2",
            "uint16": "u2",
        }

        np_dtype = np.dtype(
            [(name, ply_to_np.get(dt, "f4")) for dt, name in properties]
        )

        raw = np.frombuffer(fh.read(vertex_count * np_dtype.itemsize), dtype=np_dtype)

    data: dict[str, np.ndarray] = {}
    for _, name in properties:
        data[name] = raw[name].astype(np.float32)

    return data


# ---------------------------------------------------------------------------
# PLY → .splat converter
# ---------------------------------------------------------------------------

def convert_ply_to_splat(ply_path: Path, splat_path: Path) -> None:
    """Convert a 3DGS PLY point cloud to the compact binary *.splat* format.

    The .splat format packs each Gaussian into 32 bytes::

        3 × float32  position  (x, y, z)          — 12 bytes
        3 × float32  scale     (sx, sy, sz)        — 12 bytes
        4 × uint8    colour    (r, g, b, a)        —  4 bytes
        4 × uint8    rotation  (qw, qx, qy, qz)   —  4 bytes
                                                  --------
                                              total  32 bytes
    """
    data = _read_ply(ply_path)

    n = len(data["x"])

    px = data["x"]
    py = data["y"]
    pz = data["z"]

    sx_raw = data.get("scale_0", np.zeros(n, dtype=np.float32))
    sy_raw = data.get("scale_1", np.zeros(n, dtype=np.float32))
    sz_raw = data.get("scale_2", np.zeros(n, dtype=np.float32))
    sx = np.exp(sx_raw).astype(np.float32)
    sy = np.exp(sy_raw).astype(np.float32)
    sz = np.exp(sz_raw).astype(np.float32)

    qw = data.get("rot_0", np.ones(n, dtype=np.float32))
    qx = data.get("rot_1", np.zeros(n, dtype=np.float32))
    qy = data.get("rot_2", np.zeros(n, dtype=np.float32))
    qz = data.get("rot_3", np.zeros(n, dtype=np.float32))

    f_dc_0 = data.get("f_dc_0", np.full(n, 0.5, dtype=np.float32))
    f_dc_1 = data.get("f_dc_1", np.full(n, 0.5, dtype=np.float32))
    f_dc_2 = data.get("f_dc_2", np.full(n, 0.5, dtype=np.float32))

    r = np.clip((0.5 + SH_C0 * f_dc_0) * 255.0, 0.0, 255.0).astype(np.uint8)
    g = np.clip((0.5 + SH_C0 * f_dc_1) * 255.0, 0.0, 255.0).astype(np.uint8)
    b = np.clip((0.5 + SH_C0 * f_dc_2) * 255.0, 0.0, 255.0).astype(np.uint8)

    opacity_raw = data.get("opacity", np.zeros(n, dtype=np.float32))
    alpha = np.clip(
        (1.0 / (1.0 + np.exp(-opacity_raw))) * 255.0, 0.0, 255.0
    ).astype(np.uint8)

    q_norm = np.sqrt(qw ** 2 + qx ** 2 + qy ** 2 + qz ** 2 + 1e-12)
    qw /= q_norm
    qx /= q_norm
    qy /= q_norm
    qz /= q_norm

    def _q_to_u8(q: np.ndarray) -> np.ndarray:
        return np.clip(np.round(q * 128.0 + 128.0), 0, 255).astype(np.uint8)

    qw_u8 = _q_to_u8(qw)
    qx_u8 = _q_to_u8(qx)
    qy_u8 = _q_to_u8(qy)
    qz_u8 = _q_to_u8(qz)

    splat_path.parent.mkdir(parents=True, exist_ok=True)

    splat_dtype = np.dtype(
        [
            ("px", "<f4"), ("py", "<f4"), ("pz", "<f4"),
            ("sx", "<f4"), ("sy", "<f4"), ("sz", "<f4"),
            ("r", "u1"), ("g", "u1"), ("b", "u1"), ("a", "u1"),
            ("qw", "u1"), ("qx", "u1"), ("qy", "u1"), ("qz", "u1"),
        ]
    )

    out = np.empty(n, dtype=splat_dtype)
    out["px"] = px
    out["py"] = py
    out["pz"] = pz
    out["sx"] = sx
    out["sy"] = sy
    out["sz"] = sz
    out["r"] = r
    out["g"] = g
    out["b"] = b
    out["a"] = alpha
    out["qw"] = qw_u8
    out["qx"] = qx_u8
    out["qy"] = qy_u8
    out["qz"] = qz_u8

    out.tofile(str(splat_path))


# ---------------------------------------------------------------------------
# Training driver
# ---------------------------------------------------------------------------

def _stream_process(
    cmd: list[str],
    log_callback: Callable[[str], None],
    step_name: str,
) -> None:
    """Run a subprocess and stream its output line-by-line."""
    log_callback(f"[TRAIN] Starting: {step_name}")
    log_callback(f"[TRAIN] Command: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert process.stdout is not None
    for line in process.stdout:
        stripped = line.rstrip("\n\r")
        if stripped:
            log_callback(f"[TRAIN] {stripped}")

    return_code = process.wait()
    if return_code != 0:
        msg = f"{step_name} failed with exit code {return_code}"
        log_callback(f"[TRAIN][ERROR] {msg}")
        raise RuntimeError(msg)

    log_callback(f"[TRAIN] Completed: {step_name}")


def _find_latest_ply(output_dir: Path) -> Path:
    """Locate the highest-iteration point_cloud.ply under *output_dir*."""
    pc_root = output_dir / "point_cloud"
    if not pc_root.exists():
        raise FileNotFoundError(
            f"No point_cloud directory found at {pc_root}"
        )

    iteration_dirs = sorted(
        [d for d in pc_root.iterdir() if d.is_dir() and d.name.startswith("iteration_")],
        key=lambda p: int(p.name.split("_")[-1]),
    )

    if not iteration_dirs:
        raise FileNotFoundError("No iteration_* directories found in point_cloud/")

    ply_path = iteration_dirs[-1] / "point_cloud.ply"
    if not ply_path.exists():
        raise FileNotFoundError(f"PLY file not found at {ply_path}")

    return ply_path


def convert_colmap_to_splat(
    sparse_dir: Path,
    splat_path: Path,
    log_callback: Callable[[str], None] | None = None,
) -> Path:
    """Synthesize a compact 32-byte .splat model directly from COLMAP points3D."""
    bin_path = sparse_dir / "points3D.bin"
    txt_path = sparse_dir / "points3D.txt"

    positions: list[tuple[float, float, float]] = []
    colors: list[tuple[int, int, int]] = []

    if bin_path.exists():
        with open(bin_path, "rb") as fh:
            num_points_raw = fh.read(8)
            if len(num_points_raw) >= 8:
                (num_points,) = struct.unpack("<Q", num_points_raw)
                for _ in range(num_points):
                    fh.read(8)  # point3D_id
                    xyz = struct.unpack("<3d", fh.read(24))
                    rgb = struct.unpack("<3B", fh.read(3))
                    fh.read(8)  # error
                    (track_len,) = struct.unpack("<Q", fh.read(8))
                    fh.read(track_len * 8)
                    positions.append(xyz)
                    colors.append(rgb)
    elif txt_path.exists():
        with open(txt_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) >= 7:
                    positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
                    colors.append((int(parts[4]), int(parts[5]), int(parts[6])))

    if not positions:
        raise ValueError(f"No 3D points found in {sparse_dir}")

    pts = np.array(positions, dtype=np.float32)
    cols = np.array(colors, dtype=np.uint8)
    n = len(pts)

    if log_callback:
        log_callback(f"[TRAIN] Converting {n} COLMAP points into 3D Gaussian Splats...")

    extent = pts.max(axis=0) - pts.min(axis=0)
    diag = float(np.linalg.norm(extent))
    scale_val = max(0.015, min(0.08, diag / (n ** (1/3) * 5.0) if n > 0 else 0.04))

    splat_dtype = np.dtype(
        [
            ("px", "<f4"), ("py", "<f4"), ("pz", "<f4"),
            ("sx", "<f4"), ("sy", "<f4"), ("sz", "<f4"),
            ("r", "u1"), ("g", "u1"), ("b", "u1"), ("a", "u1"),
            ("qw", "u1"), ("qx", "u1"), ("qy", "u1"), ("qz", "u1"),
        ]
    )

    out = np.empty(n, dtype=splat_dtype)
    out["px"] = pts[:, 0]
    out["py"] = pts[:, 1]
    out["pz"] = pts[:, 2]
    out["sx"] = scale_val
    out["sy"] = scale_val
    out["sz"] = scale_val
    out["r"] = cols[:, 0]
    out["g"] = cols[:, 1]
    out["b"] = cols[:, 2]
    out["a"] = 245
    out["qw"] = 255
    out["qx"] = 128
    out["qy"] = 128
    out["qz"] = 128

    splat_path.parent.mkdir(parents=True, exist_ok=True)
    out.tofile(str(splat_path))
    return splat_path


def train_gaussians(
    sparse_dir: Path,
    output_dir: Path,
    iterations: int,
    log_callback: Callable[[str], None],
) -> Path:
    """Run 3D Gaussian Splatting training or synthesize splat from sparse point cloud."""
    output_dir.mkdir(parents=True, exist_ok=True)

    python_exe = sys.executable
    source_dir = sparse_dir.parent

    candidate_roots = [
        Path("gaussian-splatting"),
        Path.home() / "gaussian-splatting",
        Path("/opt/gaussian-splatting"),
        Path("gaussian_splatting"),
    ]

    train_script: Path | None = None
    for root in candidate_roots:
        candidate = root / "train.py"
        if candidate.exists():
            train_script = candidate
            break

    if train_script is not None:
        try:
            log_callback(f"[TRAIN] Running 3DGS training script: {train_script}")
            _stream_process(
                [
                    python_exe,
                    str(train_script),
                    "-s", str(source_dir),
                    "-m", str(output_dir),
                    "--iterations", str(iterations),
                ],
                log_callback,
                "train.py",
            )
            ply_path = _find_latest_ply(output_dir)
            log_callback(f"[TRAIN] Found trained PLY: {ply_path}")
            splat_path = output_dir / "model.splat"
            log_callback("[TRAIN] Converting PLY → .splat …")
            convert_ply_to_splat(ply_path, splat_path)
            log_callback(f"[TRAIN] Saved .splat: {splat_path}")
            return splat_path
        except Exception as exc:
            log_callback(f"[TRAIN][WARN] 3DGS training script error: {exc}")
            log_callback("[TRAIN][INFO] Falling back to direct Gaussian Splat synthesis from COLMAP point cloud...")

    splat_path = output_dir / "model.splat"
    convert_colmap_to_splat(sparse_dir, splat_path, log_callback)
    log_callback(f"[TRAIN] Successfully generated 3D Gaussian Splat model: {splat_path}")
    return splat_path
