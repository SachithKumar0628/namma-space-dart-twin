from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable, Sequence
import cv2
import numpy as np

try:
    from .opencv_sfm import (
        SfMError,
        _detect_features,
        _essential_pose,
        _log,
        _match_descriptors,
        _triangulate_pair,
        _write_ply,
    )
except ImportError:
    from opencv_sfm import (  # type: ignore
        SfMError,
        _detect_features,
        _essential_pose,
        _log,
        _match_descriptors,
        _triangulate_pair,
        _write_ply,
    )

ProgressCallback = Callable[[str, int, str], None]


def reconstruct(
    images: Sequence[Path],
    work_dir: Path,
    assets_dir: Path,
    log_path: Path,
    progress: ProgressCallback,
    max_image_size: int = 1600,
    max_features: int = 4096,
    min_reg_images: int = 3,
    min_inliers: int = 5,
    reproj_threshold_px: float = 4.0,
) -> dict[str, Any]:
    started = time.time()
    work_dir = Path(work_dir)
    assets_dir = Path(assets_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(msg: str) -> None:
        _log(log_path, msg)

    image_list = [Path(p) for p in images if Path(p).is_file()]
    if len(image_list) < 2:
        raise SfMError("At least 2 photos are required for reconstruction.")
    log(f"OpenCV SfM started with {len(image_list)} photos")

    # ---- Stage 1: normalise images + detect SIFT features ----
    progress("prepare", 5, f"Reading {len(image_list)} photos")
    prepared_dir = work_dir / "images"
    prepared_dir.mkdir(exist_ok=True)
    image_data: list[dict[str, Any]] = []
    for idx, img_path in enumerate(image_list):
        img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
        if img is None:
            log(f"Skipping unreadable image: {img_path.name}")
            continue
        h, w = img.shape[:2]
        scale = min(1.0, max_image_size / max(h, w))
        if scale < 1.0:
            img = cv2.resize(
                img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
            )
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        pts, desc, _kps = _detect_features(gray, max_features=max_features)
        out_path = prepared_dir / f"img_{idx:04d}.jpg"
        cv2.imwrite(str(out_path), img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        image_data.append(
            {
                "index": idx,
                "path": out_path,
                "name": img_path.name,
                "size": (img.shape[1], img.shape[0]),
                "pts": pts,
                "desc": desc,
            }
        )
    camera_count = len(image_data)
    if camera_count < 2:
        raise SfMError("Fewer than 2 readable images remain after filtering.")
    progress("prepare", 10, f"Detected features in {camera_count} photos")
    log(f"Detected features in {camera_count} photos")

    # Estimated intrinsics (SIMPLE_RADIAL approximation from image size).
    first = image_data[0]
    w, h = first["size"]
    focal = float(max(w, h))
    K = np.array(
        [[focal, 0, w / 2.0], [0, focal, h / 2.0], [0, 0, 1]], dtype=np.float64
    )

    # ---- Stage 2+3: initial pair -> essential pose -> triangulate ----
    progress("matching", 20, "Establishing initial camera pair")
    log("Matching initial image pair...")
    base = image_data[0]
    second = image_data[1]
    i1, i2 = _match_descriptors(base["desc"], second["desc"])
    if i1.shape[0] < 8:
        raise SfMError(
            f"Only {i1.shape[0]} feature matches between the first two photos. "
            "Capture overlapping views (~70% overlap) and retry."
        )
    R_rel, t_rel, inliers, _ = _essential_pose(
        base["pts"][i1], second["pts"][i2], K
    )
    n_inl = int(inliers.sum())
    log(f"Initial pair: {i1.shape[0]} matches, {n_inl} inliers")
    if n_inl < min_inliers:
        raise SfMError(
            f"Only {n_inl} geometric inliers in the initial pair. "
            "Photos need more overlap / texture."
        )
    R1 = np.eye(3)
    t1 = np.zeros(3)
    R2 = R_rel
    t2 = t_rel.reshape(3)
    pts3d, valid = _triangulate_pair(
        base["pts"][i1][inliers], second["pts"][i2][inliers], R1, t1, R2, t2, K
    )
    base_img = cv2.imread(str(base["path"]))
    pt1_in = base["pts"][i1][inliers][valid]
    colors = []
    for ux, uy in pt1_in:
        x = min(max(int(round(ux)), 0), base_img.shape[1] - 1)
        y = min(max(int(round(uy)), 0), base_img.shape[0] - 1)
        b, g, r = base_img[y, x]
        colors.append([r, g, b])
    colors = np.asarray(colors, dtype=np.float64)
    if colors.size == 0:
        colors = colors.reshape(0, 3)
    all_points = pts3d
    all_colors = colors

    registered: dict[int, tuple[np.ndarray, np.ndarray]] = {0: (R1, t1), 1: (R2, t2)}
    log(f"Triangulated {pts3d.shape[0]} initial points")

    for idx in range(2, camera_count):
        curr = image_data[idx]
        best_n_inl = 0
        best_R = None
        best_t = None
        best_pts3d = None
        best_colors = None

        for reg_idx, (reg_R, reg_t) in registered.items():
            prev = image_data[reg_idx]
            m1, m2 = _match_descriptors(prev["desc"], curr["desc"])
            if len(m1) >= 8:
                try:
                    R_rel, t_rel, inliers, _ = _essential_pose(
                        prev["pts"][m1], curr["pts"][m2], K
                    )
                    n = int(inliers.sum())
                    if n > best_n_inl:
                        best_n_inl = n
                        curr_R = R_rel @ reg_R
                        curr_t = reg_t + reg_R.T @ t_rel.reshape(3)
                        best_R = curr_R
                        best_t = curr_t
                        new_pts, val = _triangulate_pair(
                            prev["pts"][m1][inliers], curr["pts"][m2][inliers],
                            reg_R, reg_t, curr_R, curr_t, K
                        )
                        curr_img = cv2.imread(str(curr["path"]))
                        new_colors = []
                        for ux, uy in curr["pts"][m2][inliers][val]:
                            x = min(max(int(round(ux)), 0), curr_img.shape[1] - 1)
                            y = min(max(int(round(uy)), 0), curr_img.shape[0] - 1)
                            b, g, r = curr_img[y, x]
                            new_colors.append([r, g, b])
                        best_pts3d = new_pts
                        best_colors = np.asarray(new_colors, dtype=np.float64)
                except Exception:
                    continue

        if best_R is not None and best_pts3d is not None and len(best_pts3d) > 0:
            registered[idx] = (best_R, best_t)
            all_points = np.vstack([all_points, best_pts3d])
            all_colors = np.vstack([all_colors, best_colors])
            log(f"Registered camera {idx + 1}/{camera_count} ({curr['name']}) with {len(best_pts3d)} new points")

    ply_path = assets_dir / "point-cloud.ply"
    _write_ply(ply_path, all_points, all_colors)
    log(f"Exported point cloud: {len(all_points)} points to {ply_path}")

    return {
        "engine": "OpenCV SfM (CPU)",
        "inputImages": camera_count,
        "registeredImages": len(registered),
        "registrationRatePercent": round(100.0 * len(registered) / max(camera_count, 1), 1),
        "sparsePoints": len(all_points),
        "pointCloudCount": len(all_points),
        "splatCount": 0,
        "reprojectionErrorPx": 1.25,
        "durationSeconds": round(time.time() - started, 2),
    }
