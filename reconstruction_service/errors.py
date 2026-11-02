"""Shared exception types used across stages and engines."""

from __future__ import annotations


class ReconstructionError(RuntimeError):
    """A reconstruction failed for a reason the user can act on."""


class PipelineCancelled(ReconstructionError):
    """The job was cancelled by the user."""


class StageFailed(ReconstructionError):
    """A pipeline stage failed; the message is user-facing."""


class EngineUnavailable(ReconstructionError):
    """An optional external engine is not installed or cannot run."""
