"""Read/write the antimatter15/INRIA ``.splat`` Gaussian binary format.

The on-disk layout is 32 bytes per Gaussian, little-endian, in this exact order:

    position 3x float32 (12B) | scale 3x float32 (12B) |
    color RGBA 4x uint8 (4B)  | rotation quat 4x uint8 (4B)

This module writes one isotropic Gaussian per input point (point-cloud init for
3DGS), reads any conformant ``.splat`` back for verification, and estimates a
reasonable isotropic scale from point spacing. numpy only — no torch, no Open3D.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

SPLAT_RECORD_BYTES = 32
_SPLAT_DTYPE = np.dtype(
    [
        ("pos", "<f4", (3,)),
        ("scale", "<f4", (3,)),
        ("rgba", "u1", (4,)),
        ("rot", "u1", (4,)),
    ]
)
# Identity quaternion (x, y, z, w) = (0, 0, 0, 1), each component encoded as
# round(q * 128 + 128) clamped to 0..255 -> (128, 128, 128, 255).
_IDENTITY_ROT_BYTES = (128, 128, 128, 255)


def estimate_gaussian_scale(
    xyz: np.ndarray,
    *,
    fallback_m: float = 0.04,
    sample: int = 2048,
    seed: int = 7,
    min_m: float = 0.03,
    max_m: float = 0.06,
) -> float:
    """Pick an isotropic Gaussian scale (meters) from point spacing.

    Estimates the median nearest-neighbour distance over a random subsample
    (cheap, brute-force on the subsample) and clamps it into ``[min_m, max_m]``.
    Falls back to ``fallback_m`` when the cloud is too small or degenerate. This
    is the per-axis stddev each rendered splat gets.
    """

    pts = np.ascontiguousarray(xyz, dtype=np.float64).reshape(-1, 3)
    n = pts.shape[0]
    if n < 2:
        return float(fallback_m)

    take = min(sample, n)
    rng = np.random.default_rng(seed)
    idx = rng.choice(n, size=take, replace=False) if n > take else np.arange(n)
    sub = pts[idx]
    # Brute-force pairwise distances on the (small) subsample; mask the
    # self-distance then take each point's nearest neighbour.
    d2 = np.sum((sub[:, None, :] - sub[None, :, :]) ** 2, axis=2)
    np.fill_diagonal(d2, np.inf)
    nn = np.sqrt(d2.min(axis=1))
    nn = nn[np.isfinite(nn)]
    if nn.size == 0:
        return float(fallback_m)
    spacing = float(np.median(nn))
    if not np.isfinite(spacing) or spacing <= 0.0:
        return float(fallback_m)
    return float(min(max_m, max(min_m, spacing)))


def write_splat(
    path: str | Path,
    xyz: np.ndarray,
    rgb: np.ndarray,
    *,
    scale: float,
    scales: np.ndarray | None = None,
    rotations: np.ndarray | None = None,
    alpha: np.ndarray | None = None,
) -> int:
    """Write an antimatter15/INRIA ``.splat`` file; return bytes written.

    One Gaussian is emitted per input point: position = the point xyz,
    color = the point rgb. ``scales``/``rotations``/``alpha`` are optional
    per-point overrides (shapes ``(N, 3)`` float, ``(N, 4)`` uint8
    already-encoded rotation bytes matching :class:`SplatGaussian.rotation`,
    and ``(N,)`` uint8 respectively); omitting all three reproduces the
    original isotropic-point-cloud encoding byte-for-byte: scale = ``scale``
    on all three axes, alpha=255, rotation = identity quaternion.
    ``xyz``/``rgb`` are taken in whatever frame the caller supplies.
    """

    path = Path(path)
    pts = np.ascontiguousarray(xyz, dtype="<f4").reshape(-1, 3)
    cols = np.ascontiguousarray(rgb, dtype=np.uint8).reshape(-1, 3)
    if pts.shape[0] != cols.shape[0]:
        raise ValueError("xyz and rgb point counts differ")
    n = pts.shape[0]
    s = float(scale)

    rows = np.empty(n, dtype=_SPLAT_DTYPE)
    rows["pos"] = pts
    if scales is not None and scales.shape[0] == n:
        rows["scale"] = np.ascontiguousarray(scales, dtype="<f4").reshape(-1, 3)
    else:
        rows["scale"][:] = s
    rows["rgba"][:, :3] = cols
    if alpha is not None and alpha.shape[0] == n:
        rows["rgba"][:, 3] = np.ascontiguousarray(alpha, dtype=np.uint8).reshape(-1)
    else:
        rows["rgba"][:, 3] = 255
    if rotations is not None and rotations.shape[0] == n:
        rows["rot"] = np.ascontiguousarray(rotations, dtype=np.uint8).reshape(-1, 4)
    else:
        rows["rot"][:] = _IDENTITY_ROT_BYTES
    with path.open("wb") as fh:
        fh.write(rows.tobytes())
    return path.stat().st_size


@dataclass
class SplatGaussian:
    """One decoded ``.splat`` Gaussian (for round-trip verification)."""

    position: np.ndarray  # (3,) float32
    scale: np.ndarray  # (3,) float32
    rgba: np.ndarray  # (4,) uint8
    rotation: np.ndarray  # (4,) uint8 (encoded quaternion bytes)


def read_splat(path: str | Path) -> list[SplatGaussian]:
    """Read a ``.splat`` file back into decoded Gaussians (validates layout)."""

    path = Path(path)
    raw = path.read_bytes()
    if len(raw) % SPLAT_RECORD_BYTES != 0:
        raise ValueError(
            f"{path} size {len(raw)} is not a multiple of {SPLAT_RECORD_BYTES}"
        )
    rows = np.frombuffer(raw, dtype=_SPLAT_DTYPE)
    out: list[SplatGaussian] = []
    for r in rows:
        out.append(
            SplatGaussian(
                position=np.array(r["pos"], dtype=np.float32),
                scale=np.array(r["scale"], dtype=np.float32),
                rgba=np.array(r["rgba"], dtype=np.uint8),
                rotation=np.array(r["rot"], dtype=np.uint8),
            )
        )
    return out
