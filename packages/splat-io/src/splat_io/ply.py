"""Write a binary little-endian colored PLY point cloud (numpy only)."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def write_ply(path: str | Path, xyz: np.ndarray, rgb: np.ndarray) -> int:
    """Write a binary little-endian colored PLY; return bytes written."""

    path = Path(path)
    xyz = np.ascontiguousarray(xyz, dtype="<f4").reshape(-1, 3)
    rgb = np.ascontiguousarray(rgb, dtype=np.uint8).reshape(-1, 3)
    n = xyz.shape[0]
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {n}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property uchar red\n"
        "property uchar green\n"
        "property uchar blue\n"
        "end_header\n"
    ).encode("ascii")

    # Interleave xyz (12 bytes) + rgb (3 bytes) per vertex.
    dtype = np.dtype(
        [
            ("x", "<f4"),
            ("y", "<f4"),
            ("z", "<f4"),
            ("r", "u1"),
            ("g", "u1"),
            ("b", "u1"),
        ]
    )
    rows = np.empty(n, dtype=dtype)
    rows["x"], rows["y"], rows["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    rows["r"], rows["g"], rows["b"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    with path.open("wb") as fh:
        fh.write(header)
        fh.write(rows.tobytes())
    return path.stat().st_size
