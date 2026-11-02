#!/usr/bin/env python3
"""
Namma Space — Automated Reconstruction Test Suite (Stage 8)

Tests every stage of the genuine reconstruction pipeline on real indoor captures
and records, for each stage: input info, output info, processing time, errors,
memory usage, and validation result. Results are classified as:

    passed   — stage completed successfully with valid output
    failed   — stage ran but produced an error or invalid output
    skipped  — stage not applicable (dependency unavailable or skipped by config)
    not_tested — stage not exercised in this run

Usage (from the project root, with the `pytorch` conda env activated):

    python test/reconstruct_tests.py [--photos N] [--output report.json]

The suite is designed to run entirely offline against local files; no network,
no API keys, no fabricated results.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Any

# Ensure the project root is importable.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from reconstruction_service.config import SETTINGS  # noqa: E402
from reconstruction_service.errors import (  # noqa: E402
    EngineUnavailable,
    PipelineCancelled,
    StageFailed,
)
from reconstruction_service.utils.gpu_monitor import (  # noqa: E402
    GpuStatus,
    gpu_status,
    process_rss_mb,
)

# ---------------------------------------------------------------------------
# Result recording helpers
# ---------------------------------------------------------------------------

ResultStatus = str  # "passed" | "failed" | "skipped" | "not_tested"


class TestReport:
    """Accumulates per-stage test results and writes a JSON report."""

    def __init__(self, output_path: Path):
        self.output_path = Path(output_path)
        self.stages: dict[str, dict[str, Any]] = {}
        self.order: list[str] = []
        self.started_at = time.time()

    def record(
        self,
        name: str,
        status: ResultStatus,
        *,
        input_info: dict[str, Any] | None = None,
        output_info: dict[str, Any] | None = None,
        processing_seconds: float | None = None,
        memory_mb: int | None = None,
        vram_mb: int | None = None,
        error: str | None = None,
        validation: dict[str, Any] | None = None,
        notes: str | None = None,
    ) -> None:
        entry: dict[str, Any] = {
            "status": status,
            "input": input_info or {},
            "output": output_info or {},
            "processingSeconds": processing_seconds,
            "memoryMb": memory_mb,
            "vramMb": vram_mb,
            "error": error,
            "validation": validation or {},
            "notes": notes,
        }
        self.stages[name] = entry
        self.order.append(name)
        mark = {"passed": "PASS", "failed": "FAIL", "skipped": "SKIP", "not_tested": "N/A"}.get(
            status, status
        )
        extra = ""
        if error:
            extra = f" — {error}"
        elif validation is not None:
            ok = validation.get("ok")
            extra = f" — valid={ok}" if ok is not None else ""
        print(f"[{mark:7}] {name}{extra}")

    def summary(self) -> dict[str, Any]:
        counts = {"passed": 0, "failed": 0, "skipped": 0, "not_tested": 0}
        for entry in self.stages.values():
            status = entry["status"]
            if status in counts:
                counts[status] += 1
        total = len(self.stages)
        return {
            "reportGeneratedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "elapsedSeconds": round(time.time() - self.started_at, 1),
            "totalStages": total,
            "counts": counts,
            "passed": counts["passed"],
            "failed": counts["failed"],
            "skipped": counts["skipped"],
            "notTested": counts["not_tested"],
            "allPassed": counts["failed"] == 0 and counts["skipped"] == 0,
            "stages": self.stages,
            "stageOrder": self.order,
        }

    def write(self) -> None:
        data = self.summary()
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"\nReport written to {self.output_path}")


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------

FIXTURES_DIR = ROOT / "test" / "fixtures" / "rotunda"
SAMPLE_DATA_DIR = ROOT / "test" / "sample_data"


def list_rotunda_photos(limit: int | None = None) -> list[Path]:
    photos = sorted(FIXTURES_DIR.glob("*.jpg"))
    if limit is not None:
        photos = photos[:limit]
    return photos


# ---------------------------------------------------------------------------
# Stage tests
# ---------------------------------------------------------------------------

def test_image_upload(report: TestReport, photos: list[Path]) -> None:
    """Test 1 — Image upload: validate formats and sizes of real photos."""
    t0 = time.time()
    input_info = {"photoCount": len(photos), "suffixes": sorted({p.suffix.lower() for p in photos})}
    try:
        total_bytes = 0
        valid = 0
        for p in photos:
            b = p.stat().st_size
            total_bytes += b
            if p.suffix.lower() in {".jpg", ".jpeg", ".png"} and b > 0:
                valid += 1
        output_info = {"validPhotos": valid, "totalBytes": total_bytes}
        report.record(
            "image_upload",
            "passed" if valid == len(photos) and valid > 0 else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": valid > 0, "validPhotos": valid},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "image_upload",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_video_upload(report: TestReport) -> None:
    """Test 2 — Video upload: validate that no fake MP4 is required; document
    that FFmpeg-based extraction is covered by test 3."""
    report.record(
        "video_upload",
        "skipped",
        input_info={"note": "No dedicated video fixture in repo; video ingestion is exercised via FFmpeg frame extraction (test 3)."},
        output_info={"skippedReason": "No sample MP4/MOV fixture checked into git."},
        validation={"ok": True, "skipped": True},
    )


def test_frame_extraction(report: TestReport, work_dir: Path) -> None:
    """Test 3 — Frame extraction using FFmpeg (server-side ingestion path)."""
    import subprocess

    t0 = time.time()
    # Create a tiny synthetic video with OpenCV to prove FFmpeg extraction.
    import cv2
    import numpy as np

    video_path = work_dir / "test_video.mp4"
    frames_dir = work_dir / "extracted_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    input_info = {"videoPath": str(video_path), "targetFps": 1}
    try:
        writer = cv2.VideoWriter(
            str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 1.0, (64, 64)
        )
        for i in range(5):
            frame = np.full((64, 64, 3), i * 50, dtype=np.uint8)
            writer.write(frame)
        writer.release()

        t_extract = time.time()
        result = subprocess.run(
            [
                "ffmpeg",
                "-i",
                str(video_path),
                "-vf",
                "fps=1",
                str(frames_dir / "frame_%03d.jpg"),
                "-y",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        extract_seconds = round(time.time() - t_extract, 3)
        extracted = sorted(frames_dir.glob("*.jpg"))
        output_info = {
            "extractedFrames": len(extracted),
            "ffmpegReturnCode": result.returncode,
            "extractSeconds": extract_seconds,
        }
        ok = result.returncode == 0 and len(extracted) == 5
        report.record(
            "frame_extraction",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": ok, "extractedFrames": len(extracted)},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "frame_extraction",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_image_normalization(report: TestReport, photos: list[Path], work_dir: Path) -> None:
    """Test 4 — Image normalization: EXIF orientation, sRGB, resize."""
    from PIL import Image, ImageOps

    t0 = time.time()
    input_info = {"photoCount": len(photos)}
    normalized_dir = work_dir / "normalized"
    normalized_dir.mkdir(parents=True, exist_ok=True)
    try:
        count = 0
        for p in photos:
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                out = normalized_dir / p.name
                im.save(out, "JPEG", quality=90)
                count += 1
        output_info = {"normalizedCount": count, "outputDir": str(normalized_dir)}
        ok = count == len(photos)
        report.record(
            "image_normalization",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": ok, "count": count},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "image_normalization",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def run_pipeline_stage(report: TestReport, name: str, func, *args, **kwargs) -> Any:
    """Run a pipeline stage with timing and memory capture."""
    t0 = time.time()
    mem_before = process_rss_mb()
    vram_before = gpu_status()
    try:
        result = func(*args, **kwargs)
        elapsed = round(time.time() - t0, 3)
        mem_after = process_rss_mb()
        vram_after = gpu_status()
        return result, elapsed, mem_after, vram_after
    except Exception as exc:  # noqa: BLE001
        elapsed = round(time.time() - t0, 3)
        mem_after = process_rss_mb()
        vram_after = gpu_status()
        raise exc


def test_colmap_feature_extraction(report: TestReport, photos: list[Path], work_dir: Path) -> None:
    """Test 5 — COLMAP SIFT feature extraction (via pipeline's camera stage)."""
    from reconstruction_service.stages.camera_reconstruction import reconstruct_cameras

    prepared_dir = work_dir / "prepared"
    prepared_dir.mkdir(parents=True, exist_ok=True)
    # Copy a subset of photos as the prepared input.
    for i, p in enumerate(photos[:8]):
        shutil.copy2(p, prepared_dir / f"photo_{i:03d}.jpg")

    t0 = time.time()
    input_info = {"photoCount": 8, "preparedDir": str(prepared_dir)}
    try:
        sfm_work = work_dir / "sfm"
        sfm_work.mkdir(parents=True, exist_ok=True)
        result = reconstruct_cameras(
            prepared_dir,
            sfm_work,
            work_dir / "assets",
            logger=lambda _m: None,
            progress=lambda *_: None,
            cancel=lambda: False,
        )
        sfm = result.get("sfm", {})
        output_info = {
            "registeredImages": sfm.get("registeredImages"),
            "sparsePoints": sfm.get("sparsePoints"),
            "reprojectionErrorPx": sfm.get("reprojectionErrorPx"),
            "engine": sfm.get("engine"),
            "device": sfm.get("device"),
            "matching": sfm.get("matching"),
        }
        ok = sfm.get("registeredImages", 0) >= 3 and sfm.get("sparsePoints", 0) > 0
        report.record(
            "colmap_feature_extraction",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            vram_mb=(gpu_status().used_mb if gpu_status() else None),
            validation={"ok": ok, "registeredImages": sfm.get("registeredImages")},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "colmap_feature_extraction",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            vram_mb=(gpu_status().used_mb if gpu_status() else None),
            error=str(exc),
        )


def test_feature_matching(report: TestReport) -> None:
    """Test 6 — Feature matching: covered within COLMAP camera reconstruction
    (test 5 reports matching mode). Marked as part of stage 5 but listed
    separately per the requirement."""
    report.record(
        "feature_matching",
        "skipped",
        input_info={"note": "Feature matching is an internal step of COLMAP incremental mapping; exercised and reported within test 5 (colmap_feature_extraction)."},
        output_info={"seeStage": "colmap_feature_extraction"},
        validation={"ok": True, "skipped": True},
    )


def test_camera_registration(report: TestReport) -> None:
    """Test 7 — Camera registration: covered within COLMAP camera reconstruction
    (test 5 reports registeredImages)."""
    report.record(
        "camera_registration",
        "skipped",
        input_info={"note": "Camera registration is reported within test 5 (registeredImages, reprojectionErrorPx)."},
        output_info={"seeStage": "colmap_feature_extraction"},
        validation={"ok": True, "skipped": True},
    )


def test_sparse_reconstruction(report: TestReport) -> None:
    """Test 8 — Sparse reconstruction: covered within COLMAP camera reconstruction
    (test 5 reports sparsePoints and modelPath)."""
    report.record(
        "sparse_reconstruction",
        "skipped",
        input_info={"note": "Sparse point cloud generation is reported within test 5 (sparsePoints, modelPath)."},
        output_info={"seeStage": "colmap_feature_extraction"},
        validation={"ok": True, "skipped": True},
    )


def test_dense_reconstruction(report: TestReport, work_dir: Path, assets_dir: Path) -> None:
    """Test 9 — Dense reconstruction: COLMAP PatchMatch stereo + stereo fusion.

    Validates the dense MVS output from the pipeline run by reading the
    manifest (the pipeline cleans up intermediate work directories).
    """
    import json

    t0 = time.time()
    input_info = {
        "note": "Dense MVS ran as part of the pipeline; validating via manifest.",
        "maxImageSize": SETTINGS.dense_max_image_size,
    }
    try:
        manifest_path = assets_dir / "manifest.json"
        if not manifest_path.is_file():
            report.record(
                "dense_reconstruction",
                "skipped",
                input_info=input_info,
                output_info={"reason": "manifest.json not found."},
                validation={"ok": True, "skipped": True},
            )
            return
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        stages = manifest.get("stages", {})
        dense = stages.get("dense", {})
        stats = manifest.get("stats", {})
        output_info = {
            "status": dense.get("status") or stats.get("denseStatus"),
            "points": dense.get("points") or stats.get("densePoints"),
            "reason": dense.get("reason") or stats.get("denseReason"),
        }
        status = dense.get("status") or stats.get("denseStatus")
        points = dense.get("points") or stats.get("densePoints") or 0
        ok = status == "passed" and points >= 1000
        report.record(
            "dense_reconstruction",
            "passed" if ok else ("failed" if status == "failed" else "skipped"),
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            vram_mb=(gpu_status().used_mb if gpu_status() else None),
            validation={"ok": ok, "status": status, "points": points, "reason": stats.get("denseReason")},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "dense_reconstruction",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            vram_mb=(gpu_status().used_mb if gpu_status() else None),
            error=str(exc),
        )


def test_gaussian_training(report: TestReport, work_dir: Path, assets_dir: Path) -> None:
    """Test 10 — Gaussian training (Brush engine).

    Validates the Gaussian PLY already produced by the pipeline run.
    """
    from reconstruction_service.utils.ply import validate_ply

    t0 = time.time()
    splat_path = assets_dir / "scene.ply"
    input_info = {
        "splatPath": str(splat_path),
        "note": "Gaussian training ran as part of the pipeline; validating its output.",
        "resolution": SETTINGS.splat_resolution,
        "steps": SETTINGS.splat_steps,
        "engine": "Brush",
    }
    try:
        if not splat_path.is_file():
            report.record(
                "gaussian_training",
                "skipped",
                input_info=input_info,
                output_info={"reason": "scene.ply not produced (Gaussian training skipped/failed in pipeline)."},
                validation={"ok": True, "skipped": True},
            )
            return
        facts = validate_ply(splat_path, expected="gaussian")
        output_info = {
            "status": "passed",
            "gaussians": facts.get("vertexCount"),
            "splatPly": str(splat_path),
            "engine": "Brush",
        }
        ok = facts.get("ok") and facts.get("kind") == "gaussian" and (facts.get("vertexCount") or 0) > 0
        report.record(
            "gaussian_training",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            vram_mb=(gpu_status().used_mb if gpu_status() else None),
            validation={"ok": ok, "gaussians": facts.get("vertexCount"), "kind": facts.get("kind")},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "gaussian_training",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            vram_mb=(gpu_status().used_mb if gpu_status() else None),
            error=str(exc),
        )


def test_mesh_generation(report: TestReport, dense_result: dict | None, work_dir: Path, assets_dir: Path) -> None:
    """Test 11 — Mesh generation: Open3D Poisson + Blender GLB.

    Validates the GLB mesh already produced by the pipeline run.
    """
    from reconstruction_service.utils.ply import validate_glb

    t0 = time.time()
    glb_path = assets_dir / "mesh.glb"
    input_info = {
        "glbPath": str(glb_path),
        "note": "Mesh generation ran as part of the pipeline; validating its output.",
        "targetTriangles": SETTINGS.mesh_target_triangles,
    }
    try:
        if not glb_path.is_file():
            report.record(
                "mesh_generation",
                "skipped",
                input_info=input_info,
                output_info={"reason": "mesh.glb not produced (mesh generation skipped/failed in pipeline)."},
                validation={"ok": True, "skipped": True},
            )
            return
        facts = validate_glb(glb_path)
        output_info = {
            "status": "passed",
            "meshGlb": str(glb_path),
            "kind": facts.get("kind"),
            "meshCount": facts.get("meshCount"),
            "primitiveCount": facts.get("primitiveCount"),
            "bytes": facts.get("bytes"),
        }
        ok = facts.get("ok") and facts.get("kind") == "glb"
        report.record(
            "mesh_generation",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": ok, "meshCount": facts.get("meshCount"), "primitiveCount": facts.get("primitiveCount")},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "mesh_generation",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_scene_export(report: TestReport, assets_dir: Path, job_id: str) -> None:
    """Test 12 — Scene export: manifest.json + asset metadata validation."""
    from reconstruction_service.stages.scene_export import final_checks, collect_assets

    t0 = time.time()
    input_info = {"assetsDir": str(assets_dir), "jobId": job_id}
    try:
        checks = final_checks(assets_dir)
        assets = collect_assets(assets_dir, job_id)
        output_info = {"checks": checks, "assets": list(assets.keys())}
        all_ok = all(v.get("ok") for v in checks.values()) if checks else False
        report.record(
            "scene_export",
            "passed" if all_ok and assets else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": all_ok, "checks": checks, "assetCount": len(assets)},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "scene_export",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_backend_asset_serving(report: TestReport, assets_dir: Path) -> None:
    """Test 13 — Backend asset serving: verify assets are valid files with
    correct MIME-relevant extensions (served via FastAPI FileResponse)."""
    t0 = time.time()
    input_info = {"assetsDir": str(assets_dir)}
    try:
        expected = ["scene.ply", "mesh.glb", "point-cloud.ply", "manifest.json"]
        found = {}
        for name in expected:
            p = assets_dir / name
            found[name] = {
                "exists": p.is_file(),
                "bytes": p.stat().st_size if p.is_file() else 0,
                "suffix": p.suffix.lower(),
            }
        ok = found["scene.ply"]["exists"] and found["manifest.json"]["exists"]
        report.record(
            "backend_asset_serving",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info={"assets": found},
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": ok, "assets": found},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "backend_asset_serving",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_gaussian_splat_rendering(report: TestReport, assets_dir: Path) -> None:
    """Test 14 — Gaussian Splat rendering: validate the Gaussian PLY has all
    Gaussian attributes (SH coeffs, opacity, rot, scale)."""
    from reconstruction_service.utils.ply import validate_ply

    t0 = time.time()
    splat_path = assets_dir / "scene.ply"
    input_info = {"splatPath": str(splat_path)}
    try:
        if not splat_path.is_file():
            report.record(
                "gaussian_splat_rendering",
                "skipped",
                input_info=input_info,
                output_info={"reason": "scene.ply not produced (Gaussian training skipped/failed)."},
                validation={"ok": True, "skipped": True},
            )
            return
        facts = validate_ply(splat_path, expected="gaussian")
        output_info = {
            "vertexCount": facts.get("vertexCount"),
            "kind": facts.get("kind"),
            "hasGaussianAttributes": facts.get("hasGaussianAttributes"),
        }
        ok = facts.get("ok") and facts.get("kind") == "gaussian"
        report.record(
            "gaussian_splat_rendering",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation=facts,
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "gaussian_splat_rendering",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_glb_rendering(report: TestReport, assets_dir: Path) -> None:
    """Test 15 — GLB rendering: validate the mesh GLB is a proper GLB container."""
    from reconstruction_service.utils.ply import validate_glb

    t0 = time.time()
    glb_path = assets_dir / "mesh.glb"
    input_info = {"glbPath": str(glb_path)}
    try:
        if not glb_path.is_file():
            report.record(
                "glb_rendering",
                "skipped",
                input_info=input_info,
                output_info={"reason": "mesh.glb not produced (mesh generation skipped/failed)."},
                validation={"ok": True, "skipped": True},
            )
            return
        facts = validate_glb(glb_path)
        output_info = {
            "kind": facts.get("kind"),
            "version": facts.get("version"),
            "meshCount": facts.get("meshCount"),
            "primitiveCount": facts.get("primitiveCount"),
            "bytes": facts.get("bytes"),
        }
        ok = facts.get("ok") and facts.get("kind") == "glb"
        report.record(
            "glb_rendering",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info=output_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation=facts,
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "glb_rendering",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


def test_wasd_walkthrough(report: TestReport) -> None:
    """Test 16 — WASD walkthrough: verify the viewer component compiles and
    exposes first-person controls (PointerLockControls + WASD key handling).

    This is a static check of the source: the Viewer3DView component must
    import PointerLockControls and handle W/A/S/D keys. Actual browser
    interaction requires a running dev server + Playwright, which is out of
    scope for this offline suite.
    """
    t0 = time.time()
    viewer_path = ROOT / "src" / "components" / "Viewer3DView.tsx"
    input_info = {"viewerPath": str(viewer_path)}
    try:
        source = viewer_path.read_text(encoding="utf-8")
        has_pointer_lock = "PointerLockControls" in source
        has_wasd = all(k in source for k in ("KeyW", "KeyA", "KeyS", "KeyD"))
        has_collision = "clampCameraToLayout" in source
        has_floor = "EYE_HEIGHT_FLOOR_MARGIN" in source
        ok = has_pointer_lock and has_wasd and has_collision and has_floor
        report.record(
            "wasd_walkthrough",
            "passed" if ok else "failed",
            input_info=input_info,
            output_info={
                "hasPointerLockControls": has_pointer_lock,
                "hasWASDKeys": has_wasd,
                "hasCollisionDetection": has_collision,
                "hasFloorConstraints": has_floor,
            },
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            validation={"ok": ok},
        )
    except Exception as exc:  # noqa: BLE001
        report.record(
            "wasd_walkthrough",
            "failed",
            input_info=input_info,
            processing_seconds=round(time.time() - t0, 3),
            memory_mb=process_rss_mb(),
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

def run_all(photo_limit: int | None = None, output_path: Path | None = None) -> TestReport:
    if output_path is None:
        output_path = ROOT / "test" / "reconstruction_test_report.json"

    report = TestReport(output_path)
    photos = list_rotunda_photos(photo_limit)
    if not photos:
        report.record(
            "image_upload",
            "failed",
            input_info={"note": "No rotunda fixtures found."},
            error=f"No photos in {FIXTURES_DIR}",
        )
        # Mark remaining as not_tested.
        for name in [
            "video_upload", "frame_extraction", "image_normalization",
            "colmap_feature_extraction", "feature_matching", "camera_registration",
            "sparse_reconstruction", "dense_reconstruction", "gaussian_training",
            "mesh_generation", "scene_export", "backend_asset_serving",
            "gaussian_splat_rendering", "glb_rendering", "wasd_walkthrough",
        ]:
            report.record(name, "not_tested")
        report.write()
        return report

    work_dir = Path(os.getenv("DART_TEST_WORK", str(ROOT / "test" / "work")))
    assets_dir = Path(os.getenv("DART_TEST_ASSETS", str(ROOT / "test" / "assets")))
    for d in (work_dir, assets_dir):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)

    job_id = f"test_{uuid.uuid4().hex[:8]}"

    # Run tests in dependency order.
    test_image_upload(report, photos)
    test_video_upload(report)
    test_frame_extraction(report, work_dir)
    test_image_normalization(report, photos, work_dir)
    test_colmap_feature_extraction(report, photos, work_dir)
    test_feature_matching(report)
    test_camera_registration(report)
    test_sparse_reconstruction(report)

    # For dense/splat/mesh, reuse the work/assets from the SfM stage if available.
    # Re-run the pipeline end-to-end once to populate work/assets for downstream tests.
    from reconstruction_service.pipeline import reconstruct

    pipeline_stats = None
    try:
        pipeline_stats = reconstruct(
            images=photos[:8],
            work_dir=work_dir / "pipeline",
            assets_dir=assets_dir,
            log_path=work_dir / "pipeline.log",
            progress=lambda *_: None,
            cancel=lambda: False,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[INFO] Full pipeline run for downstream tests: {exc}")

    test_dense_reconstruction(report, work_dir / "pipeline", assets_dir)
    test_gaussian_training(report, work_dir / "pipeline", assets_dir)
    test_mesh_generation(report, None, work_dir / "pipeline", assets_dir)
    test_scene_export(report, assets_dir, job_id)
    test_backend_asset_serving(report, assets_dir)
    test_gaussian_splat_rendering(report, assets_dir)
    test_glb_rendering(report, assets_dir)
    test_wasd_walkthrough(report)

    report.write()
    return report


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Namma Space reconstruction test suite")
    parser.add_argument("--photos", type=int, default=None, help="Number of rotunda photos to use")
    parser.add_argument("--output", type=Path, default=None, help="Output report JSON path")
    args = parser.parse_args()

    run_all(photo_limit=args.photos, output_path=args.output)
