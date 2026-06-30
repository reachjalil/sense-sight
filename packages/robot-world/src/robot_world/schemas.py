"""Typed data model shared across the pipeline.

Plain ``dataclasses`` (no pydantic). Stored JSON documents carry a provenance
envelope (``schema_version`` / ``created_at`` / ``producer`` / ``config_hash``)
via :func:`envelope`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

SCHEMA_VERSION = "0.1.0"
PRODUCER = "robot_world"


def now_iso() -> str:
    """UTC timestamp in ISO-8601, second precision."""

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def envelope(config_hash: str, extra: dict | None = None) -> dict:
    """Provenance envelope stamped onto every stored JSON document."""

    env = {
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "producer": PRODUCER,
        "config_hash": config_hash,
    }
    if extra:
        env.update(extra)
    return env


@dataclass(frozen=True)
class Vec3:
    x: float
    y: float
    z: float

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z}


@dataclass(frozen=True)
class Quaternion:
    """Unit quaternion, scalar-last (x, y, z, w) — matches OpenLORIS TUM poses."""

    x: float
    y: float
    z: float
    w: float

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z, "w": self.w}

    def yaw_about_z(self) -> float:
        """Yaw (rotation about the +Z up-axis of the OpenLORIS world frame)."""

        siny = 2.0 * (self.w * self.z + self.x * self.y)
        cosy = 1.0 - 2.0 * (self.y * self.y + self.z * self.z)
        return math.atan2(siny, cosy)


@dataclass(frozen=True)
class CameraIntrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int

    def to_dict(self) -> dict:
        return {
            "fx": self.fx,
            "fy": self.fy,
            "cx": self.cx,
            "cy": self.cy,
            "width": self.width,
            "height": self.height,
        }


@dataclass(frozen=True)
class FrameRecord:
    """One entry from a per-sequence frame manifest."""

    sequence: str
    frame_index: int
    timestamp: float
    image_path: str  # dataset-root relative
    depth_path: str  # dataset-root relative
    has_pose: bool
    position: Vec3  # dataset world frame (Z-up)
    quaternion: Quaternion


@dataclass(frozen=True)
class PoseEstimate:
    """A pose with provenance and a confidence in [0, 1]."""

    position: Vec3
    quaternion: Quaternion
    confidence: float
    source: str  # e.g. "manifest_groundtruth"
    timestamp: float


@dataclass(frozen=True)
class Keyframe:
    """A frame selected for reconstruction."""

    frame: FrameRecord
    pose: PoseEstimate
    depth_valid_ratio: float


@dataclass
class PointCloudChunk:
    """Backprojected points for one keyframe, in world coordinates (Z-up)."""

    keyframe_index: int
    xyz: object  # numpy.ndarray (N, 3) float32, world XYZ
    rgb: object  # numpy.ndarray (N, 3) uint8


@dataclass(frozen=True)
class Bounds:
    min: Vec3
    max: Vec3

    def to_dict(self) -> dict:
        return {"min": self.min.to_dict(), "max": self.max.to_dict()}
