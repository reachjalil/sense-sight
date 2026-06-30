"""Persistent, chunked, versioned world store.

A :class:`WorldStore` owns a directory tree per world id under
``<base>/worlds/<id>/`` and coordinates the
:class:`~robot_world.storage.chunk_store.ChunkStore` and the
:class:`~robot_world.storage.versioning.VersionLog`. New chunks are appended
without rewriting prior chunks; each append publishes a new world version.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..schemas import Bounds, CameraIntrinsics, Vec3, envelope
from . import schema
from .chunk_store import ChunkManifest, ChunkStore, KeyframeSpan
from .versioning import VersionLog


@dataclass
class WorldMeta:
    """Mutable world metadata persisted in world.json."""

    world_id: str
    sequence: str
    source_dataset: str
    intrinsics: CameraIntrinsics
    chunk_ids: list[int] = field(default_factory=list)
    point_total: int = 0
    keyframe_count: int = 0
    bounds: dict | None = None

    def to_dict(self) -> dict:
        return {
            "world_id": self.world_id,
            "sequence": self.sequence,
            "source_dataset": self.source_dataset,
            "intrinsics": self.intrinsics.to_dict(),
            "chunk_ids": self.chunk_ids,
            "point_total": self.point_total,
            "keyframe_count": self.keyframe_count,
            "bounds": self.bounds,
        }


def _merge_bounds(a: dict | None, b: dict | None) -> dict | None:
    if a is None:
        return b
    if b is None:
        return a
    return Bounds(
        Vec3(
            min(a["min"]["x"], b["min"]["x"]),
            min(a["min"]["y"], b["min"]["y"]),
            min(a["min"]["z"], b["min"]["z"]),
        ),
        Vec3(
            max(a["max"]["x"], b["max"]["x"]),
            max(a["max"]["y"], b["max"]["y"]),
            max(a["max"]["z"], b["max"]["z"]),
        ),
    ).to_dict()


class WorldStore:
    """Persistent chunked + versioned storage for one base directory."""

    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)

    def _world_dir(self, world_id: str) -> Path:
        return self.base_dir / "worlds" / world_id

    def exists(self, world_id: str) -> bool:
        return (self._world_dir(world_id) / schema.WORLD_FILE).is_file()

    def chunk_store(self, world_id: str) -> ChunkStore:
        return ChunkStore(self._world_dir(world_id) / schema.CHUNK_DIR)

    # -- create / load -------------------------------------------------------

    def create(
        self,
        world_id: str,
        sequence: str,
        source_dataset: str,
        intrinsics: CameraIntrinsics,
        config_hash: str,
    ) -> WorldMeta:
        wdir = self._world_dir(world_id)
        (wdir / schema.CHUNK_DIR).mkdir(parents=True, exist_ok=True)
        meta = WorldMeta(
            world_id=world_id,
            sequence=sequence,
            source_dataset=source_dataset,
            intrinsics=intrinsics,
        )
        self._save_meta(meta, config_hash)
        self._save_versions(world_id, VersionLog())
        return meta

    def load_meta(self, world_id: str) -> WorldMeta:
        path = self._world_dir(world_id) / schema.WORLD_FILE
        if not path.is_file():
            raise FileNotFoundError(f"world not found: {world_id}")
        data = json.loads(path.read_text())
        intr = data["intrinsics"]
        return WorldMeta(
            world_id=data["world_id"],
            sequence=data["sequence"],
            source_dataset=data["source_dataset"],
            intrinsics=CameraIntrinsics(
                fx=intr["fx"],
                fy=intr["fy"],
                cx=intr["cx"],
                cy=intr["cy"],
                width=intr["width"],
                height=intr["height"],
            ),
            chunk_ids=data.get("chunk_ids", []),
            point_total=data.get("point_total", 0),
            keyframe_count=data.get("keyframe_count", 0),
            bounds=data.get("bounds"),
        )

    def load_versions(self, world_id: str) -> VersionLog:
        path = self._world_dir(world_id) / schema.VERSIONS_FILE
        if not path.is_file():
            return VersionLog()
        return VersionLog.from_dict(json.loads(path.read_text()))

    # -- append ----------------------------------------------------------

    def next_chunk_id(self, world_id: str) -> int:
        meta = self.load_meta(world_id)
        return (max(meta.chunk_ids) + 1) if meta.chunk_ids else 0

    def append_chunk(
        self,
        world_id: str,
        xyz: np.ndarray,
        rgb: np.ndarray,
        spans: list[KeyframeSpan],
        config_hash: str,
        note: str = "",
    ) -> ChunkManifest:
        """Append a new chunk and publish a new world version."""

        meta = self.load_meta(world_id)
        chunk_id = (max(meta.chunk_ids) + 1) if meta.chunk_ids else 0
        cs = self.chunk_store(world_id)
        manifest = cs.write_chunk(chunk_id, xyz, rgb, spans, config_hash)

        meta.chunk_ids.append(chunk_id)
        meta.point_total += manifest.point_count
        meta.keyframe_count += len(spans)
        meta.bounds = _merge_bounds(meta.bounds, manifest.bounds)
        self._save_meta(meta, config_hash)

        versions = self.load_versions(world_id)
        versions.append(
            chunk_ids=list(meta.chunk_ids),
            point_total=meta.point_total,
            keyframe_count=meta.keyframe_count,
            note=note or f"append chunk {chunk_id}",
        )
        self._save_versions(world_id, versions)
        return manifest

    # -- read all ----------------------------------------------------------

    def read_all_points(self, world_id: str) -> tuple[np.ndarray, np.ndarray]:
        meta = self.load_meta(world_id)
        cs = self.chunk_store(world_id)
        xyz_parts: list[np.ndarray] = []
        rgb_parts: list[np.ndarray] = []
        for cid in meta.chunk_ids:
            xyz, rgb = cs.read_points(cid)
            xyz_parts.append(xyz)
            rgb_parts.append(rgb)
        if not xyz_parts:
            return np.empty((0, 3), dtype=np.float32), np.empty((0, 3), dtype=np.uint8)
        return np.concatenate(xyz_parts), np.concatenate(rgb_parts)

    # -- persistence helpers -------------------------------------------------

    def _save_meta(self, meta: WorldMeta, config_hash: str) -> None:
        wdir = self._world_dir(meta.world_id)
        wdir.mkdir(parents=True, exist_ok=True)
        doc = {**envelope(config_hash), **meta.to_dict()}
        self._atomic_write_text(wdir / schema.WORLD_FILE, json.dumps(doc, indent=2))

    def _save_versions(self, world_id: str, versions: VersionLog) -> None:
        wdir = self._world_dir(world_id)
        wdir.mkdir(parents=True, exist_ok=True)
        self._atomic_write_text(
            wdir / schema.VERSIONS_FILE, json.dumps(versions.to_dict(), indent=2)
        )

    @staticmethod
    def _atomic_write_text(path: Path, text: str) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text)
        tmp.replace(path)
