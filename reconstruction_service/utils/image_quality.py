"""Image quality analysis: blur, exposure, duplicates and resolution."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
from PIL import Image, ImageOps


@dataclass
class ImageQuality:
    path: str
    width: int
    height: int
    sharpness: float
    brightness: float
    contrast: float
    dhash: int
    kept: bool = True
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["dhash"] = f"{self.dhash:016x}"
        return data


def _laplacian_variance(gray: np.ndarray) -> float:
    """Variance of the 4-neighbour Laplacian, without OpenCV."""
    if gray.ndim != 2 or gray.size < 16:
        return 0.0
    center = gray[1:-1, 1:-1].astype(np.float32)
    laplacian = (
        gray[:-2, 1:-1].astype(np.float32)
        + gray[2:, 1:-1].astype(np.float32)
        + gray[1:-1, :-2].astype(np.float32)
        + gray[1:-1, 2:].astype(np.float32)
        - 4.0 * center
    )
    return float(laplacian.var())


def _dhash(gray: np.ndarray) -> int:
    """64-bit difference hash of a 9x8 grayscale thumbnail."""
    resized = np.asarray(
        Image.fromarray(gray.astype(np.uint8)).resize((9, 8), Image.Resampling.LANCZOS),
        dtype=np.int16,
    )
    bits = (resized[:, 1:] > resized[:, :-1]).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return value


def hamming(a: int, b: int) -> int:
    return int((a ^ b).bit_count())


def analyse_image(path: Path, *, max_edge: int = 512) -> ImageQuality:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        width, height = image.size
        if max(image.size) > max_edge:
            image.thumbnail((max_edge, max_edge), Image.Resampling.BILINEAR)
        gray = np.asarray(image.convert("L"), dtype=np.uint8)
    sharpness = _laplacian_variance(gray)
    brightness = float(gray.mean())
    contrast = float(gray.std())
    return ImageQuality(
        path=str(path),
        width=width,
        height=height,
        sharpness=round(sharpness, 2),
        brightness=round(brightness, 1),
        contrast=round(contrast, 1),
        dhash=_dhash(gray),
    )


def filter_images(
    paths: Sequence[Path],
    *,
    blur_threshold: float = 18.0,
    duplicate_hamming: int = 6,
    min_resolution: int = 320,
) -> tuple[list[ImageQuality], list[ImageQuality]]:
    """Split images into kept and rejected sets, preserving input order.

    Rejection rules (all evidence-based, never silent):
      * unreadable file            -> rejected
      * long edge < min_resolution -> rejected
      * Laplacian variance < blur_threshold -> rejected as blurry
      * dHash distance <= duplicate_hamming to an already-kept image -> duplicate
    """
    kept: list[ImageQuality] = []
    rejected: list[ImageQuality] = []
    for path in paths:
        try:
            quality = analyse_image(path)
        except Exception as exc:  # noqa: BLE001 - report the real reason
            rejected.append(
                ImageQuality(
                    path=str(path),
                    width=0,
                    height=0,
                    sharpness=0.0,
                    brightness=0.0,
                    contrast=0.0,
                    dhash=0,
                    kept=False,
                    reason=f"unreadable: {exc}",
                )
            )
            continue

        if max(quality.width, quality.height) < min_resolution:
            quality.kept = False
            quality.reason = f"resolution {quality.width}x{quality.height} below {min_resolution}px"
            rejected.append(quality)
            continue

        if quality.sharpness < blur_threshold:
            quality.kept = False
            quality.reason = (
                f"blurry (Laplacian variance {quality.sharpness:.1f} < {blur_threshold:.1f})"
            )
            rejected.append(quality)
            continue

        duplicate_of = None
        for accepted in kept:
            if hamming(quality.dhash, accepted.dhash) <= duplicate_hamming:
                duplicate_of = accepted
                break
        if duplicate_of is not None:
            quality.kept = False
            quality.reason = f"near-duplicate of {Path(duplicate_of.path).name}"
            rejected.append(quality)
            continue

        kept.append(quality)

    return kept, rejected


def quality_report(
    kept: Iterable[ImageQuality], rejected: Iterable[ImageQuality]
) -> dict[str, Any]:
    kept_list = list(kept)
    rejected_list = list(rejected)
    sharpness = [item.sharpness for item in kept_list] or [0.0]
    return {
        "totalAnalysed": len(kept_list) + len(rejected_list),
        "kept": len(kept_list),
        "rejected": len(rejected_list),
        "meanSharpness": round(float(np.mean(sharpness)), 2),
        "minSharpness": round(float(np.min(sharpness)), 2),
        "images": [item.as_dict() for item in kept_list],
        "rejections": [
            {"path": Path(item.path).name, "reason": item.reason} for item in rejected_list
        ],
    }
