"""Chunk-level binary point storage.

A chunk holds the concatenated points of a bounded group of keyframes. Points
are stored as little-endian float32 XYZ (world frame, Z-up) + uint8 RGB,
alongside a JSON manifest describing the keyframes and per-keyframe point
spans. Chunks are written atomically and never rewritten once published.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from splat_io import estimate_gaussian_scale, write_splat

from ..schemas import Bounds, Vec3, envelope
from . import schema


@dataclass
class KeyframeSpan:
    """Span of one keyframe's points within a chunk's point arrays."""

    keyframe_index: int
    timestamp: float
    point_start: int
    point_count: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ChunkManifest:
    chunk_id: int
    point_count: int
    keyframe_spans: list[KeyframeSpan] = field(default_factory=list)
    bounds: dict | None = None

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "point_count": self.point_count,
            "keyframe_spans": [s.to_dict() for s in self.keyframe_spans],
            "bounds": self.bounds,
        }


@dataclass
class TrainedChunkManifest:
    """Manifest for a trained (optimized) Gaussian splat chunk.

    Additive sibling to :class:`ChunkManifest` for the point-chunk path; does
    not replace or alter it. ``source_keyframe_span`` is the inclusive
    ``(first_keyframe_index, last_keyframe_index)`` range the trained chunk
    was optimized from.
    """

    chunk_id: int
    gaussian_count: int
    source_keyframe_span: tuple[int, int]
    bundle_sha256: str
    sh_degree: int
    validation_loss: float | None = None
    scale_stats: dict | None = None

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "gaussian_count": self.gaussian_count,
            "source_keyframe_span": list(self.source_keyframe_span),
            "bundle_sha256": self.bundle_sha256,
            "sh_degree": self.sh_degree,
            "validation_loss": self.validation_loss,
            "scale_stats": self.scale_stats,
        }


def _bounds_of(xyz: np.ndarray) -> dict | None:
    if xyz.size == 0:
        return None
    mn = xyz.min(axis=0)
    mx = xyz.max(axis=0)
    return Bounds(
        Vec3(float(mn[0]), float(mn[1]), float(mn[2])),
        Vec3(float(mx[0]), float(mx[1]), float(mx[2])),
    ).to_dict()


class ChunkStore:
    """Reads/writes binary point chunks under a chunk directory."""

    def __init__(self, chunk_dir: str | Path) -> None:
        self.chunk_dir = Path(chunk_dir)
        self.chunk_dir.mkdir(parents=True, exist_ok=True)

    def write_chunk(
        self,
        chunk_id: int,
        xyz: np.ndarray,
        rgb: np.ndarray,
        spans: list[KeyframeSpan],
        config_hash: str,
    ) -> ChunkManifest:
        """Write one chunk's binary arrays + manifest atomically."""

        xyz32 = np.ascontiguousarray(xyz, dtype="<f4")
        rgb8 = np.ascontiguousarray(rgb, dtype=np.uint8)
        if xyz32.shape[0] != rgb8.shape[0]:
            raise ValueError("xyz and rgb point counts differ")

        xyz_path = self.chunk_dir / schema.chunk_xyz_name(chunk_id)
        rgb_path = self.chunk_dir / schema.chunk_rgb_name(chunk_id)
        self._atomic_write_bytes(xyz_path, xyz32.tobytes())
        self._atomic_write_bytes(rgb_path, rgb8.tobytes())

        manifest = ChunkManifest(
            chunk_id=chunk_id,
            point_count=int(xyz32.shape[0]),
            keyframe_spans=spans,
            bounds=_bounds_of(xyz32),
        )
        doc = {**envelope(config_hash), **manifest.to_dict()}
        self._atomic_write_text(
            self.chunk_dir / schema.chunk_manifest_name(chunk_id),
            json.dumps(doc, indent=2),
        )
        return manifest

    def write_trained_chunk(
        self,
        chunk_id: int,
        positions: np.ndarray,
        scales: np.ndarray,
        rotations: np.ndarray,
        colors: np.ndarray,
        opacities: np.ndarray,
        metrics: dict,
        config_hash: str,
    ) -> TrainedChunkManifest:
        """Write one trained Gaussian chunk's ``.splat`` bundle + manifest.

        Additive sibling to :meth:`write_chunk` for trained-splat chunks; does
        not read, write, or rewrite any existing point-chunk file. Uses the
        same atomic temp-file + rename pattern. ``positions``/``scales`` are
        ``(N, 3)`` float meters, ``rotations`` is ``(N, 4)`` float quaternion
        ``(w, x, y, z)`` (gsplat's convention -- matches
        :meth:`~robot_world.reconstruction.gsplat_backend.GsplatBackend.build`'s
        return shape), ``colors`` is ``(N, 3)`` float ``0..1`` RGB, and
        ``opacities`` is ``(N,)`` float ``0..1``. The full per-Gaussian
        scale/rotation/opacity is encoded losslessly into the ``.splat``
        bundle via :func:`splat_io.write_splat`'s optional per-point
        parameters; the manifest's ``scale_stats`` additionally summarizes the
        scale distribution for QA gating.
        """

        pos32 = np.ascontiguousarray(positions, dtype="<f4").reshape(-1, 3)
        scale32 = np.ascontiguousarray(scales, dtype="<f4").reshape(-1, 3)
        quat_wxyz = np.ascontiguousarray(rotations, dtype=np.float64).reshape(-1, 4)
        rgb01 = np.ascontiguousarray(colors, dtype=np.float64).reshape(-1, 3)
        opacity32 = np.ascontiguousarray(opacities, dtype="<f4").reshape(-1)

        n = pos32.shape[0]
        if scale32.shape[0] != n or quat_wxyz.shape[0] != n:
            raise ValueError("positions, scales, and rotations counts differ")
        if rgb01.shape[0] != n or opacity32.shape[0] != n:
            raise ValueError("positions, colors, and opacities counts differ")

        rgb8 = np.clip(np.round(rgb01 * 255.0), 0, 255).astype(np.uint8)
        alpha8 = np.clip(np.round(opacity32 * 255.0), 0, 255).astype(np.uint8)
        # .splat rotation bytes are (x, y, z, w), each round(q * 128 + 128).
        quat_xyzw = quat_wxyz[:, [1, 2, 3, 0]]
        rot_bytes = np.clip(np.round(quat_xyzw * 128.0 + 128.0), 0, 255).astype(np.uint8)

        isotropic_scale = (
            float(np.median(scale32)) if scale32.size else estimate_gaussian_scale(pos32)
        )

        splat_path = self.chunk_dir / f"chunk_{chunk_id:04d}_trained.splat"
        tmp_splat = splat_path.with_suffix(splat_path.suffix + ".tmp")
        write_splat(
            tmp_splat,
            pos32,
            rgb8,
            scale=isotropic_scale,
            scales=scale32,
            rotations=rot_bytes,
            alpha=alpha8,
        )
        splat_bytes = tmp_splat.read_bytes()
        bundle_sha256 = hashlib.sha256(splat_bytes).hexdigest()
        tmp_splat.replace(splat_path)

        first_kf = int(metrics.get("source_keyframe_start", 0))
        last_kf = int(metrics.get("source_keyframe_end", first_kf))

        scale_stats = {
            "min": float(scale32.min()) if scale32.size else None,
            "max": float(scale32.max()) if scale32.size else None,
            "mean": float(scale32.mean()) if scale32.size else None,
            "median": isotropic_scale if scale32.size else None,
        }

        manifest = TrainedChunkManifest(
            chunk_id=chunk_id,
            gaussian_count=n,
            source_keyframe_span=(first_kf, last_kf),
            bundle_sha256=bundle_sha256,
            sh_degree=int(metrics.get("sh_degree", 0)),
            validation_loss=metrics.get("validation_loss"),
            scale_stats=scale_stats,
        )
        doc = {**envelope(config_hash), **manifest.to_dict(), "metrics": metrics}
        self._atomic_write_text(
            self.chunk_dir / f"chunk_{chunk_id:04d}_trained.json",
            json.dumps(doc, indent=2),
        )
        return manifest

    def read_manifest(self, chunk_id: int) -> ChunkManifest:
        path = self.chunk_dir / schema.chunk_manifest_name(chunk_id)
        data = json.loads(path.read_text())
        spans = [KeyframeSpan(**s) for s in data.get("keyframe_spans", [])]
        return ChunkManifest(
            chunk_id=data["chunk_id"],
            point_count=data["point_count"],
            keyframe_spans=spans,
            bounds=data.get("bounds"),
        )

    def read_points(self, chunk_id: int) -> tuple[np.ndarray, np.ndarray]:
        """Read (xyz float32 (N,3), rgb uint8 (N,3)) for a chunk."""

        xyz = np.fromfile(
            self.chunk_dir / schema.chunk_xyz_name(chunk_id), dtype="<f4"
        ).reshape(-1, 3)
        rgb = np.fromfile(
            self.chunk_dir / schema.chunk_rgb_name(chunk_id), dtype=np.uint8
        ).reshape(-1, 3)
        return xyz, rgb

    # -- atomic helpers ----------------------------------------------------

    @staticmethod
    def _atomic_write_bytes(path: Path, data: bytes) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    @staticmethod
    def _atomic_write_text(path: Path, text: str) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text)
        tmp.replace(path)
