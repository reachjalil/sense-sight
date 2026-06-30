"""OpenLORIS-Scene dataset adapter.

Detects the OpenLORIS layout this pipeline expects:

    <root>/
      raw/openloris_package/<sequence>/{color,aligned_depth,...}
      processed/trajectories/<sequence>_frame_manifest.csv
      metadata/<sequence>_camera_intrinsics.json

It tolerates missing modalities (e.g. LiDAR is absent for OpenLORIS) and falls
back to canonical D435i color intrinsics when the metadata file is unavailable.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..schemas import CameraIntrinsics, FrameRecord
from .calibration import load_base_to_color_extrinsic, load_color_intrinsics
from .dataset_adapter import DatasetSummary
from .manifest import load_manifest


class OpenLorisDatasetAdapter:
    """Adapter for the OpenLORIS-Scene corridor dataset layout."""

    dataset_name = "OpenLORIS-Scene"

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.raw_root = self.root / "raw" / "openloris_package"
        self.trajectories_root = self.root / "processed" / "trajectories"
        self.metadata_root = self.root / "metadata"

    # -- detection -------------------------------------------------------

    def detect(self) -> bool:
        """Detect the dataset by its raw or processed folder signatures."""

        if self.raw_root.is_dir():
            return True
        # Processed-only layout (manifests present without the raw package).
        if self.trajectories_root.is_dir():
            return any(self.trajectories_root.glob("*_frame_manifest.csv"))
        return False

    # -- discovery ---------------------------------------------------------

    def list_sequences(self) -> list[str]:
        """List sequences from raw folders, falling back to manifest names."""

        seqs: set[str] = set()
        if self.raw_root.is_dir():
            for child in self.raw_root.iterdir():
                if child.is_dir():
                    seqs.add(child.name)
        if self.trajectories_root.is_dir():
            for manifest in self.trajectories_root.glob("*_frame_manifest.csv"):
                seqs.add(manifest.name.replace("_frame_manifest.csv", ""))
        return sorted(seqs)

    def _manifest_path(self, sequence: str) -> Path:
        return self.trajectories_root / f"{sequence}_frame_manifest.csv"

    def _intrinsics_path(self, sequence: str) -> Path:
        return self.metadata_root / f"{sequence}_camera_intrinsics.json"

    def _extrinsics_path(self, sequence: str) -> Path:
        return self.metadata_root / f"{sequence}_camera_extrinsics.json"

    def _sequence_modalities(self, sequence: str) -> dict[str, bool]:
        """Report which sensor modalities exist for ``sequence``."""

        seq_raw = self.raw_root / sequence
        return {
            "color": (seq_raw / "color").is_dir(),
            "aligned_depth": (seq_raw / "aligned_depth").is_dir(),
            "depth": (seq_raw / "depth").is_dir(),
            "fisheye": (seq_raw / "fisheye1").is_dir(),
            "imu": (seq_raw / "d400_gyroscope.txt").is_file()
            or (seq_raw / "t265_gyroscope.txt").is_file(),
            "odometry": (seq_raw / "odom.txt").is_file(),
            "groundtruth": (seq_raw / "groundtruth.txt").is_file()
            or self._manifest_path(sequence).is_file(),
            "lidar": False,  # OpenLORIS has no LiDAR.
            "manifest": self._manifest_path(sequence).is_file(),
            "intrinsics": self._intrinsics_path(sequence).is_file(),
        }

    def sequence_modalities(self, sequence: str) -> dict[str, bool]:
        """Public modality inventory for reports and artifacts."""

        return self._sequence_modalities(sequence)

    # -- summary -------------------------------------------------------------

    def summary(self) -> DatasetSummary:
        sequences = self.list_sequences()
        notes: list[str] = []
        modalities: dict[str, bool] = {}
        if sequences:
            # Aggregate modality presence across sequences (any-true).
            for seq in sequences:
                for key, present in self._sequence_modalities(seq).items():
                    modalities[key] = modalities.get(key, False) or present
        if not modalities.get("lidar", False):
            notes.append("LiDAR absent for OpenLORIS; using RGB-D only.")
        if not self.raw_root.is_dir():
            notes.append(
                "Raw package not found; operating from processed manifests only."
            )
        return DatasetSummary(
            dataset_name=self.dataset_name,
            root=str(self.root),
            detected=self.detect(),
            sequences=sequences,
            modalities=modalities,
            notes=notes,
        )

    def print_summary(self) -> None:
        s = self.summary()
        print(f"[{s.dataset_name}] root={s.root} detected={s.detected}")
        print(f"  sequences ({len(s.sequences)}): {', '.join(s.sequences)}")
        present = sorted(k for k, v in s.modalities.items() if v)
        absent = sorted(k for k, v in s.modalities.items() if not v)
        print(f"  modalities present: {', '.join(present) or '(none)'}")
        print(f"  modalities absent:  {', '.join(absent) or '(none)'}")
        for note in s.notes:
            print(f"  note: {note}")

    # -- loading -------------------------------------------------------------

    def load_frames(self, sequence: str) -> list[FrameRecord]:
        return load_manifest(self._manifest_path(sequence))

    def load_intrinsics(self, sequence: str) -> CameraIntrinsics:
        return load_color_intrinsics(self._intrinsics_path(sequence))

    def load_base_to_color_extrinsic(self, sequence: str) -> np.ndarray:
        """4x4 base_link -> color-camera transform (identity if absent)."""

        return load_base_to_color_extrinsic(self._extrinsics_path(sequence))
