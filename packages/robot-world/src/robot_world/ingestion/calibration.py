"""Camera calibration loading.

OpenLORIS intrinsics metadata is a JSON array of sensor entries; the color
stream (``d400_color_optical_frame``) is the one this pipeline reconstructs
from. Distortion is zero for this dataset so it is ignored.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..schemas import CameraIntrinsics

# Canonical D435i color intrinsics for the OpenLORIS-Scene corridor sequences.
DEFAULT_COLOR_INTRINSICS = CameraIntrinsics(
    fx=611.4509887695312,
    fy=611.4857177734375,
    cx=433.2039794921875,
    cy=249.4730224609375,
    width=848,
    height=480,
)

_COLOR_FRAME_NAMES = ("d400_color_optical_frame", "color")


def load_color_intrinsics(path: str | Path) -> CameraIntrinsics:
    """Load color-camera intrinsics from an OpenLORIS intrinsics JSON file.

    Falls back to :data:`DEFAULT_COLOR_INTRINSICS` if the color entry cannot
    be located, since these values are fixed for the corridor sequences.
    """

    path = Path(path)
    if not path.exists():
        return DEFAULT_COLOR_INTRINSICS
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return DEFAULT_COLOR_INTRINSICS

    entries = data if isinstance(data, list) else [data]
    for entry in entries:
        frame = str(entry.get("frame", entry.get("sensor_name", "")))
        if frame in _COLOR_FRAME_NAMES:
            return CameraIntrinsics(
                fx=float(entry["fx"]),
                fy=float(entry["fy"]),
                cx=float(entry["cx"]),
                cy=float(entry["cy"]),
                width=int(entry.get("width", 848)),
                height=int(entry.get("height", 480)),
            )
    return DEFAULT_COLOR_INTRINSICS


# base_link -> d400_color_optical_frame extrinsic. The OpenLORIS ground-truth
# pose is the base_link (robot body) pose in the world; to place color-camera
# points in the world they must first be mapped into base_link via this.
_COLOR_CHILD_FRAMES = ("d400_color_optical_frame", "color")


def load_base_to_color_extrinsic(path: str | Path) -> np.ndarray:
    """Load the 4x4 base_link -> color-camera transform.

    Returns identity (no transform) if the extrinsics file or the relevant
    parent/child entry is missing. The matrix maps a point in the color
    optical frame to the base_link frame: ``P_base = T @ [P_color, 1]``.
    """

    path = Path(path)
    identity = np.eye(4, dtype=np.float64)
    if not path.exists():
        return identity
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return identity
    entries = data if isinstance(data, list) else [data]
    for entry in entries:
        parent = str(entry.get("parent_frame", ""))
        child = str(entry.get("child_frame", ""))
        mat = entry.get("matrix_row_major_4x4")
        if parent == "base_link" and child in _COLOR_CHILD_FRAMES and mat:
            return np.asarray(mat, dtype=np.float64).reshape(4, 4)
    return identity
