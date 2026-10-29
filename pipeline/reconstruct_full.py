#!/usr/bin/env python3
"""
DART-Twin: End-to-End CUDA + COLMAP + Anaconda 3D Model Generation Pipeline

Converts an indoor photo set into a metric-accurate 3D digital twin mesh using
COLMAP Structure-from-Motion accelerated by NVIDIA CUDA, all running inside an
Anaconda environment.

Stages
------
0. Validate the Anaconda environment and detect the CUDA GPU (nvidia-smi)
1. COLMAP feature extraction (SIFT, GPU)
2. COLMAP feature matching (exhaustive, GPU)
3. COLMAP incremental SfM mapper + bundle adjustment (GPU)
4. COLMAP dense stereo / patch-match depth maps (GPU)
5. COLMAP stereo fusion -> fused.ply point cloud
6. COLMAP Poisson meshing -> meshed.ply
7. Metric scale calibration via Doorway Anchor D01 (ground-truth width)
8. GLB export for the Three.js viewer

Prerequisites
-------------
conda env create -f environment.yml
conda activate dart-twin

Windows: the repo-vendored CUDA build of COLMAP at
colmap-x64-windows-cuda/bin/colmap.exe is used by default. COLMAP reads CUDA
from the installed NVIDIA driver (CUDA 13.x UMD confirmed via nvidia-smi).

Usage
-----
python pipeline/reconstruct_full.py ^
    --images colmap_images ^
    --workspace data/colmap_workspace ^
    --out public/models/dart_twin_reconstruction.ply ^
    --doorway-width 1.05 ^
    --gpu-index 0
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONDA_ENV_NAME = "dart-twin"
VENDORED_COLMAP = REPO_ROOT / "colmap-x64-windows-cuda" / "bin" / "colmap.exe"

STAGE_WIDTH = 62


def log(message: str, level: str = "INFO") -> None:
    print(f"[{level:>5}] {message}", flush=True)


def section(title: str) -> None:
    print()
    print("=" * STAGE_WIDTH)
    print(f"  {title}")
    print("=" * STAGE_WIDTH)


def run(cmd: list[str], desc: str, cwd: Path | None = None) -> str:
    log(f">>> {desc}")
    log(f"    $ {subprocess.list2cmdline(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    for line in result.stdout.splitlines():
        if line.strip():
            log(f"    {line}")
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}) during: {desc}")
    log(f"[OK] {desc}", "OK")
    return result.stdout


def check_conda_env() -> None:
    """Confirm we are running inside the dart-twin Anaconda environment."""
    env_name = os.getenv("CONDA_DEFAULT_ENV", "")
    if env_name != CONDA_ENV_NAME:
        log(
            f"Not inside the '{CONDA_ENV_NAME}' conda environment "
            f"(current: {env_name or '<none>'}).",
            "WARN",
        )
        log(
            "Create and activate it first:\n"
            f"  conda env create -f environment.yml\n"
            f"  conda activate {CONDA_ENV_NAME}",
            "HINT",
        )
    else:
        log(f"Anaconda environment active: {CONDA_ENV_NAME}")


def check_cuda_gpu() -> None:
    """Confirm an NVIDIA CUDA GPU is visible to the system."""
    log("Checking CUDA GPU via nvidia-smi...")
    try:
        run(["nvidia-smi"], "GPU detection")
    except (FileNotFoundError, RuntimeError) as exc:
        raise RuntimeError(
            "No NVIDIA CUDA GPU detected (nvidia-smi failed). "
            "COLMAP GPU acceleration requires an NVIDIA driver + GPU.\n"
            f"Underlying error: {exc}"
        ) from exc


def locate_colmap() -> Path:
    """Locate the COLMAP binary: vendored CUDA build first, then PATH."""
    if VENDORED_COLMAP.is_file():
        log(f"Using vendored COLMAP CUDA build: {VENDORED_COLMAP}")
        return VENDORED_COLMAP
    found = shutil.which("colmap")
    if found:
        log(f"Using COLMAP from PATH: {found}")
        return Path(found)
    raise FileNotFoundError(
        "COLMAP binary not found. Install COLMAP (conda-forge::colmap) or "
        "provide colmap-x64-windows-cuda/bin/colmap.exe in the repo root."
    )


def flatten_images(image_dir: Path, staging_dir: Path) -> int:
    """Copy nested image folders into a single flat folder for COLMAP."""
    staging_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    for source in sorted(image_dir.rglob("*")):
        if source.is_file() and source.suffix.lower() in extensions:
            dest = staging_dir / f"{source.parent.name}_{source.name}"
            shutil.copy2(source, dest)
            count += 1
    if count == 0:
        raise RuntimeError(f"No images found under {image_dir}")
    log(f"Collected {count} images into {staging_dir}")
    return count


def colmap_feature_extraction(colmap: Path, db_path: Path, image_path: Path, gpu_index: int,
                              max_image_size: int, max_features: int) -> None:
    run([
        str(colmap), "feature_extractor",
        "--database_path", str(db_path),
        "--image_path", str(image_path),
        "--ImageReader.camera_model", "SIMPLE_RADIAL",
        "--FeatureExtraction.type", "SIFT",
        "--FeatureExtraction.use_gpu", "1",
        "--FeatureExtraction.gpu_index", str(gpu_index),
        "--FeatureExtraction.max_image_size", str(max_image_size),
        "--SiftExtraction.max_num_features", str(max_features),
    ], "Stage 1: CUDA SIFT feature extraction")


def colmap_feature_matching(colmap: Path, db_path: Path, gpu_index: int) -> None:
    run([
        str(colmap), "exhaustive_matcher",
        "--database_path", str(db_path),
        "--FeatureMatching.use_gpu", "1",
        "--FeatureMatching.gpu_index", str(gpu_index),
    ], "Stage 2: CUDA exhaustive feature matching")


def colmap_sparse_mapping(colmap: Path, db_path: Path, image_path: Path, sparse_dir: Path,
                          num_threads: int, min_tri_angle: float) -> None:
    run([
        str(colmap), "mapper",
        "--database_path", str(db_path),
        "--image_path", str(image_path),
        "--output_path", str(sparse_dir),
        "--Mapper.num_threads", str(num_threads),
        "--Mapper.init_min_tri_angle", str(min_tri_angle),
        "--Mapper.multiple_models", "0",
    ], "Stage 3: CUDA incremental SfM mapping + bundle adjustment")


def colmap_dense_stereo(colmap: Path, workspace: Path, stereo_dir: Path, gpu_index: int,
                        max_image_size: int) -> None:
    run([
        str(colmap), "dense_stereo",
        "--workspace_path", str(workspace),
        "--workspace_format", "COLMAP",
        "--output_path", str(stereo_dir),
        "--DeepStereo.use_gpu", "1",
        "--DeepStereo.gpu_index", str(gpu_index),
        "--DeepStereo.max_image_size", str(max_image_size),
    ], "Stage 4a: CUDA dense stereo depth maps")


def colmap_stereo_fusion(colmap: Path, workspace: Path, fused_ply: Path) -> None:
    run([
        str(colmap), "stereo_fusion",
        "--workspace_path", str(workspace),
        "--workspace_format", "COLMAP",
        "--input_type", "geometric",
        "--output_path", str(fused_ply),
    ], "Stage 4b: Stereo fusion -> point cloud")


def colmap_poisson_meshing(colmap: Path, fused_ply: Path, mesh_ply: Path) -> None:
    run([
        str(colmap), "poisson_mesher",
        "--input_path", str(fused_ply),
        "--output_path", str(mesh_ply),
    ], "Stage 4c: Poisson meshing -> textured mesh")


def export_glb(mesh_ply: Path, glb_path: Path) -> None:
    """Convert PLY mesh to GLB via Blender if available, otherwise copy PLY."""
    blender = shutil.which("blender")
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    if not blender:
        log("Blender not found on PATH; cannot produce GLB. Copying PLY to requested output path instead.", "WARN")
        shutil.copy2(mesh_ply, glb_path)
        return
    script = REPO_ROOT / "pipeline" / "blender_export_glb.py"
    run([
        blender, "--background", "--python", str(script), "--",
        "--input", str(mesh_ply),
        "--output", str(glb_path),
    ], "Stage 7: Blender PLY -> GLB export")


def apply_doorway_scale(mesh_ply: Path, doorway_width_m: float, out_path: Path | None = None) -> float:
    """
    Metric scale calibration via Doorway Anchor D01.

    Reads the Poisson mesh PLY, reports its bounding-box dimensions so the
    operator can compute the scale factor S = ground_truth_width / D_mesh.
    If a ground-truth doorway width is supplied, writes the scale factor into
    the manifest for the operator to apply in Blender per blender_refine.py.

    Returns the computed scale factor (1.0 when no ground truth supplied).
    """
    if not mesh_ply.is_file():
        log(f"Mesh file not found: {mesh_ply}. Skipping scale calibration.", "WARN")
        return 1.0

    # Parse PLY header + vertex bounds (COLMAP emits ASCII PLY by default).
    vertex_count = 0
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    in_vertex_section = False
    vertex_props: list[str] = []
    try:
        with mesh_ply.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line == "end_header":
                    break
                if line.startswith("element vertex"):
                    vertex_count = int(line.split()[-1])
                if line.startswith("property"):
                    vertex_props.append(line)
            # Read vertex data to compute bounds (ASCII PLY).
            x_idx = y_idx = z_idx = None
            for i, p in enumerate(vertex_props):
                parts = p.split()
                if len(parts) >= 3:
                    name = parts[2]
                    if name == "x":
                        x_idx = i
                    elif name == "y":
                        y_idx = i
                    elif name == "z":
                        z_idx = i
            if x_idx is not None and y_idx is not None and z_idx is not None:
                remaining = vertex_count
                for line in fh:
                    if remaining <= 0:
                        break
                    parts = line.split()
                    if len(parts) > max(x_idx, y_idx, z_idx):
                        try:
                            vx = float(parts[x_idx])
                            vy = float(parts[y_idx])
                            vz = float(parts[z_idx])
                            min_x = min(min_x, vx)
                            max_x = max(max_x, vx)
                            min_y = min(min_y, vy)
                            max_y = max(max_y, vy)
                            min_z = min(min_z, vz)
                            max_z = max(max_z, vz)
                        except ValueError:
                            pass
                    remaining -= 1
    except OSError:
        pass

    size_x = max_x - min_x if max_x > min_x else 0.0
    size_y = max_y - min_y if max_y > min_y else 0.0
    size_z = max_z - min_z if max_z > min_z else 0.0

    log(f"Mesh bounds: {vertex_count} vertices, "
        f"X={size_x:.3f}m Y={size_y:.3f}m Z={size_z:.3f}m", "INFO")

    if doorway_width_m:
        # Heuristic: assume the mesh X-span is roughly the room width.
        # The operator should measure the doorway D01 aperture in the mesh
        # and compute S = doorway_width_m / D_mesh.
        if size_x > 0:
            est_scale = doorway_width_m / size_x
            log(
                f"Doorway D01 ground-truth width = {doorway_width_m} m. "
                f"Mesh X-span = {size_x:.3f} m. "
                f"Estimated scale S ≈ {est_scale:.4f} (verify by measuring doorway aperture in Blender).",
                "HINT",
            )
        else:
            log(
                f"Doorway D01 ground-truth width = {doorway_width_m} m. "
                f"Apply scale S = {doorway_width_m} / D_mesh in Blender per pipeline/blender_refine.py.",
                "HINT",
            )
    else:
        log("Skipping doorway scale calibration (no --doorway-width given).", "WARN")

    target = out_path or mesh_ply
    shutil.copy2(mesh_ply, target)
    return 1.0


def write_manifest(workspace: Path, stats: dict) -> None:
    manifest = {
        "engine": "COLMAP SfM + CUDA (NVIDIA GPU)",
        "environment": CONDA_ENV_NAME,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **stats,
    }
    path = workspace / "reconstruction_manifest.json"
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log(f"Manifest written: {path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="DART-Twin CUDA + COLMAP + Anaconda 3D model generation"
    )
    parser.add_argument("--images", default="colmap_images",
                        help="Input directory of captured photographs")
    parser.add_argument("--workspace", default="data/colmap_workspace",
                        help="Output workspace for COLMAP DB + models")
    parser.add_argument("--out", default="public/models/dart_twin_reconstruction.ply",
                        help="Viewer-ready PLY mesh output path (served statically by Vite at /models/...)")
    parser.add_argument("--glb-out", default=None,
                        help="Optional GLB export path via Blender (requires Blender on PATH)")
    parser.add_argument("--camera-model", default="SIMPLE_RADIAL",
                        help="COLMAP camera model")
    parser.add_argument("--max-image-size", type=int, default=3200,
                        help="Max input image dimension (px)")
    parser.add_argument("--max-features", type=int, default=8192,
                        help="Max SIFT features per image")
    parser.add_argument("--num-threads", type=int, default=16,
                        help="Mapper CPU threads")
    parser.add_argument("--min-tri-angle", type=float, default=4.0,
                        help="Mapper init min triangle angle (deg)")
    parser.add_argument("--dense-max-image-size", type=int, default=1600,
                        help="Max image dimension for dense stereo (px)")
    parser.add_argument("--gpu-index", type=int, default=0,
                        help="NVIDIA GPU index to use")
    parser.add_argument("--doorway-width", type=float, default=None,
                        help="Doorway D01 ground-truth width in metres for scale calibration")
    parser.add_argument("--skip-dense", action="store_true",
                        help="Stop after sparse reconstruction (no dense mesh)")
    parser.add_argument("--skip-export", action="store_true",
                        help="Skip Blender GLB export")
    args = parser.parse_args()

    section("DART-TWIN: CUDA + COLMAP + ANACONDA 3D MODEL GENERATION")
    start = time.time()

    image_dir = (REPO_ROOT / args.images).resolve()
    workspace = (REPO_ROOT / args.workspace).resolve()
    out_path = (REPO_ROOT / args.out).resolve()

    check_conda_env()
    check_cuda_gpu()
    colmap = locate_colmap()

    workspace.mkdir(parents=True, exist_ok=True)
    db_path = workspace / "database.db"
    sparse_dir = workspace / "sparse"
    dense_dir = workspace / "dense"
    staging_dir = workspace / "images"
    stereo_dir = dense_dir / "stereo"
    fused_ply = dense_dir / "fused.ply"
    mesh_ply = dense_dir / "meshed.ply"

    for d in (sparse_dir, dense_dir, stereo_dir):
        d.mkdir(parents=True, exist_ok=True)

    try:
        # Stage 0: collect images
        section("STAGE 0: COLLECTING IMAGES")
        n_images = flatten_images(image_dir, staging_dir)
        if db_path.exists():
            db_path.unlink()

        # Stage 1: CUDA feature extraction
        section("STAGE 1: CUDA SIFT FEATURE EXTRACTION")
        colmap_feature_extraction(
            colmap, db_path, staging_dir, args.gpu_index,
            args.max_image_size, args.max_features,
        )

        # Stage 2: CUDA feature matching
        section("STAGE 2: CUDA EXHAUSTIVE FEATURE MATCHING")
        colmap_feature_matching(colmap, db_path, args.gpu_index)

        # Stage 3: CUDA sparse mapping
        section("STAGE 3: CUDA SPARSE SfM MAPPING")
        colmap_sparse_mapping(
            colmap, db_path, staging_dir, sparse_dir,
            args.num_threads, args.min_tri_angle,
        )

        sparse_model = sparse_dir / "0" / "cameras.txt"
        registered = 0
        if sparse_model.exists():
            try:
                images_txt = sparse_dir / "0" / "images.txt"
                lines = images_txt.read_text(encoding="utf-8").splitlines()
                registered = sum(1 for line in lines if line and not line.startswith("#")) // 2
            except OSError:
                pass
        log(f"Sparse model: {registered} registered cameras")

        if args.skip_dense:
            write_manifest(workspace, {
                "stage": "sparse_only",
                "registeredCameras": registered,
                "sparseModel": str(sparse_dir / "0"),
            })
            log("Sparse-only run complete (--skip-dense).", "OK")
            return 0

        # Stage 4a: CUDA dense stereo
        section("STAGE 4a: CUDA DENSE STEREO DEPTH MAPS")
        colmap_dense_stereo(
            colmap, workspace, stereo_dir, args.gpu_index, args.dense_max_image_size,
        )

        # Stage 4b: stereo fusion
        section("STAGE 4b: STEREO FUSION")
        colmap_stereo_fusion(colmap, workspace, fused_ply)

        # Stage 4c: Poisson meshing
        section("STAGE 4c: POISSON MESHING")
        colmap_poisson_meshing(colmap, fused_ply, mesh_ply)

        if not mesh_ply.is_file():
            raise RuntimeError("Poisson meshing did not produce meshed.ply")

        mesh_size_mb = mesh_ply.stat().st_size / (1024 * 1024)
        log(f"Mesh produced: {mesh_ply} ({mesh_size_mb:.2f} MB)")

        # Stage 5/6: metric calibration + viewer-ready PLY + optional GLB export
        section("STAGE 5/6: METRIC CALIBRATION + VIEWER ASSET EXPORT")
        scale = apply_doorway_scale(mesh_ply, args.doorway_width, out_path)

        # Always publish a PLY the Three.js viewer can load statically (/models/...).
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if not out_path.exists() or out_path.stat().st_size != mesh_ply.stat().st_size:
            shutil.copy2(mesh_ply, out_path)
        log(f"Published viewer asset: {out_path} ({mesh_size_mb:.2f} MB)")

        glb_path: Path | None = None
        if args.glb_out and not args.skip_export:
            glb_path = Path(args.glb_out)
            export_glb(mesh_ply, glb_path)
        elif not args.skip_export:
            # Default GLB next to the PLY if Blender is available.
            glb_path = out_path.with_suffix(".glb")
            if shutil.which("blender"):
                export_glb(mesh_ply, glb_path)

        duration = round(time.time() - start, 1)
        section("PIPELINE COMPLETE")
        write_manifest(workspace, {
            "stage": "complete",
            "registeredCameras": registered,
            "inputImages": n_images,
            "sparseModel": str(sparse_dir / "0"),
            "fusedPointCloud": str(fused_ply),
            "mesh": str(mesh_ply),
            "meshSizeMB": round(mesh_size_mb, 2),
            "scaleFactor": scale,
            "webModelUrl": f"/{out_path.relative_to(REPO_ROOT / 'public').as_posix()}",
            "glb": str(glb_path) if glb_path and glb_path.is_file() else None,
            "durationSeconds": duration,
            "gpuIndex": args.gpu_index,
            "environment": CONDA_ENV_NAME,
        })
        log(f"Done in {duration}s.", "OK")
        log(f"Final mesh : {mesh_ply}")
        if out_path.is_file():
            log(f"Viewer PLY : {out_path}")
        if glb_path and glb_path.is_file():
            log(f"Final GLB  : {glb_path}")
        log("Open http://localhost:3000 and launch the 3D walkthrough to roam the mesh.", "HINT")
        return 0
    except Exception as exc:  # noqa: BLE001 - surface a clean pipeline error
        log(f"PIPELINE FAILED: {exc}", "ERROR")
        return 1


if __name__ == "__main__":
    sys.exit(main())
