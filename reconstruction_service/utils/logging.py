"""Structured logging and stage recording.

The service writes two complementary artefacts per job:

* ``job.log``       - human-readable, append-only, shown in the UI.
* ``stages.jsonl``  - one JSON object per stage with timing, memory and result,
                      used by the automated validation harness.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PipelineLogger:
    """Thread-safe append-only text log."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._file = self.path.open("a", encoding="utf-8", buffering=1)

    def __call__(self, message: str) -> None:
        line = f"[{utc_now()}] {message}\n"
        with self._lock:
            try:
                self._file.write(line)
                self._file.flush()
            except OSError:
                pass
        try:
            print(line, end="", flush=True)
        except Exception:  # noqa: BLE001 - console may be detached
            pass

    def close(self) -> None:
        try:
            self._file.close()
        except OSError:
            pass

    def tail(self, max_bytes: int = 200_000) -> str:
        try:
            with self.path.open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                size = handle.tell()
                handle.seek(max(0, size - max_bytes))
                return handle.read().decode("utf-8", errors="replace")
        except OSError:
            return ""


class StageRecorder:
    """Records one machine-readable event per pipeline stage."""

    def __init__(self, path: Path, logger: Callable[[str], None] | None = None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.logger = logger or (lambda _message: None)
        self._lock = threading.Lock()
        self._started: dict[str, float] = {}

    def start(self, stage: str) -> None:
        self._started[stage] = time.perf_counter()

    def finish(
        self,
        stage: str,
        status: str,
        *,
        inputs: dict[str, Any] | None = None,
        outputs: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        started = self._started.pop(stage, None)
        duration = round(time.perf_counter() - started, 3) if started else None
        record = {
            "stage": stage,
            "status": status,  # passed | failed | skipped | not_tested
            "startedAt": utc_now(),
            "durationSeconds": duration,
            "inputs": inputs or {},
            "outputs": outputs or {},
            "metrics": metrics or {},
            "error": error,
        }
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.logger(
            f"stage={stage} status={status} duration={duration}s"
            + (f" error={error}" if error else "")
        )
        return record
