"""
Pipeline orchestrator — drives the full reconstruction workflow.

    Image staging → COLMAP SfM → 3DGS Training → .splat export → Floor estimation
"""

from __future__ import annotations

import asyncio
import json
import shutil
import traceback
from pathlib import Path
from typing import Any

from .colmap_sfm import run_sfm
from .train_splats import train_gaussians
from .floor_estimator import estimate_floor


class PipelineRunner:
    """Orchestrates the full reconstruction pipeline for a single session."""

    def __init__(
        self,
        session_id: str,
        base_data_dir: Path,
        base_output_dir: Path,
    ) -> None:
        self.session_id = session_id
        self.data_dir = base_data_dir / session_id
        self.image_dir = self.data_dir / "images"
        self.workspace_dir = self.data_dir / "colmap_workspace"
        self.output_dir = base_output_dir / session_id
        self.log_queue: asyncio.Queue[str] = asyncio.Queue()
        self._status: str = "idle"
        self._meta: dict[str, Any] = {}

    @property
    def status(self) -> str:
        return self._status

    @property
    def meta(self) -> dict[str, Any]:
        return self._meta

    def _log(self, line: str) -> None:
        """Synchronous log callback — pushes to the async queue via put_nowait."""
        try:
            self.log_queue.put_nowait(line)
        except asyncio.QueueFull:
            pass

    async def run(self, iterations: int = 7000) -> None:
        """Execute the full pipeline.  Runs blocking steps in a thread executor."""
        loop = asyncio.get_event_loop()

        try:
            self._status = "setup"
            self._log(f"[PIPELINE] Session {self.session_id}")
            self.workspace_dir.mkdir(parents=True, exist_ok=True)
            self.output_dir.mkdir(parents=True, exist_ok=True)

            image_count = len(list(self.image_dir.glob("*")))
            self._log(f"[PIPELINE] Found {image_count} images")

            if image_count < 3:
                raise ValueError(
                    f"Need at least 3 images for reconstruction, got {image_count}"
                )

            self._status = "sfm"
            self._log("[PIPELINE] ══ Stage 1/3 ▸ Structure-from-Motion ══")
            sparse_dir: Path = await loop.run_in_executor(
                None,
                run_sfm,
                self.image_dir,
                self.workspace_dir,
                self._log,
            )

            self._status = "training"
            self._log("[PIPELINE] ══ Stage 2/3 ▸ Gaussian Splatting Training ══")
            gs_output_dir = self.data_dir / "gs_output"
            splat_path: Path = await loop.run_in_executor(
                None,
                train_gaussians,
                sparse_dir,
                gs_output_dir,
                iterations,
                self._log,
            )

            self._status = "converting"
            self._log("[PIPELINE] ══ Stage 3/3 ▸ Floor Estimation ══")
            try:
                floor_data: dict = await loop.run_in_executor(
                    None,
                    estimate_floor,
                    sparse_dir,
                )
            except Exception as exc:
                self._log(f"[PIPELINE][WARN] Floor estimation failed: {exc}")
                floor_data = {
                    "plane": [0.0, 1.0, 0.0, 0.0],
                    "floor_y": 0.0,
                    "bounds": {"x_min": -10, "x_max": 10, "z_min": -10, "z_max": 10},
                }

            final_splat = self.output_dir / "model.splat"
            if splat_path.resolve() != final_splat.resolve():
                shutil.copy2(splat_path, final_splat)
            self._log(f"[PIPELINE] Model saved: {final_splat}")

            self._meta = {
                "session_id": self.session_id,
                "status": "complete",
                "model_path": f"/outputs/{self.session_id}/model.splat",
                "iterations": iterations,
                "image_count": image_count,
                **floor_data,
            }
            meta_path = self.output_dir / "meta.json"
            meta_path.write_text(json.dumps(self._meta, indent=2))

            self._status = "complete"
            self._log("[PIPELINE] ✓ Reconstruction complete!")

        except Exception as exc:
            self._status = "error"
            tb = traceback.format_exc()
            self._log(f"[PIPELINE][ERROR] {exc}")
            self._log(f"[PIPELINE][TRACEBACK]\n{tb}")

            self._meta = {
                "session_id": self.session_id,
                "status": "error",
                "error": str(exc),
            }
            meta_path = self.output_dir / "meta.json"
            self.output_dir.mkdir(parents=True, exist_ok=True)
            meta_path.write_text(json.dumps(self._meta, indent=2))
