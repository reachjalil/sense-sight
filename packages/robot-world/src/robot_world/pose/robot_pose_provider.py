"""Robot ground-truth pose provider.

Uses the world-frame poses already joined into the frame manifest. Frames with
``has_pose=False`` produce no estimate (the caller skips them). Confidence is
1.0 by default since OpenLORIS ships high-quality MoCap/SLAM ground truth for
its corridor sequences.
"""

from __future__ import annotations

from ..schemas import FrameRecord, PoseEstimate


class RobotPoseProvider:
    """Pose provider backed by manifest ground-truth poses."""

    source = "manifest_groundtruth"

    def __init__(self, confidence: float = 1.0) -> None:
        self.confidence = confidence

    def pose_for(self, frame: FrameRecord) -> PoseEstimate | None:
        if not frame.has_pose:
            return None
        return PoseEstimate(
            position=frame.position,
            quaternion=frame.quaternion,
            confidence=self.confidence,
            source=self.source,
            timestamp=frame.timestamp,
        )
