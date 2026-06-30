"""Dataset adapter protocol.

A dataset adapter discovers a dataset on disk, lists its sequences, loads a
sequence's frame manifest and intrinsics, and reports which sensor modalities
are present. Concrete adapters implement this contract so the rest of the
pipeline is dataset-agnostic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from ..schemas import CameraIntrinsics, FrameRecord


@dataclass(frozen=True)
class DatasetSummary:
    """Human/machine-readable summary of a detected dataset."""

    dataset_name: str
    root: str
    detected: bool
    sequences: list[str]
    modalities: dict[str, bool]
    notes: list[str]

    def to_dict(self) -> dict:
        return {
            "dataset_name": self.dataset_name,
            "root": self.root,
            "detected": self.detected,
            "sequences": self.sequences,
            "modalities": self.modalities,
            "notes": self.notes,
        }


@runtime_checkable
class DatasetAdapter(Protocol):
    """Protocol implemented by concrete dataset adapters."""

    dataset_name: str

    def detect(self) -> bool:
        """Return True if the configured root looks like this dataset."""

    def list_sequences(self) -> list[str]:
        """List available sequence identifiers."""

    def summary(self) -> DatasetSummary:
        """Produce a dataset summary (sequences + modality presence)."""

    def load_frames(self, sequence: str) -> list[FrameRecord]:
        """Load the frame manifest for ``sequence`` (time-ordered)."""

    def load_intrinsics(self, sequence: str) -> CameraIntrinsics:
        """Load color-camera intrinsics for ``sequence``."""
