"""Configuration objects for the reconstruction pipeline.

Tunables live here as small frozen dataclasses so a run is reproducible and its
identity can be hashed into a ``config_hash`` stamped on every stored artifact.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class KeyframeConfig:
    """Keyframe selection policy."""

    target_count: int = 180
    # Minimum motion between accepted keyframes (world meters / radians).
    min_translation_m: float = 0.12
    min_rotation_rad: float = 0.12
    # Fallback: always accept every Nth frame even if the motion gate is not met.
    every_nth: int = 16
    # Skip frames whose valid-depth ratio is below this.
    min_depth_valid_ratio: float = 0.15


@dataclass(frozen=True)
class BackprojectConfig:
    """RGB-D -> point cloud backprojection policy."""

    points_per_keyframe: int = 600
    # Valid depth band in meters (after converting mm -> m).
    min_depth_m: float = 0.3
    max_depth_m: float = 6.0
    # Deterministic sampling seed so runs are reproducible.
    sample_seed: int = 1234
    # "stratified_grid" samples a deterministic pixel lattice then caps to the
    # point budget; "random" reservoir-samples every valid pixel.
    sample_strategy: str = "stratified_grid"


@dataclass(frozen=True)
class PipelineConfig:
    """Top-level pipeline configuration."""

    keyframes: KeyframeConfig = field(default_factory=KeyframeConfig)
    backproject: BackprojectConfig = field(default_factory=BackprojectConfig)
    max_keyframes: int | None = None

    def config_hash(self) -> str:
        """Stable short hash identifying this configuration's parameters."""

        payload = json.dumps(asdict(self), sort_keys=True).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]
