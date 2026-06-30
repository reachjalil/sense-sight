"""Smoke test: synthetic COLMAP dataset -> load_colmap -> export_splat round trip.

Skipped (not failed) when torch/gsplat are not installed, since this package's
real training path only runs on a GPU worker.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("gsplat")

import torch.nn.functional as F  # noqa: E402
from PIL import Image  # noqa: E402

_VENDORED_ROOT = Path(__file__).resolve().parents[1]
if str(_VENDORED_ROOT) not in sys.path:
    sys.path.insert(0, str(_VENDORED_ROOT))

from vendored.train_splat import export_splat, load_colmap  # noqa: E402


def _write_synthetic_colmap_dataset(root: Path, *, n_points: int = 3, n_images: int = 2) -> None:
    sparse_dir = root / "sparse" / "0"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    images_dir = root / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    width, height = 16, 16
    fx = fy = 20.0
    cx, cy = width / 2.0, height / 2.0

    cameras_lines = [
        "# Camera list with one line of data per camera:",
        "#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]",
        f"1 PINHOLE {width} {height} {fx} {fy} {cx} {cy}",
    ]
    (sparse_dir / "cameras.txt").write_text("\n".join(cameras_lines) + "\n")

    images_lines = [
        "# Image list with two lines of data per image:",
        "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
        "#   POINTS2D[] as (X, Y, POINT3D_ID)",
    ]
    image_names = []
    for i in range(n_images):
        name = f"frame_{i:03d}.png"
        image_names.append(name)
        tx = float(i) * 0.1
        images_lines.append(f"{i + 1} 1.0 0.0 0.0 0.0 {tx} 0.0 1.0 1 {name}")
        images_lines.append("")
        Image.new("RGB", (width, height), color=(10 * i, 50, 100)).save(images_dir / name)
    (sparse_dir / "images.txt").write_text("\n".join(images_lines) + "\n")

    points_lines = [
        "# 3D point list with one line of data per point:",
        "#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[]",
    ]
    for i in range(n_points):
        x, y, z = float(i) * 0.05, 0.0, 1.0 + float(i) * 0.05
        r, g, b = 200, 100, 50
        points_lines.append(f"{i + 1} {x} {y} {z} {r} {g} {b} 0.5")
    (sparse_dir / "points3D.txt").write_text("\n".join(points_lines) + "\n")


def test_load_colmap_and_export_splat_round_trip(tmp_path: Path) -> None:
    data_dir = tmp_path / "dataset"
    _write_synthetic_colmap_dataset(data_dir, n_points=3, n_images=2)

    cams, images, init_xyz, init_rgb = load_colmap(data_dir)

    assert len(cams) == 1
    assert len(images) == 2
    assert init_xyz.shape == (3, 3)
    assert init_rgb.shape == (3, 3)

    n = init_xyz.shape[0]
    means = torch.from_numpy(init_xyz)
    scales = torch.full((n, 3), 0.035)
    quats = F.normalize(torch.tensor([1.0, 0.0, 0.0, 0.0]).repeat(n, 1), dim=-1)
    opac = torch.full((n,), 0.9)
    colors = torch.from_numpy(init_rgb.astype("float32") / 255.0)

    out_path = tmp_path / "scene.splat"
    export_splat(out_path, means, scales, quats, opac, colors, prune=0.03)

    assert out_path.exists()
    byte_length = out_path.stat().st_size
    assert byte_length == n * 32
    assert byte_length % 32 == 0
