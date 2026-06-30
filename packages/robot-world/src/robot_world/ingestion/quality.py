"""Depth-quality measurement utilities."""

from __future__ import annotations

import numpy as np


def depth_valid_ratio(
    depth_mm: np.ndarray, min_depth_m: float, max_depth_m: float
) -> float:
    """Fraction of depth pixels that fall inside the usable metric band.

    ``depth_mm`` is a uint16 array in millimeters (aligned depth).
    """

    if depth_mm.size == 0:
        return 0.0
    lo = min_depth_m * 1000.0
    hi = max_depth_m * 1000.0
    valid = (depth_mm >= lo) & (depth_mm <= hi)
    return float(np.count_nonzero(valid)) / float(depth_mm.size)
