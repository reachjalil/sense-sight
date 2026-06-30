"""Frame-manifest parsing.

A frame manifest is a per-sequence CSV that joins color + aligned depth +
ground-truth pose for each frame — the canonical input to the rest of the
pipeline.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable, Iterator
from pathlib import Path

from ..schemas import FrameRecord, Quaternion, Vec3

REQUIRED_COLUMNS = (
    "sequence",
    "frame_index",
    "timestamp",
    "image_path",
    "depth_path",
    "has_pose",
    "tx",
    "ty",
    "tz",
    "qx",
    "qy",
    "qz",
    "qw",
)


def _as_bool(value: str) -> bool:
    return value.strip().lower() in ("true", "1", "yes")


def parse_manifest_rows(rows: Iterable[dict[str, str]]) -> Iterator[FrameRecord]:
    """Convert raw CSV dict rows into :class:`FrameRecord` objects."""

    for row in rows:
        yield FrameRecord(
            sequence=row["sequence"],
            frame_index=int(row["frame_index"]),
            timestamp=float(row["timestamp"]),
            image_path=row["image_path"],
            depth_path=row["depth_path"],
            has_pose=_as_bool(row["has_pose"]),
            position=Vec3(float(row["tx"]), float(row["ty"]), float(row["tz"])),
            quaternion=Quaternion(
                float(row["qx"]),
                float(row["qy"]),
                float(row["qz"]),
                float(row["qw"]),
            ),
        )


def load_manifest(path: str | Path) -> list[FrameRecord]:
    """Load and validate a frame manifest CSV from ``path``."""

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"frame manifest not found: {path}")
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"manifest {path} missing required columns: {missing}")
        records = list(parse_manifest_rows(reader))
    records.sort(key=lambda r: (r.timestamp, r.frame_index))
    return records
