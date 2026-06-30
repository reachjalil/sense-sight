"""On-disk storage schema for the persistent world store.

Layout (under ``<base>/worlds/<world_id>/``):

    world.json            -- world metadata + envelope + chunk index
    versions.json         -- append-only version history
    chunks/
      chunk_0000.json     -- chunk manifest (keyframe ids, point count, bounds)
      chunk_0000_xyz.f32  -- little-endian float32 world XYZ (Z-up), 3/point
      chunk_0000_rgb.u8   -- uint8 RGB, 3/point

This deliberately avoids one monolithic point cloud file: chunks are
independently loadable and appended without rewriting prior chunks.
"""

from __future__ import annotations

WORLD_FILE = "world.json"
VERSIONS_FILE = "versions.json"
CHUNK_DIR = "chunks"


def chunk_manifest_name(chunk_id: int) -> str:
    return f"chunk_{chunk_id:04d}.json"


def chunk_xyz_name(chunk_id: int) -> str:
    return f"chunk_{chunk_id:04d}_xyz.f32"


def chunk_rgb_name(chunk_id: int) -> str:
    return f"chunk_{chunk_id:04d}_rgb.u8"
