"""Report gsplat readiness without pretending it can train.

gsplat 1.5.3 installs and imports, but its CUDA kernels are compiled on first
use with torch's JIT. On Windows that requires MSVC ``cl.exe`` (Visual Studio
C++ Build Tools). This machine has no compiler, so the backend cannot be built
yet. The orchestrator therefore falls back to Brush, which is a genuine 3DGS
trainer and is proven on this hardware.
"""

from __future__ import annotations

import shutil
from typing import Any

from ..errors import EngineUnavailable


def gsplat_status() -> dict[str, Any]:
    status: dict[str, Any] = {
        "installed": False,
        "version": None,
        "torchCuda": False,
        "ninja": bool(shutil.which("ninja")),
        "clCompiler": bool(shutil.which("cl")),
        "ready": False,
        "reason": None,
    }
    try:
        import gsplat  # type: ignore

        status["installed"] = True
        status["version"] = getattr(gsplat, "__version__", None)
    except Exception as exc:  # noqa: BLE001
        status["reason"] = f"gsplat is not installed: {exc}"
        return status

    try:
        import torch  # type: ignore

        status["torchCuda"] = bool(torch.cuda.is_available())
    except Exception as exc:  # noqa: BLE001
        status["reason"] = f"torch is not available: {exc}"
        return status

    if not status["torchCuda"]:
        status["reason"] = "torch has no CUDA device."
    elif not status["ninja"]:
        status["reason"] = "ninja is not on PATH; gsplat cannot compile its CUDA backend."
    elif not status["clCompiler"]:
        status["reason"] = (
            "MSVC cl.exe (Visual Studio C++ Build Tools) is missing; gsplat cannot "
            "compile its CUDA kernels on Windows."
        )
    else:
        status["ready"] = True
    return status


def train(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    status = gsplat_status()
    raise EngineUnavailable(
        "gsplat training is not available: " + (status.get("reason") or "backend not built")
    )
