"""Pipeline tests over tiny synthetic fixtures (no large dataset required).

Run with: ``python3 -m pytest packages/robot-world/tests``

Each test creates its own temp dataset so they are independent.
"""

from __future__ import annotations

import json
import math
import tempfile
from pathlib import Path

import numpy as np

from robot_world.config import BackprojectConfig, KeyframeConfig, PipelineConfig
from robot_world.ingestion.openloris_adapter import OpenLorisDatasetAdapter
from robot_world.pose.pose_selector import PoseSelector
from robot_world.pose.robot_pose_provider import RobotPoseProvider
from robot_world.reconstruction import keyframes as keyframes_mod
from robot_world.reconstruction.colmap_bundle import (
    QUATERNION_ROUNDTRIP_MAX_ERR,
    REPROJECTION_GATE_MEAN_FRACTION,
    build_colmap_bundle,
    quat_wxyz_to_mat,
    rotmat_to_quat_wxyz,
)
from robot_world.reconstruction.gsplat_backend import BackendUnavailable, GsplatBackend
from robot_world.reconstruction.incremental_updater import IncrementalUpdater
from robot_world.reconstruction.point_gaussian_backend import (
    PointGaussianBackend,
    quaternion_to_matrix,
)
from robot_world.schemas import Keyframe, Quaternion
from robot_world.storage.chunk_store import ChunkStore, KeyframeSpan
from robot_world.storage.world_store import WorldStore

from .fixtures import make_dataset


def _tmp_dataset() -> tuple[Path, OpenLorisDatasetAdapter]:
    tmp = Path(tempfile.mkdtemp(prefix="rw_test_"))
    root = make_dataset(tmp, sequence="synthseq", n_frames=12)
    return root, OpenLorisDatasetAdapter(root)


# -- adapter detection --------------------------------------------------------


def test_adapter_detection() -> None:
    root, adapter = _tmp_dataset()
    assert adapter.detect() is True
    summary = adapter.summary()
    assert "synthseq" in summary.sequences
    assert summary.modalities["color"] is True
    assert summary.modalities["lidar"] is False

    empty = Path(tempfile.mkdtemp(prefix="rw_empty_"))
    assert OpenLorisDatasetAdapter(empty).detect() is False


# -- manifest parse ------------------------------------------------------------


def test_manifest_parse() -> None:
    root, adapter = _tmp_dataset()
    frames = adapter.load_frames("synthseq")
    assert len(frames) == 12
    assert frames[0].frame_index == 0
    # The fixture marks frame index 1 as unposed.
    assert frames[1].has_pose is False
    assert frames[0].has_pose is True
    ts = [f.timestamp for f in frames]
    assert ts == sorted(ts)


# -- pose selection -------------------------------------------------------------


def test_pose_selection_skips_unposed() -> None:
    root, adapter = _tmp_dataset()
    frames = adapter.load_frames("synthseq")
    selector = PoseSelector([RobotPoseProvider(confidence=1.0)])
    posed = selector.select_all(frames)
    # 12 frames, one unposed -> 11 posed.
    assert len(posed) == 11
    for _frame, est in posed:
        assert est.confidence == 1.0
        assert est.source == "manifest_groundtruth"


# -- keyframe selection ---------------------------------------------------------


def test_keyframe_selection() -> None:
    root, adapter = _tmp_dataset()
    frames = adapter.load_frames("synthseq")
    selector = PoseSelector([RobotPoseProvider(confidence=1.0)])
    posed = selector.select_all(frames)
    backend = PointGaussianBackend(BackprojectConfig(), root, search_roots=[root])
    cfg = KeyframeConfig(target_count=100, min_translation_m=0.1)
    kfs = keyframes_mod.select(
        posed, cfg, depth_ratio_fn=lambda fr: backend.depth_valid_ratio(fr.depth_path)
    )
    # Robot moves 0.5 m/frame, gate is 0.1 m -> every posed frame qualifies.
    assert len(kfs) == 11
    assert all(kf.depth_valid_ratio > 0.9 for kf in kfs)
    capped = keyframes_mod.select(
        posed,
        cfg,
        depth_ratio_fn=lambda fr: backend.depth_valid_ratio(fr.depth_path),
        max_keyframes=4,
    )
    assert len(capped) == 4


# -- backprojection shape + geometry --------------------------------------------


