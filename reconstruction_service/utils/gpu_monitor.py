"""GPU visibility and VRAM monitoring.

The target GPU has 4 GB total, and the desktop already uses ~1 GB. Training
must observe the real free memory rather than trust a nominal budget, so every
GPU stage is wrapped in a :class:`VramMonitor` that polls once per second and
can abort the stage before Windows starts paging.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, asdict
from typing import Any, Callable


@dataclass
class GpuStatus:
    name: str
    total_mb: int
    used_mb: int
    free_mb: int
    source: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _from_torch() -> GpuStatus | None:
    try:
        import torch  # type: ignore

        if not torch.cuda.is_available():
            return None
        free, total = torch.cuda.mem_get_info(0)
        name = torch.cuda.get_device_name(0)
        return GpuStatus(
            name=name,
            total_mb=int(total // (1024 * 1024)),
            used_mb=int((total - free) // (1024 * 1024)),
            free_mb=int(free // (1024 * 1024)),
            source="torch",
        )
    except Exception:  # noqa: BLE001 - torch is optional for this helper
        return None


def _from_nvidia_smi() -> GpuStatus | None:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return None
    try:
        output = subprocess.run(
            [
                executable,
                "--query-gpu=name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        ).stdout.strip()
        first = output.splitlines()[0]
        name, total, used, free = [part.strip() for part in first.split(",")]
        return GpuStatus(
            name=name,
            total_mb=int(float(total)),
            used_mb=int(float(used)),
            free_mb=int(float(free)),
            source="nvidia-smi",
        )
    except Exception:  # noqa: BLE001
        return None


def gpu_status() -> GpuStatus | None:
    return _from_torch() or _from_nvidia_smi()


def cuda_available() -> bool:
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


def process_rss_mb() -> int | None:
    try:
        import psutil  # type: ignore

        return int(psutil.Process().memory_info().rss // (1024 * 1024))
    except Exception:  # noqa: BLE001
        return None


class VramMonitor(threading.Thread):
    """Polls GPU memory and records the peak until stopped."""

    def __init__(
        self,
        limit_mb: int,
        *,
        interval: float = 1.0,
        on_exceed: Callable[[GpuStatus], None] | None = None,
    ):
        super().__init__(name="vram-monitor", daemon=True)
        self.limit_mb = max(256, int(limit_mb))
        self.interval = max(0.2, float(interval))
        self.on_exceed = on_exceed
        self._stop_event = threading.Event()
        self.samples: list[int] = []
        self.peak_used_mb = 0
        self.min_free_mb: int | None = None
        self.exceeded = False
        self.last: GpuStatus | None = None

    def run(self) -> None:
        while not self._stop_event.is_set():
            status = gpu_status()
            if status is not None:
                self.last = status
                self.samples.append(status.used_mb)
                self.peak_used_mb = max(self.peak_used_mb, status.used_mb)
                self.min_free_mb = status.free_mb if self.min_free_mb is None else min(
                    self.min_free_mb, status.free_mb
                )
                if status.used_mb >= self.limit_mb and not self.exceeded:
                    self.exceeded = True
                    if self.on_exceed is not None:
                        try:
                            self.on_exceed(status)
                        except Exception:  # noqa: BLE001 - callback must not kill the monitor
                            pass
            self._stop_event.wait(self.interval)

    def stop(self) -> dict[str, Any]:
        self._stop_event.set()
        if self.is_alive():
            self.join(timeout=5)
        return self.summary()

    def summary(self) -> dict[str, Any]:
        return {
            "peakUsedMb": self.peak_used_mb or None,
            "minFreeMb": self.min_free_mb,
            "limitMb": self.limit_mb,
            "exceeded": self.exceeded,
            "samples": len(self.samples),
            "device": self.last.as_dict() if self.last else None,
        }


def preflight_gpu(min_free_mb: int) -> tuple[bool, str, dict[str, Any]]:
    """Check that enough VRAM is free before starting a GPU stage."""
    status = gpu_status()
    if status is None:
        return False, "No CUDA GPU is visible to this Python environment.", {}
    data = status.as_dict()
    if status.free_mb < min_free_mb:
        return (
            False,
            f"Only {status.free_mb} MB of {status.total_mb} MB VRAM is free; "
            f"{min_free_mb} MB is required. Close other GPU applications and retry.",
            data,
        )
    return True, "ok", data
