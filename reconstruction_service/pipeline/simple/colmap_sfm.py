"""
COLMAP Structure-from-Motion pipeline module.

Automates feature extraction, exhaustive matching, and sparse reconstruction
using COLMAP CLI tools via subprocess with real-time log streaming.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable


def _find_colmap_executable() -> tuple[str, dict[str, str]]:
    """Locate the direct colmap binary to prevent batch file quoting issues on Windows."""
    env = dict(os.environ)

    candidates = [
        Path(r"C:\tools\colmap\bin\colmap.exe"),
        Path(r"C:\Program Files\COLMAP\colmap.exe"),
        Path(r"C:\Program Files\COLMAP\bin\colmap.exe"),
    ]
    for c in candidates:
        if c.exists():
            bin_dir = str(c.parent)
            env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
            return str(c), env

    found = shutil.which("colmap")
    if found:
        p = Path(found)
        sub_bin = p.parent / "bin" / "colmap.exe"
        if sub_bin.exists():
            env["PATH"] = str(sub_bin.parent) + os.pathsep + env.get("PATH", "")
            return str(sub_bin), env
        if p.suffix.lower() == ".exe":
            env["PATH"] = str(p.parent) + os.pathsep + env.get("PATH", "")
            return str(p), env
        return str(p), env

    raise RuntimeError(
        "COLMAP executable not found. Please install COLMAP and add it to PATH."
    )


def _stream_process(
    cmd: list[str],
    log_callback: Callable[[str], None],
    step_name: str,
    env: dict[str, str] | None = None,
) -> None:
    """Run a subprocess, streaming every stdout/stderr line to *log_callback*.

    Raises ``RuntimeError`` on non-zero exit codes.
    """
    log_callback(f"[SFM] Starting: {step_name}")
    log_callback(f"[SFM] Command: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )

    assert process.stdout is not None
    for line in process.stdout:
        stripped = line.rstrip("\n\r")
        if stripped:
            log_callback(f"[SFM] {stripped}")

    return_code = process.wait()
    if return_code != 0:
        msg = f"COLMAP {step_name} failed with exit code {return_code}"
        log_callback(f"[SFM][ERROR] {msg}")
        raise RuntimeError(msg)

    log_callback(f"[SFM] Completed: {step_name}")


def run_sfm(
    image_dir: Path,
    workspace_dir: Path,
    log_callback: Callable[[str], None],
) -> Path:
    """Run the full COLMAP SfM pipeline and return the sparse reconstruction directory."""

    colmap_bin, env = _find_colmap_executable()
    log_callback(f"[SFM] Found COLMAP at: {colmap_bin}")

    sparse_dir = workspace_dir / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    database_path = workspace_dir / "database.db"
    log_callback(f"[SFM] Workspace : {workspace_dir}")
    log_callback(f"[SFM] Image dir : {image_dir}")
    log_callback(f"[SFM] Database  : {database_path}")
    log_callback(f"[SFM] Sparse out: {sparse_dir}")

    _stream_process(
        [
            colmap_bin,
            "feature_extractor",
            "--database_path", str(database_path),
            "--image_path", str(image_dir),
            "--ImageReader.single_camera", "1",
            "--ImageReader.camera_model", "OPENCV",
        ],
        log_callback,
        "feature_extractor",
        env=env,
    )

    _stream_process(
        [
            colmap_bin,
            "exhaustive_matcher",
            "--database_path", str(database_path),
        ],
        log_callback,
        "exhaustive_matcher",
        env=env,
    )

    _stream_process(
        [
            colmap_bin,
            "mapper",
            "--database_path", str(database_path),
            "--image_path", str(image_dir),
            "--output_path", str(sparse_dir),
        ],
        log_callback,
        "mapper",
        env=env,
    )

    if (sparse_dir / "points3D.bin").exists() or (sparse_dir / "points3D.txt").exists():
        log_callback(f"[SFM] Sparse reconstruction at: {sparse_dir}")
        return sparse_dir

    reconstruction_dirs = sorted(
        [d for d in sparse_dir.iterdir() if d.is_dir()],
        key=lambda p: p.name,
    )

    if not reconstruction_dirs:
        msg = "COLMAP mapper produced no reconstruction output."
        log_callback(f"[SFM][ERROR] {msg}")
        raise RuntimeError(msg)

    result_dir = reconstruction_dirs[0]
    log_callback(f"[SFM] Sparse reconstruction at: {result_dir}")
    return result_dir
