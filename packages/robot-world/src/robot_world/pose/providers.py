"""Pose provider protocol.

A pose provider yields a :class:`~robot_world.schemas.PoseEstimate` for a
frame, with provenance and a confidence in ``[0, 1]``. Multiple providers
(robot odometry, SLAM, pose refinement) can be arbitrated by
:class:`~robot_world.pose.pose_selector.PoseSelector`.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..schemas import FrameRecord, PoseEstimate


@runtime_checkable
class PoseProvider(Protocol):
    """Protocol for a per-frame pose source."""

    source: str

    def pose_for(self, frame: FrameRecord) -> PoseEstimate | None:
        """Return a pose for ``frame``, or None if unavailable."""
