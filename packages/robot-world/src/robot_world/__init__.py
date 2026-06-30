"""robot-world: robot sensor stream reconstruction pipeline.

Converts OpenLORIS-style RGB-D + ground-truth pose streams into a colored
point/Gaussian-seed world, stored as an append-only chunked world store, and
exposes a COLMAP-format bundle builder for downstream 3D Gaussian Splatting
training.
"""

from __future__ import annotations

__version__ = "0.1.0"
