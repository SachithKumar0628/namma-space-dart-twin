"""Small filesystem helpers with Windows-safe semantics."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def atomic_write_json(path: Path, data: Any, *, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=indent, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def sha256_file(path: Path, chunk: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def safe_rmtree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def new_job_id() -> str:
    return f"rec_{uuid.uuid4().hex[:16]}"


def safe_name(name: str, fallback: str = "file") -> str:
    """Return a filesystem-safe basename, preserving the extension."""
    base = Path(name or fallback).name
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in base)
    cleaned = cleaned.strip("._") or fallback
    return cleaned[:120]


def human_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def free_disk_bytes(path: Path) -> int:
    try:
        return shutil.disk_usage(path).free
    except OSError:
        return 0