def test_backprojection_shape_and_geometry() -> None:
    root, adapter = _tmp_dataset()
    frames = adapter.load_frames("synthseq")
    intr = adapter.load_intrinsics("synthseq")
    pose = RobotPoseProvider().pose_for(frames[0])
    assert pose is not None

    kf = Keyframe(frame=frames[0], pose=pose, depth_valid_ratio=1.0)
    backend = PointGaussianBackend(BackprojectConfig(), root, search_roots=[root])
    chunk = backend.backproject(kf, intr)
    xyz = np.asarray(chunk.xyz)
    rgb = np.asarray(chunk.rgb)
    # 600 sampled points, (N, 3) shapes, matching counts.
    assert xyz.shape == (600, 3)
    assert rgb.shape == (600, 3)
    assert xyz.dtype == np.float32
    assert rgb.dtype == np.uint8
    # Identity-yaw camera at origin looking down +Z optical: with identity
    # extrinsic, world Z (depth) ~ 2 m for the constant-depth plane.
    assert abs(float(xyz[:, 2].mean()) - 2.0) < 0.01


def test_quaternion_matrix() -> None:
    assert np.allclose(quaternion_to_matrix(Quaternion(0, 0, 0, 1)), np.eye(3))
    # 90 deg about Z maps +X -> +Y.
    q = Quaternion(0, 0, math.sin(math.pi / 4), math.cos(math.pi / 4))
    v = quaternion_to_matrix(q) @ np.array([1.0, 0, 0])
    assert np.allclose(v, [0, 1, 0], atol=1e-6)


def test_quaternion_round_trip_matches_colmap_bundle_gate() -> None:
    """quat<->matrix round trip used by the bundle gate stays inside tolerance."""

    rng = np.random.default_rng(11)
    for _ in range(20):
        axis = rng.normal(size=3)
        axis /= np.linalg.norm(axis)
        angle = rng.uniform(-math.pi, math.pi)
        q = Quaternion(
            float(axis[0] * math.sin(angle / 2)),
            float(axis[1] * math.sin(angle / 2)),
            float(axis[2] * math.sin(angle / 2)),
            float(math.cos(angle / 2)),
        )
        R = quaternion_to_matrix(q)
        qw, qx, qy, qz = rotmat_to_quat_wxyz(R)
        R2 = quat_wxyz_to_mat(qw, qx, qy, qz)
        assert np.linalg.norm(R - R2) <= QUATERNION_ROUNDTRIP_MAX_ERR


# -- chunk store round trip ------------------------------------------------------


def test_chunk_store_round_trip() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="rw_chunk_"))
    cs = ChunkStore(tmp)
    xyz = np.array([[1, 2, 3], [4, 5, 6]], dtype=np.float32)
    rgb = np.array([[10, 20, 30], [40, 50, 60]], dtype=np.uint8)
    spans = [KeyframeSpan(0, 1000.0, 0, 1), KeyframeSpan(1, 1001.0, 1, 1)]
    manifest = cs.write_chunk(0, xyz, rgb, spans, "hash")
    assert manifest.point_count == 2
    rxyz, rrgb = cs.read_points(0)
    assert np.array_equal(rxyz, xyz)
    assert np.array_equal(rrgb, rgb)
    rm = cs.read_manifest(0)
    assert rm.point_count == 2
    assert len(rm.keyframe_spans) == 2


# -- splat round trip (via splat_io) ---------------------------------------------


