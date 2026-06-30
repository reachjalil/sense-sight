"""Tests for splat_io (pytest)."""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pytest

from splat_io import (
    SPLAT_RECORD_BYTES,
    estimate_gaussian_scale,
    read_splat,
    write_ply,
    write_splat,
)


def test_splat_round_trip() -> None:
    xyz = np.array([[0, 0, 0], [1, 2, 3], [-1, -2, -3]], dtype=np.float32)
    rgb = np.array([[255, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8)
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "scene.splat"
        n = write_splat(path, xyz, rgb, scale=0.05)
        assert n == xyz.shape[0] * SPLAT_RECORD_BYTES
        g = read_splat(path)
        assert len(g) == 3
        assert np.allclose(g[1].position, [1, 2, 3])
        assert tuple(g[0].rgba) == (255, 0, 0, 255)
        # identity rotation bytes
        assert tuple(g[0].rotation) == (128, 128, 128, 255)
        assert np.allclose(g[2].scale, [0.05, 0.05, 0.05])


def test_write_splat_rejects_mismatched_counts() -> None:
    xyz = np.zeros((3, 3), dtype=np.float32)
    rgb = np.zeros((2, 3), dtype=np.uint8)
    with tempfile.TemporaryDirectory() as d:
        with pytest.raises(ValueError):
            write_splat(Path(d) / "x.splat", xyz, rgb, scale=0.05)


def test_write_splat_with_per_point_overrides() -> None:
    xyz = np.array([[0, 0, 0], [1, 1, 1]], dtype=np.float32)
    rgb = np.array([[10, 20, 30], [40, 50, 60]], dtype=np.uint8)
    scales = np.array([[0.01, 0.02, 0.03], [0.04, 0.05, 0.06]], dtype=np.float32)
    rotations = np.array([[1, 2, 3, 4], [5, 6, 7, 8]], dtype=np.uint8)
    alpha = np.array([100, 200], dtype=np.uint8)
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "scene.splat"
        write_splat(
            path,
            xyz,
            rgb,
            scale=0.05,
            scales=scales,
            rotations=rotations,
            alpha=alpha,
        )
        g = read_splat(path)
        assert np.allclose(g[0].scale, [0.01, 0.02, 0.03])
        assert np.allclose(g[1].scale, [0.04, 0.05, 0.06])
        assert tuple(g[0].rotation) == (1, 2, 3, 4)
        assert tuple(g[1].rotation) == (5, 6, 7, 8)
        assert g[0].rgba[3] == 100
        assert g[1].rgba[3] == 200


def test_read_splat_rejects_non_conformant_size() -> None:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "bad.splat"
        path.write_bytes(b"\x00" * (SPLAT_RECORD_BYTES + 1))
        with pytest.raises(ValueError):
            read_splat(path)


def test_estimate_gaussian_scale_clamps() -> None:
    # Tight grid -> spacing below min clamps up to min_m.
    grid = np.stack(np.meshgrid(*[np.arange(6) * 0.001] * 3), -1).reshape(-1, 3)
    s = estimate_gaussian_scale(grid, min_m=0.03, max_m=0.06)
    assert s == 0.03
    # Single point -> fallback.
    assert estimate_gaussian_scale(np.zeros((1, 3)), fallback_m=0.04) == 0.04


def test_write_ply() -> None:
    xyz = np.random.default_rng(0).normal(size=(50, 3)).astype(np.float32)
    rgb = np.zeros((50, 3), dtype=np.uint8)
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "cloud.ply"
        n = write_ply(path, xyz, rgb)
        head = path.read_bytes()[:64].decode("ascii", "replace")
        assert head.startswith("ply")
        assert "binary_little_endian" in head
        assert n > 50 * 15
