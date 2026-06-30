"""Keyframe selection.

Pick a subset of frames spread across the sequence using a motion gate
(minimum translation OR rotation since the last accepted keyframe) with an
every-Nth fallback so stationary stretches are still sampled. Frames whose
valid-depth ratio is too low are skipped (they would contribute few or noisy
points).

Depth-ratio measurement reads the aligned-depth PNG; ``depth_ratio_fn`` is
injected so tests can supply a cheap synthetic measurement while a real run
uses the Pillow-backed loader.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from ..config import KeyframeConfig
from ..schemas import FrameRecord, Keyframe, PoseEstimate, Quaternion

# A function that returns the valid-depth ratio for a frame (0..1).
DepthRatioFn = Callable[[FrameRecord], float]


def _quat_angle_between(a: Quaternion, b: Quaternion) -> float:
    """Geodesic angle (rad) between two unit quaternions."""

    dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
    dot = max(-1.0, min(1.0, abs(dot)))
    return 2.0 * math.acos(dot)


def _translation(a: PoseEstimate, b: PoseEstimate) -> float:
    dx = a.position.x - b.position.x
    dy = a.position.y - b.position.y
    dz = a.position.z - b.position.z
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def select(
    posed_frames: Sequence[tuple[FrameRecord, PoseEstimate]],
    config: KeyframeConfig,
    depth_ratio_fn: DepthRatioFn,
    max_keyframes: int | None = None,
) -> list[Keyframe]:
    """Select keyframes from time-ordered (frame, pose) pairs.

    Strategy (depth IO is evaluated lazily, only on motion-gated candidates,
    so not every depth map in the sequence is read):
      1. Walk frames in time order; a frame is a candidate when it clears the
         motion gate (min translation OR rotation) OR the every-Nth fallback.
      2. For each candidate, measure the depth-valid ratio and skip it if too
         low (advancing the motion baseline only on accepted frames).
      3. If more frames are accepted than ``target_count``/``max_keyframes``,
         uniformly subsample to spread coverage across the whole sequence.
    """

    if not posed_frames:
        return []

    cap = config.target_count
    if max_keyframes is not None:
        cap = min(cap, max_keyframes) if cap else max_keyframes

    accepted: list[Keyframe] = []
    last_pose: PoseEstimate | None = None
    last_accept_i = -(10**9)

    for i, (frame, pose) in enumerate(posed_frames):
        moved_enough = last_pose is None
        if last_pose is not None:
            trans = _translation(pose, last_pose)
            rot = _quat_angle_between(pose.quaternion, last_pose.quaternion)
            moved_enough = (
                trans >= config.min_translation_m or rot >= config.min_rotation_rad
            )
        nth_fallback = (i - last_accept_i) >= config.every_nth
        if not (moved_enough or nth_fallback):
            continue

        # Only now pay the depth-IO cost for this candidate.
        ratio = depth_ratio_fn(frame)
        if ratio < config.min_depth_valid_ratio:
            continue

        accepted.append(Keyframe(frame=frame, pose=pose, depth_valid_ratio=ratio))
        last_pose = pose
        last_accept_i = i

    # Spread/subsample to the cap while preserving time order and endpoints.
    if cap and len(accepted) > cap:
        accepted = _uniform_subsample(accepted, cap)
    return accepted


def _uniform_subsample(items: list[Keyframe], cap: int) -> list[Keyframe]:
    """Evenly pick ``cap`` items across ``items`` keeping first and last."""

    n = len(items)
    if cap <= 0 or n <= cap:
        return items
    if cap == 1:
        return [items[0]]
    out: list[Keyframe] = []
    step = (n - 1) / (cap - 1)
    seen: set[int] = set()
    for k in range(cap):
        idx = round(k * step)
        if idx not in seen:
            seen.add(idx)
            out.append(items[idx])
    return out
