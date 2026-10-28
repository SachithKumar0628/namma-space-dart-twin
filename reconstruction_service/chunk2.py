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
    """Run OpenCV SfM on `images` and export a PLY point cloud.

    Returns a stats dict compatible with the FastAPI service contract. Every
    number below is computed from real photogrammetric output, never invented.
    """
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
    all_points = pts3d
    all_colors = colors

    registered: dict[int, tuple[np.ndarray, np.ndarray]] = {0: (R1, t1), 1: (R2, t2)}
    log(f"Triangulated {pts3d.shape[0]} initial points")