def test_splat_round_trip() -> None:
    """Write N gaussians, read back: byte layout, count, finite positions."""

    from splat_io import SPLAT_RECORD_BYTES, read_splat, write_splat

    rng = np.random.default_rng(3)
    n = 257  # not a round number, to catch off-by-one record sizing
    xyz = rng.uniform(-2.0, 2.0, size=(n, 3)).astype(np.float32)
    rgb = rng.integers(0, 256, size=(n, 3), dtype=np.uint8)
    tmp = Path(tempfile.mkdtemp(prefix="rw_splat_"))
    path = tmp / "scene.splat"
    scale = 0.045
    nbytes = write_splat(path, xyz, rgb, scale=scale)

    assert nbytes == n * SPLAT_RECORD_BYTES
    assert path.stat().st_size == n * 32

    gaussians = read_splat(path)
    assert len(gaussians) == n
    for i in (0, n // 2, n - 1):
        g = gaussians[i]
        assert np.all(np.isfinite(g.position))
        assert np.allclose(g.position, xyz[i], atol=1e-5)
        assert np.allclose(g.scale, [scale, scale, scale], atol=1e-6)
        assert tuple(int(c) for c in g.rgba[:3]) == tuple(int(c) for c in rgb[i])
        assert int(g.rgba[3]) == 255
        assert tuple(int(b) for b in g.rotation) == (128, 128, 128, 255)


def test_chunk_store_writes_trained_splat_bundle() -> None:
    """write_trained_chunk round-trips through splat_io losslessly."""

    from splat_io import read_splat

    tmp = Path(tempfile.mkdtemp(prefix="rw_trained_"))
    cs = ChunkStore(tmp)
    n = 5
    rng = np.random.default_rng(5)
    positions = rng.uniform(-1, 1, size=(n, 3)).astype(np.float32)
    scales = np.full((n, 3), 0.05, dtype=np.float32)
    rotations = np.tile([1.0, 0.0, 0.0, 0.0], (n, 1)).astype(np.float64)
    colors = rng.uniform(0, 1, size=(n, 3))
    opacities = np.full((n,), 0.8)

    manifest = cs.write_trained_chunk(
        chunk_id=0,
        positions=positions,
        scales=scales,
        rotations=rotations,
        colors=colors,
        opacities=opacities,
        metrics={"sh_degree": 0, "validation_loss": 0.05},
        config_hash="hash",
    )
    assert manifest.gaussian_count == n
    splat_path = tmp / "chunk_0000_trained.splat"
    assert splat_path.is_file()
    gaussians = read_splat(splat_path)
    assert len(gaussians) == n


# -- world store round trip + incremental updates --------------------------------


def test_world_store_round_trip() -> None:
    root, adapter = _tmp_dataset()
    intrinsics = adapter.load_intrinsics("synthseq")
    cfg = PipelineConfig()
    store = WorldStore(root / "processed" / "world_store")
    store.create(
        world_id="synthseq-test",
        sequence="synthseq",
        source_dataset=adapter.dataset_name,
        intrinsics=intrinsics,
        config_hash=cfg.config_hash(),
    )

    xyz = np.array([[0, 0, 0], [1, 1, 1]], dtype=np.float32)
    rgb = np.array([[1, 2, 3], [4, 5, 6]], dtype=np.uint8)
    spans = [KeyframeSpan(0, 1000.0, 0, 2)]
    store.append_chunk("synthseq-test", xyz, rgb, spans, cfg.config_hash())

    meta = store.load_meta("synthseq-test")
    assert meta.point_total == 2
    assert meta.keyframe_count == 1
    rxyz, rrgb = store.read_all_points("synthseq-test")
    assert rxyz.shape[0] == 2
    assert rrgb.shape[0] == 2
    versions = store.load_versions("synthseq-test")
    assert versions.latest is not None
    assert versions.latest.version == 1


def test_incremental_update_appends_only() -> None:
    root, adapter = _tmp_dataset()
    intrinsics = adapter.load_intrinsics("synthseq")
    cfg = PipelineConfig(
        keyframes=KeyframeConfig(target_count=4, min_translation_m=0.1),
    )
    store = WorldStore(root / "processed" / "world_store")
    store.create(
        world_id="synthseq-incremental",
        sequence="synthseq",
        source_dataset=adapter.dataset_name,
        intrinsics=intrinsics,
        config_hash=cfg.config_hash(),
    )

    updater = IncrementalUpdater(adapter, root, cfg)
    first = updater.update_world("synthseq-incremental", store, max_frames=2)
    assert first.processed_keyframes == 2
    assert first.new_chunk_id == 0

    meta0 = store.load_meta("synthseq-incremental")
    chunk_xyz_before = (
        store._world_dir("synthseq-incremental") / "chunks" / "chunk_0000_xyz.f32"
    ).read_bytes()

    second = updater.update_world("synthseq-incremental", store, max_frames=2)
    assert second.processed_keyframes <= 2

    # Prior chunk is byte-for-byte unchanged after the second append.
    still_there = (
        store._world_dir("synthseq-incremental") / "chunks" / "chunk_0000_xyz.f32"
    ).read_bytes()
    assert still_there == chunk_xyz_before

    meta1 = store.load_meta("synthseq-incremental")
    assert meta1.keyframe_count >= meta0.keyframe_count
    versions = store.load_versions("synthseq-incremental")
    assert versions.latest is not None
    assert versions.latest.version >= 2


# -- COLMAP bundle builder: reprojection + quaternion gates -----------------------


def test_build_colmap_bundle_passes_gates_on_synthetic_fixture() -> None:
    """A small, adjacent-frame window stays co-visible enough to pass both gates.

    The synthetic fixture only translates the camera (no rotation) over a flat
    depth plane, so a wide keyframe spread quickly loses co-visibility between
    the seed cloud and far-apart cameras. A tight window of adjacent frames
    keeps the scene in view of every sampled camera, which is the regime the
    reprojection gate is meant to validate.
    """

    root, adapter = _tmp_dataset()
    out_dir = Path(tempfile.mkdtemp(prefix="rw_bundle_")) / "bundle"
    manifest = build_colmap_bundle(
        dataset_root=root,
        sequence="synthseq",
        frame_start=0,
        frame_count=3,
        max_keyframes=3,
        output_dir=out_dir,
        seed_point_limit=2000,
        config=PipelineConfig(keyframes=KeyframeConfig(target_count=3, min_translation_m=0.1)),
    )
    gate = manifest["gate"]
    assert gate["quaternionRoundTripOk"] is True
    assert gate["quaternionRoundTripMaxErr"] <= QUATERNION_ROUNDTRIP_MAX_ERR
    assert gate["meanInBoundsFraction"] >= REPROJECTION_GATE_MEAN_FRACTION
    assert gate["passed"] is True
    assert manifest["tarballSha256"]
    assert Path(manifest["tarballPath"]).is_file()

    sparse0 = out_dir / "sparse" / "0"
    assert (sparse0 / "cameras.txt").is_file()
    assert (sparse0 / "images.txt").is_file()
    assert (sparse0 / "points3D.txt").is_file()
    assert (out_dir / "images").is_dir()
    assert any((out_dir / "images").iterdir())


def test_build_colmap_bundle_gate_fails_on_low_covisibility_window() -> None:
    """A wide keyframe spread with no rotation fails the reprojection gate.

    The gate's job is to catch exactly this: cameras that no longer see the
    seed cloud they are meant to be trained against. It must report failure
    rather than silently emitting an unusable bundle.
    """

    root, adapter = _tmp_dataset()
    out_dir = Path(tempfile.mkdtemp(prefix="rw_bundle_wide_")) / "bundle"
    manifest = build_colmap_bundle(
        dataset_root=root,
        sequence="synthseq",
        frame_start=0,
        frame_count=12,
        max_keyframes=8,
        output_dir=out_dir,
        seed_point_limit=2000,
        config=PipelineConfig(keyframes=KeyframeConfig(target_count=8, min_translation_m=0.1)),
    )
    gate = manifest["gate"]
    assert gate["passed"] is False
    assert gate["meanInBoundsFraction"] < REPROJECTION_GATE_MEAN_FRACTION
    assert gate["status"] in ("fail", "partial")


def test_build_colmap_bundle_raises_on_empty_frame_window() -> None:
    root, adapter = _tmp_dataset()
    out_dir = Path(tempfile.mkdtemp(prefix="rw_bundle_empty_")) / "bundle"
    raised = False
    try:
        build_colmap_bundle(
            dataset_root=root,
            sequence="synthseq",
            frame_start=10_000,
            frame_count=4,
            max_keyframes=4,
            output_dir=out_dir,
        )
    except RuntimeError:
        raised = True
    assert raised is True


# -- pluggable gsplat backend seam ------------------------------------------------


def test_gsplat_backend_unavailable_here() -> None:
    """gsplat/torch are not installed in this environment; the seam reports that."""

    assert GsplatBackend.is_available() is False
    assert GsplatBackend.unavailable_reason() != ""
    gb = GsplatBackend(BackprojectConfig(), "/tmp/repo")
    raised = False
    try:
        gb.build()
    except BackendUnavailable:
        raised = True
    assert raised is True


# Collected for ad-hoc invocation outside pytest.
ALL_TESTS = [
    test_adapter_detection,
    test_manifest_parse,
    test_pose_selection_skips_unposed,
    test_keyframe_selection,
    test_backprojection_shape_and_geometry,
    test_quaternion_matrix,
    test_quaternion_round_trip_matches_colmap_bundle_gate,
    test_chunk_store_round_trip,
    test_splat_round_trip,
    test_chunk_store_writes_trained_splat_bundle,
    test_world_store_round_trip,
    test_incremental_update_appends_only,
    test_build_colmap_bundle_passes_gates_on_synthetic_fixture,
    test_build_colmap_bundle_gate_fails_on_low_covisibility_window,
    test_build_colmap_bundle_raises_on_empty_frame_window,
    test_gsplat_backend_unavailable_here,
]
