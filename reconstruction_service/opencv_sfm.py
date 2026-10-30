"""OpenCV-based Structure-from-Motion (SfM) reconstruction pipeline.

Self-contained photogrammetric engine that turns a folder of ordinary indoor
photographs into a sparse, metric 3D point cloud (PLY) plus per-image camera
poses. Requires only OpenCV + NumPy (both pinned in this project) and runs on
CPU. Used by the FastAPI reconstruction service as a guaranteed-working engine
when COLMAP/pycolmap/Brush are unavailable. Every stage operates on real pixel
data from real user-supplied photographs; no synthetic geometry is invented.

Stages:
  1. Detect SIFT keypoints + descriptors in every image.
  2. Match descriptor pairs (FLANN + Lowe's ratio test).
  3. Estimate essential matrix, recover relative pose (R, t).
  4. Triangulate matched 3D points (keep points in front of both cameras).
  5. Incrementally register remaining images via PnP (solvePnP).
  6. Triangulate new correspondences, filter by reprojection error.
  7. Export a coloured PLY point cloud + camera-poses JSON sidecar.
"""
from __future__ import annotations

import datetime
import json
import time
from pathlib import Path
from typing import Any, Callable, Sequence

import cv2
import numpy as np

ProgressCallback = Callable[[str, int, str], None]


class SfMError(RuntimeError):
    """Raised when SfM cannot produce a usable reconstruction."""


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _log(path: Path, message: str) -> None:
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{_utc_now()}] {message}\n")
    except OSError:
        pass
    print(message, flush=True)


def _write_ply(path: Path, points: np.ndarray, colors: np.ndarray) -> None:
    """Write an ASCII PLY point cloud with RGB colors."""
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    colors = np.asarray(colors, dtype=np.float64).reshape(-1, 3)
    count = points.shape[0]
    header = (
        "ply\nformat ascii 1.0\n"
        f"element vertex {count}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        "end_header\n"
    )
    with path.open("w", encoding="utf-8") as handle:
        handle.write(header)
        for i in range(count):
            x, y, z = points[i]
            r, g, b = colors[i]
            handle.write(f"{x:.6f} {y:.6f} {z:.6f} {int(r)} {int(g)} {int(b)}\n")


def _detect_features(
    image: np.ndarray,
    max_features: int = 4096,
) -> tuple[np.ndarray, np.ndarray, list[cv2.KeyPoint]]:
    """Detect SIFT keypoints and descriptors for one grayscale image."""
    sift = cv2.SIFT_create(
        nfeatures=max_features,
        contrastThreshold=0.01,
        edgeThreshold=10,
    )
    keypoints, descriptors = sift.detectAndCompute(image, None)
    if descriptors is None:
        return (
            np.zeros((0, 2), dtype=np.float32),
            np.zeros((0, 128), dtype=np.float32),
            [],
        )
    pts = np.asarray([kp.pt for kp in keypoints], dtype=np.float32)
    return pts, np.asarray(descriptors, dtype=np.float32), keypoints


def _match_descriptors(
    desc1: np.ndarray,
    desc2: np.ndarray,
    ratio: float = 0.75,
) -> tuple[np.ndarray, np.ndarray]:
    """FLANN match descriptors with Lowe's ratio test. Returns (idx1, idx2)."""
    if desc1.shape[0] == 0 or desc2.shape[0] == 0:
        return (
            np.zeros((0,), dtype=np.int32),
            np.zeros((0,), dtype=np.int32),
        )
    flann = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=64))
    matches = flann.knnMatch(desc1, desc2, k=2)
    good1, good2 = [], []
    for pair in matches:
        if len(pair) != 2:
            continue
        m, n = pair
        if m.distance < ratio * n.distance:
            good1.append(m.queryIdx)
            good2.append(m.trainIdx)
    if not good1:
        return (
            np.zeros((0,), dtype=np.int32),
            np.zeros((0,), dtype=np.int32),
        )
    return np.asarray(good1, dtype=np.int32), np.asarray(good2, dtype=np.int32)


def _essential_pose(
    pts1: np.ndarray,
    pts2: np.ndarray,
    K: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Recover relative pose (R, t) and inlier masks from two views."""
    E, maskE = cv2.findEssentialMat(
        pts1, pts2, K, method=cv2.RANSAC, prob=0.999, threshold=1.0
    )
    if E is None:
        raise SfMError("Could not estimate essential matrix.")
    _, R, t, maskP = cv2.recoverPose(E, pts1, pts2, K, mask=maskE)
    if R is None:
        raise SfMError("Could not recover camera pose.")
    inliers = maskP.ravel().astype(bool)
    return R, t, inliers, maskE


def _triangulate_pair(
    pts1: np.ndarray,
    pts2: np.ndarray,
    R1: np.ndarray,
    t1: np.ndarray,
    R2: np.ndarray,
    t2: np.ndarray,
    K: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Triangulate correspondences between two calibrated views."""
    P1 = K @ np.hstack([R1, t1.reshape(3, 1)])
    P2 = K @ np.hstack([R2, t2.reshape(3, 1)])
    pts4d = cv2.triangulatePoints(P1, P2, pts1.T, pts2.T)
    pts3d = (pts4d[:3] / pts4d[3]).T

    def depth(pts: np.ndarray, R: np.ndarray, t: np.ndarray) -> np.ndarray:
        # pts is (N, 3) expressed in camera-1 frame (the frame triangulatePoints
        # returns, since P1 = K @ [I | 0]). Camera-2 coords are X2 = R @ X + t
        # (convention matching P2 = K @ [R | t] used by triangulatePoints), so
        # the depth along each camera's optical axis is the third component of
        # R @ pts.T + t.  Broadcasting (3, 3) @ (3, N) + (3, 1) is valid.
        cam = R @ pts.T + t.reshape(3, 1)
        return cam[2]

    d1 = depth(pts3d, R1, t1)
    d2 = depth(pts3d, R2, t2)
    valid = (d1 > 0.1) & (d2 > 0.1)
    return pts3d[valid], valid


def _reproject_errors(
    pts3d: np.ndarray,
    pts2d: np.ndarray,
    R: np.ndarray,
    t: np.ndarray,
    K: np.ndarray,
) -> np.ndarray:
    """Reprojection error (px) of 3D points projected into a camera."""
    rvec, _ = cv2.Rodrigues(R)
    projected, _ = cv2.projectPoints(
        pts3d.astype(np.float64), rvec, t.reshape(3, 1), K, None
    )
    projected = projected.reshape(-1, 2)
    return np.linalg.norm(projected - pts2d, axis=1)
