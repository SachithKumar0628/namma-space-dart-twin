"""
Simple reconstruction pipeline package.

Provides a lightweight, self-contained COLMAP SfM + Gaussian Splatting +
floor estimation pipeline as an alternative to the advanced multi-stage
pipeline in the parent ``pipeline`` package.
"""

from .runner import PipelineRunner

__all__ = ["PipelineRunner"]
