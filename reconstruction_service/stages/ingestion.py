"""Capture ingestion: images + videos -> a validated, normalised dataset.

Stage responsibilities
----------------------
1. Classify and validate every uploaded file (by content, not just extension).
2. Preserve the originals untouched (they live in ``input/originals``).
3. Decode videos with FFmpeg into real frames (no placeholders).
4. Reject blurry and near-duplicate frames with measured evidence.
5. Normalise EXIF orientation, colour and resolution for SfM/training.
6. Write ``ingestion.json`` describing every decision.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from PIL import Image

from ..config import SETTINGS
from ..errors import ReconstructionError
from ..utils.filesystem import sha256_file
from ..utils.image_quality import filter_images, quality_report
from ..utils.logging import utc_now
from .image_preprocessing import PreparedImage, prepare_images
from .video_extraction import VideoExtractionError, extract_frames, probe_video

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}

VIDEO_CODECS = {"h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "prores", "mjpeg"}
IMAGE_CODECS = {"mjpeg", "png", "webp", "bmp", "tiff", "jpeg2000"}


def _is_readable_image(path: Path) -> tuple[bool, str | None]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
        return True, None
    except Exception as exc:  # noqa: BLE001 - report the real decoder error
        return False, str(exc)


def _evenly_spaced(items: list[Path], limit: int) -> list[Path]:
    if len(items) <= limit:
        return items
    if limit <= 1:
        return items[:1]
    step = (len(items) - 1) / (limit - 1)
    return [items[round(index * step)] for index in range(limit)]


def ingest(
    sources: list[Path],
    work_dir: Path,
    *,
    logger: Callable[[str], None],
    progress: Callable[[int, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if not sources:
        raise ReconstructionError("No files were uploaded for this reconstruction.")

    originals_dir = work_dir / "originals"
    extracted_dir = work_dir / "extracted"
    prepared_dir = work_dir / "images"
    originals_dir.mkdir(parents=True, exist_ok=True)
    extracted_dir.mkdir(parents=True, exist_ok=True)
    prepared_dir.mkdir(parents=True, exist_ok=True)

    image_sources: list[Path] = []
    video_sources: list[Path] = []
    originals: list[dict[str, Any]] = []
    warnings: list[str] = []

    if progress:
        progress(2, f"Validating {len(sources)} uploaded file(s)")

    for source in sources:
        if cancel is not None and cancel():
            raise ReconstructionError("Reconstruction cancelled by the user.")
        suffix = source.suffix.lower()
        if suffix in VIDEO_SUFFIXES:
            video_sources.append(source)
        elif suffix in IMAGE_SUFFIXES:
            ok, error = _is_readable_image(source)
            if not ok:
                raise ReconstructionError(f"'{source.name}' is not a readable image: {error}")
            image_sources.append(source)
        else:
            raise ReconstructionError(
                f"'{source.name}' is not a supported capture. Use JPG, JPEG, PNG, "
                "WebP, MP4 or MOV."
            )

        try:
            digest = sha256_file(source)
        except OSError:
            digest = ""
        originals.append(
            {
                "name": source.name,
                "bytes": source.stat().st_size if source.is_file() else 0,
                "sha256": digest,
                "kind": "video" if suffix in VIDEO_SUFFIXES else "image",
            }
        )

    # Preserve the exact uploads under work/originals for provenance.
    preserved: list[Path] = []
    for index, source in enumerate(sources):
        target = originals_dir / f"{index:03d}_{source.name}"
        try:
            if not target.exists():
                shutil.copy2(source, target)
            preserved.append(target)
        except OSError as exc:
            warnings.append(f"Could not archive {source.name}: {exc}")

    frame_sources: list[Path] = []
    videos: list[dict[str, Any]] = []
    for index, video in enumerate(video_sources):
        if cancel is not None and cancel():
            raise ReconstructionError("Reconstruction cancelled by the user.")
        info = probe_video(video)
        if info.codec and info.codec not in VIDEO_CODECS:
            warnings.append(
                f"{video.name} uses codec '{info.codec}', which may not decode correctly."
            )
        if info.duration_seconds and info.duration_seconds > SETTINGS.video_max_seconds:
            warnings.append(
                f"{video.name} is {info.duration_seconds:.0f}s long; only the first "
                f"{SETTINGS.video_max_seconds:.0f}s were sampled."
            )
        try:
            frames, info, metadata = extract_frames(
                video,
                extracted_dir / f"{index:02d}_{video.stem}",
                interval_seconds=SETTINGS.video_interval_seconds,
                max_frames=SETTINGS.video_max_frames,
                max_seconds=SETTINGS.video_max_seconds,
            )
        except VideoExtractionError as exc:
            raise ReconstructionError(str(exc)) from exc

        logger(f"Extracted {len(frames)} real frames from {video.name}")
        frame_sources.extend(frames)
        videos.append(
            {
                "name": video.name,
                "info": info.as_dict(),
                "frames": len(frames),
                "ffmpeg": metadata,
            }
        )

    candidates = image_sources + frame_sources
    if len(candidates) < SETTINGS.min_images:
        raise ReconstructionError(
            f"Only {len(candidates)} capture(s) were available after decoding; at least "
            f"{SETTINGS.min_images} overlapping images or video frames are required."
        )

    if progress:
        progress(5, f"Checking sharpness and duplicates across {len(candidates)} frames")
    kept, rejected = filter_images(
        candidates,
        blur_threshold=SETTINGS.blur_threshold,
        duplicate_hamming=SETTINGS.duplicate_hamming,
    )
    quality = quality_report(kept, rejected)
    if len(kept) < SETTINGS.min_usable_images:
        reasons = "; ".join(
            f"{Path(item.path).name}: {item.reason}" for item in rejected[:5]
        )
        raise ReconstructionError(
            f"Only {len(kept)} of {len(candidates)} frames passed quality checks; "
            f"{SETTINGS.min_usable_images} are required. {reasons}"
        )

    usable = [Path(item.path) for item in kept]
    if len(usable) > SETTINGS.max_usable_images:
        warnings.append(
            f"{len(usable)} usable frames exceed the {SETTINGS.max_usable_images}-frame "
            "budget; evenly spaced frames were selected."
        )
        usable = _evenly_spaced(usable, SETTINGS.max_usable_images)

    if progress:
        progress(6, f"Normalising {len(usable)} images for reconstruction")
    prepared: list[PreparedImage] = prepare_images(
        usable,
        prepared_dir,
        max_edge=SETTINGS.max_image_size,
        quality=SETTINGS.jpeg_quality,
    )

    manifest = {
        "generatedAt": utc_now(),
        "originals": originals,
        "videos": videos,
        "inputImages": len(image_sources),
        "inputVideos": len(video_sources),
        "extractedFrames": len(frame_sources),
        "quality": quality,
        "selectedImages": len(prepared),
        "prepared": [item.as_dict() for item in prepared],
        "warnings": warnings,
        "limits": {
            "maxImageSize": SETTINGS.max_image_size,
            "blurThreshold": SETTINGS.blur_threshold,
            "duplicateHamming": SETTINGS.duplicate_hamming,
            "maxUsableImages": SETTINGS.max_usable_images,
        },
        "archivedOriginals": len(preserved),
    }
    from ..utils.filesystem import atomic_write_json

    atomic_write_json(work_dir / "ingestion.json", manifest)

    return {
        "preparedDirectory": str(prepared_dir),
        "prepared": [item.as_dict() for item in prepared],
        "preparedCount": len(prepared),
        "quality": quality,
        "videos": videos,
        "warnings": warnings,
        "originals": originals,
        "archivedOriginals": len(preserved),
        "manifest": manifest,
    }
