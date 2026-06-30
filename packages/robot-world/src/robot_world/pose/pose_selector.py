"""Pose arbitration.

Selects the best available pose per frame from one or more ordered providers.
A single provider (robot ground truth) is enough for the default pipeline, but
the arbitration interface stays in place so additional sources (refined SLAM,
visual odometry) can be layered in later with confidence-based selection.
"""

from __future__ import annotations

from collections.abc import Sequence

from ..schemas import FrameRecord, PoseEstimate
from .providers import PoseProvider


class PoseSelector:
    """Pick the highest-confidence available pose per frame."""

    def __init__(self, providers: Sequence[PoseProvider]) -> None:
        if not providers:
            raise ValueError("PoseSelector requires at least one provider")
        self.providers = list(providers)

    def select(self, frame: FrameRecord) -> PoseEstimate | None:
        """Return the best pose for ``frame``, or None if none available."""

        best: PoseEstimate | None = None
        for provider in self.providers:
            est = provider.pose_for(frame)
            if est is None:
                continue
            if best is None or est.confidence > best.confidence:
                best = est
        return best

    def select_all(
        self, frames: Sequence[FrameRecord]
    ) -> list[tuple[FrameRecord, PoseEstimate]]:
        """Return (frame, pose) pairs for frames that have a pose."""

        out: list[tuple[FrameRecord, PoseEstimate]] = []
        for frame in frames:
            est = self.select(frame)
            if est is not None:
                out.append((frame, est))
        return out
