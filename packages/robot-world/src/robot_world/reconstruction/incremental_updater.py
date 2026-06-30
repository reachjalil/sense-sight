"""Incremental, append-only world updates.

:meth:`IncrementalUpdater.update_world` processes the next ``max_frames``
keyframes for a sequence and appends them to a NEW chunk in an existing world,
without reprocessing or rewriting prior chunks. Progress is tracked by how
many keyframes the world has already consumed
(:attr:`~robot_world.storage.world_store.WorldMeta.keyframe_count`); the
updater re-selects keyframes deterministically and resumes after that offset.

This mirrors the "accept keyframe -> bounded change set -> publish new
version" loop a streaming deployment would run continuously, but as a simple,
reliable, one-shot append.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..config import PipelineConfig
from ..ingestion.openloris_adapter import OpenLorisDatasetAdapter
from ..pose.pose_selector import PoseSelector
from ..pose.robot_pose_provider import RobotPoseProvider
from ..storage.chunk_store import KeyframeSpan
from ..storage.world_store import WorldStore
from . import keyframes as keyframes_mod
from .point_gaussian_backend import PointGaussianBackend


@dataclass
class UpdateResult:
    world_id: str
    processed_keyframes: int
    new_chunk_id: int | None
    point_total: int
    keyframe_count: int
    version: int
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "world_id": self.world_id,
            "processedKeyframes": self.processed_keyframes,
            "newChunkId": self.new_chunk_id,
            "pointTotal": self.point_total,
            "keyframeCount": self.keyframe_count,
            "version": self.version,
            "note": self.note,
        }


class IncrementalUpdater:
    """Append-only updater that touches only the new (active) chunk."""

    def __init__(
        self,
        adapter: OpenLorisDatasetAdapter,
        repo_root: str | Path,
        config: PipelineConfig,
    ) -> None:
        self.adapter = adapter
        self.repo_root = Path(repo_root)
        self.config = config

    def update_world(
        self, world_id: str, store: WorldStore, max_frames: int = 40
    ) -> UpdateResult:
        cfg = self.config
        config_hash = cfg.config_hash()
        meta = store.load_meta(world_id)
        sequence = meta.sequence

        frames = self.adapter.load_frames(sequence)
        selector = PoseSelector([RobotPoseProvider(confidence=1.0)])
        posed = selector.select_all(frames)

        search_roots = [self.adapter.root, self.repo_root]
        extrinsic = self.adapter.load_base_to_color_extrinsic(sequence)
        backend = PointGaussianBackend(
            cfg.backproject,
            self.repo_root,
            search_roots=search_roots,
            base_to_camera=extrinsic,
        )
        depth_ratio_fn = lambda fr: backend.depth_valid_ratio(fr.depth_path)  # noqa: E731

        # Re-select the full keyframe set deterministically, then resume after
        # the number already consumed by the world.
        all_kfs = keyframes_mod.select(
            posed,
            cfg.keyframes,
            depth_ratio_fn=depth_ratio_fn,
            max_keyframes=cfg.max_keyframes,
        )
        already = meta.keyframe_count
        pending = all_kfs[already : already + max_frames]

        versions = store.load_versions(world_id)
        if not pending:
            latest = versions.latest
            return UpdateResult(
                world_id=world_id,
                processed_keyframes=0,
                new_chunk_id=None,
                point_total=meta.point_total,
                keyframe_count=meta.keyframe_count,
                version=latest.version if latest else 0,
                note="no pending keyframes; world is up to date",
            )

        xyz_parts: list[np.ndarray] = []
        rgb_parts: list[np.ndarray] = []
        spans: list[KeyframeSpan] = []
        running = 0
        intrinsics = meta.intrinsics
        for kf in pending:
            chunk = backend.backproject(kf, intrinsics)
            xyz = np.asarray(chunk.xyz, dtype=np.float32)
            rgb = np.asarray(chunk.rgb, dtype=np.uint8)
            count = int(xyz.shape[0])
            spans.append(
                KeyframeSpan(
                    keyframe_index=kf.frame.frame_index,
                    timestamp=kf.frame.timestamp,
                    point_start=running,
                    point_count=count,
                )
            )
            running += count
            xyz_parts.append(xyz)
            rgb_parts.append(rgb)

        new_chunk_id = store.next_chunk_id(world_id)
        cx = np.concatenate(xyz_parts) if xyz_parts else np.empty((0, 3), np.float32)
        cr = np.concatenate(rgb_parts) if rgb_parts else np.empty((0, 3), np.uint8)
        store.append_chunk(
            world_id,
            cx,
            cr,
            spans,
            config_hash,
            note=f"incremental update (+{len(pending)} keyframes)",
        )

        meta = store.load_meta(world_id)
        versions = store.load_versions(world_id)
        latest = versions.latest
        return UpdateResult(
            world_id=world_id,
            processed_keyframes=len(pending),
            new_chunk_id=new_chunk_id,
            point_total=meta.point_total,
            keyframe_count=meta.keyframe_count,
            version=latest.version if latest else 0,
            note=f"appended chunk {new_chunk_id} without touching prior chunks",
        )
