"""Central configuration for the Namma Space reconstruction service.

Every tunable lives here and is read from the environment exactly once. The
defaults are chosen for the target laptop (RTX 3050 Laptop, 4 GB VRAM,
16 GB RAM) so that a fresh checkout runs without editing files.

Nothing in this module touches the GPU or imports torch; it must stay cheap
enough to import from the FastAPI process on startup.
"""

from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SERVICE_DIR = Path(__file__).resolve().parent


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _data_root() -> Path:
    configured = os.getenv("DART_RECONSTRUCTION_DATA", "").strip()
    if configured:
        root = Path(os.path.expanduser(configured))
        return root if root.is_absolute() else (PROJECT_ROOT / root).resolve()
    return (PROJECT_ROOT / "data" / "reconstructions").resolve()


def find_colmap() -> Path | None:
    """Locate the COLMAP executable (CUDA build preferred)."""
    candidates: list[Path] = []
    configured = os.getenv("COLMAP_BINARY", "").strip()
    if configured:
        candidates.append(Path(os.path.expanduser(configured)))
    candidates.extend(
        [
            PROJECT_ROOT / "colmap-x64-windows-cuda" / "bin" / "colmap.exe",
            Path("C:/COLMAP/colmap-x64-windows-cuda/bin/colmap.exe"),
            Path("C:/COLMAP/COLMAP.bat"),
        ]
    )
    on_path = shutil.which("colmap")
    if on_path:
        candidates.append(Path(on_path))
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def find_blender() -> Path | None:
    """Locate Blender. It is installed here but not on PATH."""
    configured = os.getenv("BLENDER_BINARY", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(os.path.expanduser(configured)))
    on_path = shutil.which("blender")
    if on_path:
        candidates.append(Path(on_path))
    for base in (
        Path("C:/Program Files/Blender Foundation"),
        Path("C:/Program Files (x86)/Blender Foundation"),
    ):
        try:
            for child in sorted(base.glob("Blender */blender.exe"), reverse=True):
                candidates.append(child)
        except OSError:
            continue
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def find_brush(root: Path | str | None = None) -> Path | None:
    """Locate the Brush Gaussian-splatting executable."""
    base = Path(root) if root else PROJECT_ROOT
    candidates: list[Path] = []
    configured = os.getenv("BRUSH_BINARY", "").strip()
    if configured:
        candidate = Path(os.path.expanduser(configured))
        candidates.append(candidate if candidate.is_absolute() else base / candidate)
    candidates.extend(
        [
            base / ".tools" / "brush" / "brush_app.exe",
            base / ".tools" / "brush" / "brush_app",
            base / "brush_app.exe",
        ]
    )
    for name in ("brush_app", "brush", "brush-app"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def find_ffmpeg() -> Path | None:
    for name in ("ffmpeg", "ffmpeg.exe"):
        found = shutil.which(name)
        if found:
            return Path(found)
    for candidate in (Path("C:/ffmpeg/bin/ffmpeg.exe"), Path("C:/Program Files/ffmpeg/bin/ffmpeg.exe")):
        if candidate.is_file():
            return candidate
    return None


def find_ffprobe() -> Path | None:
    configured = os.getenv("FFPROBE_BINARY", "").strip()
    if configured and Path(configured).is_file():
        return Path(configured)
    ffmpeg = find_ffmpeg()
    if ffmpeg is not None:
        sibling = ffmpeg.with_name("ffprobe" + ffmpeg.suffix)
        if sibling.is_file():
            return sibling
    for name in ("ffprobe", "ffprobe.exe"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def ensure_runtime_path() -> None:
    """Make the active interpreter's Scripts dir visible to child processes.

    gsplat compiles its CUDA backend on first use and needs `ninja` on PATH.
    pip installs ninja.exe into the environment's Scripts directory, which is
    not always on PATH when the service is launched from npm.
    """
    python_dir = Path(sys.executable).resolve().parent
    scripts = python_dir / "Scripts"
    parts = [str(python_dir), str(scripts), str(python_dir / "Library" / "bin")]
    current = os.environ.get("PATH", "")
    additions = [part for part in parts if part and part.lower() not in current.lower()]
    if additions:
        os.environ["PATH"] = os.pathsep.join(additions + [current])


@dataclass(frozen=True)
class Settings:
    # Storage ---------------------------------------------------------------
    data_root: Path = field(default_factory=_data_root)
    keep_work: bool = field(default_factory=lambda: _bool("DART_KEEP_WORK", False))
    max_file_mb: int = field(default_factory=lambda: _int("DART_MAX_FILE_MB", 512, 1, 8192))
    max_total_mb: int = field(default_factory=lambda: _int("DART_MAX_TOTAL_MB", 4096, 0, 65536))
    max_photos: int = field(default_factory=lambda: _int("DART_MAX_PHOTOS", 0, 0, 10000))

    # Ingestion / preprocessing ---------------------------------------------
    max_image_size: int = field(default_factory=lambda: _int("DART_MAX_IMAGE_SIZE", 1600, 640, 4096))
    jpeg_quality: int = field(default_factory=lambda: _int("DART_JPEG_QUALITY", 92, 70, 100))
    blur_threshold: float = field(default_factory=lambda: _float("DART_BLUR_THRESHOLD", 18.0, 0.0, 500.0))
    duplicate_hamming: int = field(default_factory=lambda: _int("DART_DUPLICATE_HAMMING", 6, 0, 32))
    min_images: int = field(default_factory=lambda: _int("DART_MIN_IMAGES", 3, 3, 500))
    min_usable_images: int = field(default_factory=lambda: _int("DART_MIN_USABLE_IMAGES", 3, 3, 500))
    max_usable_images: int = field(
        default_factory=lambda: _int("DART_MAX_USABLE_IMAGES", 120, 3, 1000)
    )

    # Video ----------------------------------------------------------------
    video_interval_seconds: float = field(
        default_factory=lambda: _float("DART_VIDEO_INTERVAL", 0.75, 0.1, 30.0)
    )
    video_max_frames: int = field(default_factory=lambda: _int("DART_VIDEO_MAX_FRAMES", 80, 8, 600))
    video_max_seconds: float = field(default_factory=lambda: _float("DART_VIDEO_MAX_SECONDS", 180.0, 5.0, 3600.0))

    # SfM ------------------------------------------------------------------
    sfm_engine: str = field(default_factory=lambda: os.getenv("DART_SFM_ENGINE", "pycolmap").strip().lower())
    sfm_device: str = field(default_factory=lambda: os.getenv("DART_SFM_DEVICE", "auto").strip().lower())
    max_features: int = field(default_factory=lambda: _int("DART_MAX_FEATURES", 8192, 1024, 32768))
    max_matches: int = field(default_factory=lambda: _int("DART_MAX_MATCHES", 65536, 4096, 65536))
    sfm_threads: int = field(default_factory=lambda: _int("DART_SFM_THREADS", min(8, os.cpu_count() or 4), 1, 64))
    min_registration_rate: float = field(
        default_factory=lambda: _float("DART_MIN_REGISTRATION_RATE", 0.34, 0.1, 1.0)
    )
    exhaustive_match_limit: int = field(default_factory=lambda: _int("DART_EXHAUSTIVE_LIMIT", 80, 4, 400))

    # Dense MVS ------------------------------------------------------------
    dense_enabled: bool = field(default_factory=lambda: _bool("DART_DENSE_ENABLED", True))
    dense_max_image_size: int = field(
        default_factory=lambda: _int("DART_DENSE_MAX_IMAGE_SIZE", 1280, 640, 4000)
    )
    dense_gpu_index: int = field(default_factory=lambda: _int("DART_DENSE_GPU_INDEX", 0, 0, 8))
    dense_timeout_seconds: int = field(
        default_factory=lambda: _int("DART_DENSE_TIMEOUT", 5400, 120, 43200)
    )
    mesh_target_triangles: int = field(
        default_factory=lambda: _int("DART_MESH_TRIANGLES", 150000, 5000, 2000000)
    )
    mesh_poisson_depth: int = field(default_factory=lambda: _int("DART_MESH_DEPTH", 8, 6, 12))

    # Gaussian splatting ---------------------------------------------------
    splat_engine: str = field(
        default_factory=lambda: os.getenv("DART_SPLAT_ENGINE", "auto").strip().lower()
    )
    splat_steps: int = field(default_factory=lambda: _int("DART_SPLAT_STEPS", 8000, 100, 40000))
    splat_resolution: int = field(
        default_factory=lambda: _int("DART_SPLAT_RESOLUTION", 720, 320, 1920)
    )
    splat_max: int = field(default_factory=lambda: _int("DART_SPLAT_MAX", 250000, 10000, 2000000))
    splat_timeout_seconds: int = field(
        default_factory=lambda: _int("DART_SPLAT_TIMEOUT", 3600, 120, 21600)
    )
    vram_limit_mb: int = field(default_factory=lambda: _int("DART_VRAM_LIMIT_MB", 3200, 1024, 24000))
    vram_poll_seconds: float = field(
        default_factory=lambda: _float("DART_VRAM_POLL", 1.0, 0.2, 10.0)
    )

    # External tools -------------------------------------------------------
    colmap_binary: Path | None = field(default_factory=find_colmap)
    blender_binary: Path | None = field(default_factory=find_blender)
    brush_binary: Path | None = field(default_factory=find_brush)
    ffmpeg_binary: Path | None = field(default_factory=find_ffmpeg)
    ffprobe_binary: Path | None = field(default_factory=find_ffprobe)

    def public(self) -> dict[str, Any]:
        """Serialisable subset for /health (no secrets, no raw settings dump)."""
        data = asdict(self)
        for key in ("colmap_binary", "blender_binary", "brush_binary", "ffmpeg_binary", "ffprobe_binary"):
            data[key] = str(data[key]) if data[key] else None
        data["data_root"] = str(self.data_root)
        return data


SETTINGS = Settings()
