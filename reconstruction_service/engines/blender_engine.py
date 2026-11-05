"""Blender PLY -> GLB conversion.

Blender is used for the conversion because it validates the geometry, applies
transformations and writes a standards-compliant GLB. If Blender is missing we
fall back to trimesh, which also performs a genuine conversion. Copying a PLY
to a .glb filename is never acceptable.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable

from ..config import SETTINGS, PROJECT_ROOT
from ..errors import EngineUnavailable
from ..utils.ply import validate_glb

BLENDER_SCRIPT = PROJECT_ROOT / "reconstruction_service" / "engines" / "blender_export_scene.py"


def export_glb(
    mesh_ply: Path,
    output_glb: Path,
    *,
    logger: Callable[[str], None] = lambda _m: None,
    timeout: int = 600,
) -> dict[str, Any]:
    if not mesh_ply.is_file():
        raise EngineUnavailable(f"Mesh PLY not found: {mesh_ply}")
    output_glb.parent.mkdir(parents=True, exist_ok=True)
    if output_glb.exists():
        try:
            output_glb.unlink()
        except OSError:
            pass

    blender = SETTINGS.blender_binary
    if blender is not None and BLENDER_SCRIPT.is_file():
        logger(f"Exporting GLB with Blender: {blender}")
        command = [
            str(blender),
            "--background",
            "--factory-startup",
            "--python",
            str(BLENDER_SCRIPT),
            "--",
            "--input",
            str(mesh_ply),
            "--output",
            str(output_glb),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
                cwd=str(PROJECT_ROOT),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger(f"Blender export failed to run: {exc}")
        else:
            tail = (completed.stdout or "")[-1500:]
            if completed.returncode == 0 and output_glb.is_file():
                facts = validate_glb(output_glb)
                if facts.get("ok"):
                    facts["exporter"] = "blender"
                    facts["path"] = str(output_glb)
                    return facts
                logger(f"Blender wrote an invalid GLB: {facts.get('error')}")
            else:
                logger(
                    f"Blender exited with {completed.returncode}; falling back to trimesh. "
                    f"{tail}"
                )

    # Fallback: trimesh performs a real PLY -> GLB conversion.
    try:
        import trimesh  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise EngineUnavailable(
            "Neither Blender nor trimesh is available for GLB export. "
            "Set BLENDER_BINARY to blender.exe."
        ) from exc

    logger("Exporting GLB with trimesh")
    try:
        scene = trimesh.load(str(mesh_ply), process=False)
        if isinstance(scene, trimesh.Trimesh):
            data = scene.export(file_type="glb")
        else:
            data = scene.export(file_type="glb")
        output_glb.write_bytes(data)
    except Exception as exc:  # noqa: BLE001
        raise EngineUnavailable(f"GLB conversion failed: {exc}") from exc

    facts = validate_glb(output_glb)
    if not facts.get("ok"):
        raise EngineUnavailable(f"GLB validation failed: {facts.get('error')}")
    facts["exporter"] = "trimesh"
    facts["path"] = str(output_glb)
    return facts
