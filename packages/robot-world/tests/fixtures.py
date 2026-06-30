"""Tiny synthetic dataset fixtures for tests (no large dataset required).

Generates a minimal OpenLORIS-shaped dataset in a temp dir: a few color PNGs,
a matching 16-bit depth PNG per frame, a frame manifest CSV, and an intrinsics
JSON. Poses are simple camera poses (identity-ish), so the backend's default
identity base->camera extrinsic is exactly right for these fixtures.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

INTRINSICS = {
    "fx": 200.0,
    "fy": 200.0,
    "cx": 32.0,
    "cy": 24.0,
    "width": 64,
    "height": 48,
}


def _yaw_quat(yaw: float) -> tuple[float, float, float, float]:
    """Quaternion (x, y, z, w) for a yaw about the +Z (up) axis."""

    return (0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0))


def make_dataset(root: Path, sequence: str = "synthseq", n_frames: int = 12) -> Path:
    """Create a synthetic OpenLORIS-shaped dataset under ``root``.

    Returns the dataset root path. The robot translates along +X (world) so
    the motion gate accepts frames; depth is a constant 2 m plane so the
    valid-depth ratio is high.
    """

    root = Path(root)
    seq_raw = root / "raw" / "openloris_package" / sequence
    color_dir = seq_raw / "color"
    depth_dir = seq_raw / "aligned_depth"
    traj_dir = root / "processed" / "trajectories"
    meta_dir = root / "metadata"
    for d in (color_dir, depth_dir, traj_dir, meta_dir):
        d.mkdir(parents=True, exist_ok=True)

    w, h = INTRINSICS["width"], INTRINSICS["height"]
    rng = np.random.default_rng(7)

    rows: list[dict] = []
    for i in range(n_frames):
        ts = 1000.0 + i * 0.1
        ts_str = f"{ts:.6f}"
        # Color: a gradient + noise so RGB sampling is meaningful.
        color = np.zeros((h, w, 3), dtype=np.uint8)
        color[..., 0] = np.linspace(0, 255, w, dtype=np.uint8)[None, :]
        color[..., 1] = np.linspace(0, 255, h, dtype=np.uint8)[:, None]
        color[..., 2] = (rng.integers(0, 64, size=(h, w))).astype(np.uint8)
        Image.fromarray(color, mode="RGB").save(color_dir / f"{ts_str}.png")

        # Depth: constant 2000 mm plane (well inside the 0.3-6 m band).
        depth = np.full((h, w), 2000, dtype=np.uint16)
        Image.fromarray(depth, mode="I;16").save(depth_dir / f"{ts_str}.png")

        tx = float(i) * 0.5  # advance 0.5 m/frame -> clears the motion gate
        ty = 0.0
        tz = 0.0
        qx, qy, qz, qw = _yaw_quat(0.0)
        rows.append(
            {
                "sequence": sequence,
                "frame_index": i,
                "timestamp": ts_str,
                "image_path": f"raw/openloris_package/{sequence}/color/{ts_str}.png",
                "depth_path": f"raw/openloris_package/{sequence}/aligned_depth/{ts_str}.png",
                "has_pose": "True" if i != 1 else "False",  # one unposed frame
                "tx": tx,
                "ty": ty,
                "tz": tz,
                "qx": qx,
                "qy": qy,
                "qz": qz,
                "qw": qw,
            }
        )

    manifest = traj_dir / f"{sequence}_frame_manifest.csv"
    with manifest.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    intr_doc = [
        {
            "frame": "d400_color_optical_frame",
            "sensor_name": "d400_color_optical_frame",
            **INTRINSICS,
        }
    ]
    (meta_dir / f"{sequence}_camera_intrinsics.json").write_text(json.dumps(intr_doc, indent=2))
    # No extrinsics file -> identity base->camera (poses are camera poses here).
    return root
