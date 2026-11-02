"""Image normalisation for reconstruction.

Every image is converted to an upright, sRGB, 8-bit JPEG with a bounded long
edge. Originals are never modified; the normalised copies live in the job's
work directory and are the only inputs to SfM and Gaussian training.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Sequence

from PIL import Image, ImageOps


class ImagePreparationError(RuntimeError):
    """Raised when a source image cannot be normalised."""


@dataclass
class PreparedImage:
    source: str
    output: str
    width: int
    height: int
    bytes: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalise(source: Path, destination: Path, max_edge: int, quality: int) -> PreparedImage:
    try:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            # Explicit sRGB conversion: profiles and CMYK/16-bit inputs are
            # flattened to 8-bit RGB before JPEG encoding.
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            elif image.mode == "L":
                image = image.convert("RGB")
            if max(image.size) > max_edge:
                image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            destination.parent.mkdir(parents=True, exist_ok=True)
            image.save(destination, "JPEG", quality=quality, optimize=True, subsampling=1)
            width, height = image.size
    except Exception as exc:  # noqa: BLE001 - report the real source failure
        raise ImagePreparationError(f"Could not normalise '{source.name}': {exc}") from exc

    return PreparedImage(
        source=source.name,
        output=destination.name,
        width=width,
        height=height,
        bytes=destination.stat().st_size,
    )


def prepare_images(
    images: Sequence[Path],
    destination: Path,
    *,
    max_edge: int = 1600,
    quality: int = 92,
) -> list[PreparedImage]:
    if not images:
        raise ImagePreparationError("No images were provided for preprocessing.")
    destination.mkdir(parents=True, exist_ok=True)
    for stale in destination.glob("frame_*.jpg"):
        try:
            stale.unlink()
        except OSError:
            pass

    prepared: list[PreparedImage] = []
    for index, source in enumerate(images):
        output = destination / f"frame_{index:03d}.jpg"
        prepared.append(_normalise(Path(source), output, max_edge, quality))
    return prepared
