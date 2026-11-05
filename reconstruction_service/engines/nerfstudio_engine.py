"""Nerfstudio readiness probe.

Nerfstudio is deliberately not used as the primary trainer on this machine:
Nerfstudio 1.1.5 pins older PyTorch builds, which would replace the working
``torch 2.14.1+cu130`` installation and break CUDA 13. It also wraps gsplat,
whose CUDA backend already cannot build here. The module exists so the
service can report the real state instead of assuming it is installed.
"""

from __future__ import annotations

import importlib.util
from typing import Any


def nerfstudio_status() -> dict[str, Any]:
    module = importlib.util.find_spec("nerfstudio")
    return {
        "installed": module is not None,
        "usedByPipeline": False,
        "reason": (
            "Nerfstudio requires an older PyTorch/CUDA combination than the one "
            "installed here (torch 2.14.1+cu130). It is not used."
        ),
    }
