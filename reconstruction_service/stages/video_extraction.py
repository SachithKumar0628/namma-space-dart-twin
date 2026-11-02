"""Server-side video ingestion with FFmpeg.

Frames are only ever produced by FFmpeg decoding a real video stream. If the
decode fails, or produces no frames, the stage raises: the pipeline never
fabricates placeholder frames.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from ..config import SETTINGS


class VideoExtractionError(RuntimeError):
    """Raised when a video cannot be decoded into real frames."""


@dataclass
class VideoInfo:
    path: str
    duration_seconds: float | None
    width: int | None
    height: int | None
    fps: float | None
    codec: str | None
    frame_count: int | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _ffprobe_json(path: Path) -> dict[str, Any]:
    ffprobe = SETTINGS.ffprobe_binary
    if ffprobe is None:
        return {}
    try:
        completed = subprocess.run(
            [
                str(ffprobe),
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
        if completed.returncode != 0 or not completed.stdout.strip():
            return {}
        return json.loads(completed.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}


def probe_video(path: Path) -> VideoInfo:
    payload = _ffprobe_json(path)
    stream = next(
        (item for item in payload.get("streams", []) if item.get("codec_type") == "video"),
        {},
    )
    fmt = payload.get("format", {})

    def _number(value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    fps = None
    rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate")
    if isinstance(rate, str) and "/" in rate:
        numerator, denominator = rate.split("/", 1)
        try:
            if float(denominator) != 0:
                fps = float(numerator) / float(denominator)
        except ValueError:
            fps = None

    duration = _number(fmt.get("duration")) or _number(stream.get("duration"))
    frames = None
    try:
        frames = int(stream.get("nb_frames")) if stream.get("nb_frames") else None
    except (TypeError, ValueError):
        frames = None

    return VideoInfo(
        path=str(path),
        duration_seconds=duration,
        width=int(stream["width"]) if stream.get("width") else None,
        height=int(stream["height"]) if stream.get("height") else None,
        fps=round(fps, 3) if fps else None,
        codec=stream.get("codec_name"),
        frame_count=frames,
    )


def extract_frames(
    video: Path,
    output_dir: Path,
    *,
    interval_seconds: float | None = None,
    max_frames: int | None = None,
    max_seconds: float | None = None,
) -> tuple[list[Path], VideoInfo, dict[str, Any]]:
    """Decode a video into JPEG keyframes using FFmpeg.

    Returns ``(frames, video_info, ffmpeg_metadata)``. Raises
    :class:`VideoExtractionError` when the real decode produces nothing.
    """
    ffmpeg = SETTINGS.ffmpeg_binary
    if ffmpeg is None:
        raise VideoExtractionError(
            "FFmpeg was not found. Install FFmpeg or set FFMPEG_BINARY so video "
            "captures can be decoded on the server."
        )
    if not video.is_file():
        raise VideoExtractionError(f"Video file does not exist: {video}")

    interval = float(interval_seconds or SETTINGS.video_interval_seconds)
    interval = max(0.1, min(30.0, interval))
    limit = int(max_frames or SETTINGS.video_max_frames)
    limit = max(1, min(600, limit))
    seconds = float(max_seconds or SETTINGS.video_max_seconds)
    seconds = max(1.0, min(3600.0, seconds))

    info = probe_video(video)
    output_dir.mkdir(parents=True, exist_ok=True)
    for stale in output_dir.glob("frame_*.jpg"):
        try:
            stale.unlink()
        except OSError:
            pass

    pattern = output_dir / "frame_%05d.jpg"
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(video),
        "-t",
        f"{seconds:.3f}",
        "-vf",
        f"fps=1/{interval:.4f}",
        "-frames:v",
        str(limit),
        "-q:v",
        "2",
        str(pattern),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=max(120, int(seconds) + 300),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise VideoExtractionError(
            f"FFmpeg timed out while decoding {video.name}."
        ) from exc
    except OSError as exc:
        raise VideoExtractionError(f"Could not start FFmpeg: {exc}") from exc

    if completed.returncode != 0:
        detail = (completed.stderr or "").strip().splitlines()[-3:]
        raise VideoExtractionError(
            f"FFmpeg could not decode {video.name}: " + " | ".join(detail or ["unknown error"])
        )

    frames = sorted(output_dir.glob("frame_*.jpg"))
    if not frames:
        raise VideoExtractionError(
            f"FFmpeg decoded no frames from {video.name}. The file may be corrupt, "
            "empty or use an unsupported codec."
        )

    metadata = {
        "command": " ".join(command),
        "intervalSeconds": interval,
        "maxFrames": limit,
        "maxSeconds": seconds,
        "stderr": (completed.stderr or "").strip()[-2000:],
    }
    return frames, info, metadata


def video_frame_number(path: Path) -> int | None:
    match = re.search(r"(\d+)", path.stem)
    return int(match.group(1)) if match else None
