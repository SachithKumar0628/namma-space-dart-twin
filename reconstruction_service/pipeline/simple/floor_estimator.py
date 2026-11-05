"""
Floor / ground-plane estimator from COLMAP sparse point clouds.

Uses RANSAC to fit a dominant horizontal plane and computes floor-level
metadata including bounding box and plane equation.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np


def _read_points3d_binary(bin_path: Path) -> np.ndarray:
    """Read COLMAP ``points3D.bin`` and return an Nx3 float64 array of XYZ positions."""
    points: list[tuple[float, float, float]] = []

    with open(bin_path, "rb") as fh:
        num_points_raw = fh.read(8)
        if len(num_points_raw) < 8:
            return np.empty((0, 3), dtype=np.float64)

        (num_points,) = struct.unpack("<Q", num_points_raw)

        for _ in range(num_points):
            fh.read(8)  # point3D_id
            xyz_raw = fh.read(24)
            x, y, z = struct.unpack("<3d", xyz_raw)
            points.append((x, y, z))
            fh.read(3)  # rgb
            fh.read(8)  # error
            track_len_raw = fh.read(8)
            (track_length,) = struct.unpack("<Q", track_len_raw)
            fh.read(track_length * 8)  # track

    return np.array(points, dtype=np.float64)


def _read_points3d_text(txt_path: Path) -> np.ndarray:
    """Read COLMAP ``points3D.txt`` and return an Nx3 float64 array."""
    points: list[tuple[float, float, float]] = []

    with open(txt_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
            points.append((x, y, z))

    return np.array(points, dtype=np.float64) if points else np.empty((0, 3), dtype=np.float64)


def _load_points3d(sparse_dir: Path) -> np.ndarray:
    """Load 3D points from the COLMAP sparse directory (binary preferred)."""
    bin_path = sparse_dir / "points3D.bin"
    txt_path = sparse_dir / "points3D.txt"

    if bin_path.exists():
        return _read_points3d_binary(bin_path)
    if txt_path.exists():
        return _read_points3d_text(txt_path)

    raise FileNotFoundError(
        f"Neither points3D.bin nor points3D.txt found in {sparse_dir}"
    )


def _fit_plane_ransac(
    points: np.ndarray,
    threshold: float = 0.05,
    max_iterations: int = 1000,
    rng_seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """Fit a plane to *points* using RANSAC."""
    rng = np.random.default_rng(rng_seed)
    n = len(points)

    best_inlier_count = 0
    best_plane = np.array([0.0, 1.0, 0.0, 0.0])
    best_mask = np.zeros(n, dtype=bool)

    for _ in range(max_iterations):
        idx = rng.choice(n, size=3, replace=False)
        p1, p2, p3 = points[idx]

        v1 = p2 - p1
        v2 = p3 - p1
        normal = np.cross(v1, v2)
        norm_len = np.linalg.norm(normal)
        if norm_len < 1e-12:
            continue
        normal /= norm_len

        if abs(normal[1]) < 0.7:
            continue

        if normal[1] < 0:
            normal = -normal

        d = -np.dot(normal, p1)

        distances = np.abs(points @ normal + d)
        mask = distances < threshold
        inlier_count = int(mask.sum())

        if inlier_count > best_inlier_count:
            best_inlier_count = inlier_count
            best_plane = np.array([normal[0], normal[1], normal[2], d])
            best_mask = mask

    return best_plane, best_mask


def estimate_floor(sparse_dir: Path) -> dict:
    """Estimate the ground plane from COLMAP sparse reconstruction points."""
    points = _load_points3d(sparse_dir)

    if len(points) < 3:
        return {
            "plane": [0.0, 1.0, 0.0, 0.0],
            "floor_y": 0.0,
            "bounds": {"x_min": 0.0, "x_max": 0.0, "z_min": 0.0, "z_max": 0.0},
        }

    plane, inlier_mask = _fit_plane_ransac(points)

    inlier_points = points[inlier_mask]

    if len(inlier_points) == 0:
        floor_y = float(np.median(points[:, 1]))
        return {
            "plane": plane.tolist(),
            "floor_y": floor_y,
            "bounds": {
                "x_min": float(points[:, 0].min()),
                "x_max": float(points[:, 0].max()),
                "z_min": float(points[:, 2].min()),
                "z_max": float(points[:, 2].max()),
            },
        }

    floor_y = float(inlier_points[:, 1].mean())

    bounds = {
        "x_min": float(inlier_points[:, 0].min()),
        "x_max": float(inlier_points[:, 0].max()),
        "z_min": float(inlier_points[:, 2].min()),
        "z_max": float(inlier_points[:, 2].max()),
    }

    return {
        "plane": plane.tolist(),
        "floor_y": floor_y,
        "bounds": bounds,
    }
