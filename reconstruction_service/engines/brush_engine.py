"""Brush Gaussian-splatting engine.

Brush is a genuine 3D Gaussian Splatting trainer that consumes a COLMAP dataset
and exports a Gaussian PLY (position, opacity, scale, rotation and spherical
harmonics). It is the proven trainer on this laptop (30 photos, 229k splats,
~8 minutes). gsplat is the preferred engine when its CUDA backend is buildable;
see ``gsplat_engine.py``.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from ..config import PROJECT_ROOT, SETTINGS
from ..errors import EngineUnavailable, PipelineCancelled, StageFailed
from ..utils.gpu_monitor import VramMonitor, preflight_gpu
from ..utils.ply import validate_ply


def brush_available() -> bool:
    return SETTINGS.brush_binary is not None


def _command(dataset_dir: Path, output_dir: Path) -> list[str]:
    steps = SETTINGS.splat_steps
    return [
        str(SETTINGS.brush_binary),
        str(dataset_dir),
        "--total-steps",
        str(steps),
        "--max-resolution",
        str(SETTINGS.splat_resolution),
        "--max-splats",
        str(SETTINGS.splat_max),
        "--export-every",
        str(max(500, steps // 2)),
        "--export-path",
        str(output_dir),
        "--export-name",
        "scene.ply",
    ]


def train(
    dataset_dir: Path,
    output_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if SETTINGS.brush_binary is None:
        raise EngineUnavailable(
            "Brush was not found. Place brush_app.exe in .tools/brush or set BRUSH_BINARY."
        )
    if not (dataset_dir / "images").is_dir() or not (dataset_dir / "sparse" / "0").is_dir():
        raise StageFailed("Brush dataset is incomplete: images/ and sparse/0/ are required.")

    ok, message, gpu = preflight_gpu(1400)
    if not ok:
        raise EngineUnavailable(message)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "scene.ply"
    if output_path.exists():
        try:
            output_path.unlink()
        except OSError:
            pass

    command = _command(dataset_dir, output_dir)
    logger("Running Brush: " + subprocess.list2cmdline(command))
    if progress:
        progress(80, "Training Gaussian splats (Brush)")

    monitor = VramMonitor(
        SETTINGS.vram_limit_mb,
        interval=SETTINGS.vram_poll_seconds,
        on_exceed=lambda status: logger(
            f"VRAM limit reached ({status.used_mb} MB of {status.total_mb} MB); stopping Brush"
        ),
    )
    monitor.start()

    log_path = output_dir.parent / "brush.log"
    started = time.time()
    process: subprocess.Popen | None = None
    try:
        with log_path.open("a", encoding="utf-8", errors="replace") as log:
            log.write(f"\n$ {subprocess.list2cmdline(command)}\n")
            log.flush()
            process = subprocess.Popen(
                command,
                cwd=str(PROJECT_ROOT),
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            while process.poll() is None:
                if cancel is not None and cancel():
                    process.terminate()
                    raise PipelineCancelled("Reconstruction cancelled by the user.")
                if monitor.exceeded:
                    process.terminate()
                    raise EngineUnavailable(
                        f"Brush exceeded the {SETTINGS.vram_limit_mb} MB VRAM budget. "
                        "Lower DART_SPLAT_RESOLUTION or DART_SPLAT_MAX and retry."
                    )
                if time.time() - started > SETTINGS.splat_timeout_seconds:
                    process.terminate()
                    raise StageFailed(
                        f"Brush exceeded the {SETTINGS.splat_timeout_seconds}s timeout."
                    )
                time.sleep(1.0)
    except OSError as exc:
        raise EngineUnavailable(f"Could not start Brush: {exc}") from exc
    finally:
        monitor_summary = monitor.stop()
        if process is not None and process.poll() is None:
            process.kill()

    if process is None or process.returncode != 0:
        code = process.returncode if process is not None else "unknown"
        raise StageFailed(
            f"Brush exited with code {code}. See {log_path.name} for the trainer output."
        )
    if not output_path.is_file() or output_path.stat().st_size < 10_000:
        raise StageFailed(
            "Brush finished but produced no usable Gaussian PLY. The trainer log has details."
        )

    facts = validate_ply(output_path, expected="gaussian")
    if not facts.get("ok"):
        raise StageFailed(f"Brush output is not a valid Gaussian PLY: {facts.get('error')}")

    duration = round(time.time() - started, 1)
    logger(f"Brush produced {facts['vertexCount']:,} Gaussians in {duration}s")
    if progress:
        progress(92, f"Trained {facts['vertexCount']:,} Gaussians")
    return {
        "path": str(output_path),
        "engine": "Brush 3D Gaussian Splatting",
        "gaussians": facts["vertexCount"],
        "durationSeconds": duration,
        "vram": monitor_summary,
        "log": str(log_path),
        "bytes": output_path.stat().st_size,
    }
