"""splat-io — dependency-light .splat / PLY I/O for Gaussian point clouds.

Read and write the antimatter15/INRIA 32-byte ``.splat`` format, write colored
binary PLY, and estimate an isotropic Gaussian scale from point spacing. numpy
only; pairs byte-for-byte with the TypeScript ``@sense-sight/splat-codec``.
"""

from __future__ import annotations

from .ply import write_ply
from .splat import (
    SPLAT_RECORD_BYTES,
    SplatGaussian,
    estimate_gaussian_scale,
    read_splat,
    write_splat,
)

__all__ = [
    "SPLAT_RECORD_BYTES",
    "SplatGaussian",
    "estimate_gaussian_scale",
    "read_splat",
    "write_ply",
    "write_splat",
]

__version__ = "0.1.0"
