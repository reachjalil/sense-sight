"""Build a COLMAP-format 3DGS training bundle for a frame window of a sequence.

Writes a standard COLMAP ``sparse/0`` reconstruction (``cameras.txt``,
``images.txt``, ``points3D.txt``) plus copies of the source color images, so
the result can be handed directly to any COLMAP-compatible 3D Gaussian
Splatting trainer. This function prepares training input only -- it does not
know or care where training later runs.

Two gates run before the bundle is considered usable, and their results are
always returned (never raised) so a caller can inspect why a bundle failed:

* **Reprojection sanity gate** -- the seed point cloud is reprojected into a
  sample of cameras; the mean in-bounds fraction across that sample must be
  ``>= 0.40`` (a wildly wrong camera/point alignment reprojects almost
  nowhere on screen).
* **Quaternion round-trip gate** -- every stored camera rotation is decoded
  back from its on-disk quaternion and compared to the matrix that produced
  it; the maximum per-camera error must be ``<= 1e-6``. This validates the
  written dataset (what a trainer will actually read), not an in-memory
  matrix that never reaches disk.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tarfile
from pathlib import Path

import numpy as np

from ..config import BackprojectConfig, PipelineConfig
from ..ingestion.openloris_adapter import OpenLorisDatasetAdapter
from ..pose.pose_selector import PoseSelector
from ..pose.robot_pose_provider import RobotPoseProvider
from ..schemas import FrameRecord
from . import keyframes as keyframes_mod
from .point_gaussian_backend import PointGaussianBackend, quaternion_to_matrix

try:
    import zstandard

    _HAS_ZSTANDARD = True
except ImportError:  # pragma: no cover - exercised only when zstandard is absent
    _HAS_ZSTANDARD = False

REPROJECTION_GATE_MEAN_FRACTION = 0.40
QUATERNION_ROUNDTRIP_MAX_ERR = 1e-6


def _frame_slice(frames: list[FrameRecord], *, start: int, count: int) -> list[FrameRecord]:
    """Time-ordered frame-index window."""

    selected = [frame for frame in frames if frame.frame_index >= start]
    return selected[: max(0, int(count))]


def quat_wxyz_to_mat(qw: float, qx: float, qy: float, qz: float) -> np.ndarray:
    """COLMAP scalar-first quaternion -> 3x3 rotation.

    This is the same conversion a COLMAP/3DGS reader performs on
    ``images.txt``, so it is used to validate the STORED pose.
    """

    n = np.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    qw, qx, qy, qz = qw / n, qx / n, qy / n, qz / n
    return np.array(
        [
            [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
            [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
            [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
        ],
        dtype=np.float64,
    )


def rotmat_to_quat_wxyz(R: np.ndarray) -> tuple[float, float, float, float]:
    """3x3 proper rotation -> quaternion (w, x, y, z), COLMAP scalar-first."""

    R = np.asarray(R, dtype=np.float64)
    trace = R[0, 0] + R[1, 1] + R[2, 2]
    if trace > 0.0:
        s = np.sqrt(trace + 1.0) * 2.0
        w = 0.25 * s
        x = (R[2, 1] - R[1, 2]) / s
        y = (R[0, 2] - R[2, 0]) / s
        z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2.0
        w = (R[2, 1] - R[1, 2]) / s
        x = 0.25 * s
        y = (R[0, 1] + R[1, 0]) / s
        z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2.0
        w = (R[0, 2] - R[2, 0]) / s
        x = (R[0, 1] + R[1, 0]) / s
        y = 0.25 * s
        z = (R[1, 2] + R[2, 1]) / s
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2.0
        w = (R[1, 0] - R[0, 1]) / s
        x = (R[0, 2] + R[2, 0]) / s
        y = (R[1, 2] + R[2, 1]) / s
        z = 0.25 * s
    q = np.array([w, x, y, z], dtype=np.float64)
    n = np.linalg.norm(q)
    if n > 0:
        q = q / n
    return float(q[0]), float(q[1]), float(q[2]), float(q[3])


def _reproduce_keyframes(
    dataset_root: Path,
    repo_root: Path,
    sequence: str,
    frame_start: int,
    frame_count: int,
    max_keyframes: int,
    config: PipelineConfig,
):
    cfg = config
    adapter = OpenLorisDatasetAdapter(dataset_root)

    intrinsics = adapter.load_intrinsics(sequence)
    all_frames = adapter.load_frames(sequence)
    frames = _frame_slice(all_frames, start=frame_start, count=frame_count)
    if not frames:
        raise RuntimeError(
            f"frame window selected no frames (start={frame_start}, "
            f"count={frame_count}) for sequence {sequence!r}"
        )

    # Pose source: robot ground truth, arbitrated by PoseSelector.
    robot = RobotPoseProvider(confidence=1.0)
    selector = PoseSelector([robot])
    posed = selector.select_all(frames)

    extrinsic = adapter.load_base_to_color_extrinsic(sequence)
    search_roots = [adapter.root, repo_root]
    backend = PointGaussianBackend(
        cfg.backproject,
        repo_root,
        search_roots=search_roots,
        base_to_camera=extrinsic,
    )
    depth_ratio_fn = lambda fr: backend.depth_valid_ratio(fr.depth_path)  # noqa: E731

    kfs = keyframes_mod.select(
        posed,
        cfg.keyframes,
        depth_ratio_fn=depth_ratio_fn,
        max_keyframes=max_keyframes,
    )
    if not kfs:
        raise RuntimeError(f"no keyframes selected for {sequence!r}")
    return intrinsics, kfs, extrinsic, backend


def _resolve_repo_path(rel_path: str, dataset_root: Path, repo_root: Path) -> Path:
    for root in (dataset_root, repo_root):
        cand = root / rel_path
        if cand.exists():
            return cand
    return dataset_root / rel_path


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _archive_bundle(output_dir: Path) -> tuple[Path, bool]:
    """Tar (+ zstd, falling back to gzip) ``output_dir`` next to itself.

    Returns ``(archive_path, used_zstd)``. ``zstandard`` is an optional
    dependency; when it is unavailable a ``.tar.gz`` fallback is produced
    instead, which is functionally equivalent.
    """

    if _HAS_ZSTANDARD:
        archive_path = output_dir.parent / f"{output_dir.name}.tar.zst"
        compressor = zstandard.ZstdCompressor(level=19)
        with archive_path.open("wb") as raw_f, compressor.stream_writer(raw_f) as zf:
            with tarfile.open(fileobj=zf, mode="w|") as tar:
                tar.add(output_dir, arcname=output_dir.name)
        return archive_path, True

    archive_path = output_dir.parent / f"{output_dir.name}.tar.gz"
    with tarfile.open(archive_path, mode="w:gz") as tar:
        tar.add(output_dir, arcname=output_dir.name)
    return archive_path, False


def build_colmap_bundle(
    dataset_root: str | Path,
    sequence: str,
    frame_start: int,
    frame_count: int,
    max_keyframes: int,
    output_dir: str | Path,
    seed_point_limit: int = 80_000,
    config: PipelineConfig | None = None,
) -> dict:
    """Build a COLMAP sparse/0 bundle for ``sequence`` and archive it.

    Writes ``output_dir/images/*``, ``output_dir/sparse/0/{cameras,images,
    points3D}.txt``, and ``output_dir/bundle_manifest.json``, then packages
    ``output_dir`` into ``output_dir.parent / f"{output_dir.name}.tar.zst"``
    (or ``.tar.gz`` if the ``zstandard`` package is unavailable). Returns a
    dict summary (also embedded as the bundle manifest) describing the build,
    including the mandatory reprojection/quaternion gate results.

    Camera poses and seed points are emitted directly in the dataset's native
    world frame (Z-up); no downstream-viewer coordinate remap is applied here.
    """

    dataset_root = Path(dataset_root)
    repo_root = dataset_root.resolve().parent.parent
    output_dir = Path(output_dir)
    output_images = output_dir / "images"
    output_sparse0 = output_dir / "sparse" / "0"
    cfg = config or PipelineConfig()

    intrinsics, kfs, extrinsic, _backend = _reproduce_keyframes(
        dataset_root, repo_root, sequence, frame_start, frame_count, max_keyframes, cfg
    )

    if output_images.exists():
        shutil.rmtree(output_images)
    output_images.mkdir(parents=True, exist_ok=True)
    output_sparse0.mkdir(parents=True, exist_ok=True)

    R_bc = extrinsic[:3, :3]
    t_bc = extrinsic[:3, 3]

    images_lines: list[str] = []
    per_kf_pose: list[dict] = []
    improper_count = 0
    max_roundtrip_err = 0.0
    seed_xyz_parts: list[np.ndarray] = []
    seed_rgb_parts: list[np.ndarray] = []

    backend = PointGaussianBackend(
        cfg.backproject,
        repo_root,
        search_roots=[dataset_root, repo_root],
        base_to_camera=extrinsic,
    )

    for image_id, kf in enumerate(kfs, start=1):
        frame = kf.frame
        src = _resolve_repo_path(frame.image_path, dataset_root, repo_root)
        name = Path(frame.image_path).name  # COLMAP image NAME = basename
        dst = output_images / name
        shutil.copyfile(src, dst)

        # camera-to-world in the dataset's world frame (Z-up):
        #   R_c2w = R_wb . R_bc ;  t_c2w = R_wb . t_bc + t_wb
        R_wb = quaternion_to_matrix(kf.pose.quaternion)  # base->world
        t_wb = np.array(
            [kf.pose.position.x, kf.pose.position.y, kf.pose.position.z],
            dtype=np.float64,
        )
        R_c2w = R_wb @ R_bc
        t_c2w = R_wb @ t_bc + t_wb

        # invert to world-to-camera (COLMAP "viewmat" convention).
        R_w2c = R_c2w.T
        t_w2c = -R_w2c @ t_c2w

        if np.linalg.det(R_w2c) < 0:
            improper_count += 1

        qw, qx, qy, qz = rotmat_to_quat_wxyz(R_w2c)
        tx, ty, tz = float(t_w2c[0]), float(t_w2c[1]), float(t_w2c[2])

        # The pose a trainer will ACTUALLY use is whatever the stored
        # quaternion decodes to. Decode it back and track the round-trip
        # error; the gate below reprojects with THIS matrix so it validates
        # the on-disk dataset, not an in-memory matrix that never reaches it.
        R_w2c_stored = quat_wxyz_to_mat(qw, qx, qy, qz)
        err = float(np.linalg.norm(R_w2c - R_w2c_stored))
        max_roundtrip_err = max(max_roundtrip_err, err)

        images_lines.append(
            f"{image_id} {qw:.10f} {qx:.10f} {qy:.10f} {qz:.10f} "
            f"{tx:.10f} {ty:.10f} {tz:.10f} 1 {name}"
        )
        images_lines.append("")  # blank POINTS2D line

        per_kf_pose.append(
            {
                "image_id": image_id,
                "name": name,
                "R_w2c": R_w2c_stored,  # round-tripped (what the trainer sees)
                "t_w2c": t_w2c,
                "det": float(np.linalg.det(R_w2c_stored)),
            }
        )

        # Seed points for points3D.txt: backproject this keyframe into the
        # same world frame the camera poses above live in.
        chunk = backend.backproject(kf, intrinsics)
        world_xyz = np.asarray(chunk.xyz, dtype=np.float64)
        if world_xyz.size:
            seed_xyz_parts.append(world_xyz.astype(np.float32))
            seed_rgb_parts.append(np.asarray(chunk.rgb, dtype=np.uint8))

    n_images = len(kfs)
    quat_ok = max_roundtrip_err <= QUATERNION_ROUNDTRIP_MAX_ERR

    # --- cameras.txt (single PINHOLE) --------------------------------------
    cameras_path = output_sparse0 / "cameras.txt"
    with cameras_path.open("w") as f:
        f.write("# Camera list with one line of data per camera:\n")
        f.write("#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n")
        f.write("# Number of cameras: 1\n")
        f.write(
            "1 PINHOLE %d %d %.10f %.10f %.10f %.10f\n"
            % (intrinsics.width, intrinsics.height, intrinsics.fx, intrinsics.fy, intrinsics.cx, intrinsics.cy)
        )

    # --- images.txt ---------------------------------------------------------
    images_path = output_sparse0 / "images.txt"
    with images_path.open("w") as f:
        f.write("# Image list with two lines of data per image:\n")
        f.write("#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n")
        f.write("#   POINTS2D[] as (X, Y, POINT3D_ID)\n")
        f.write(f"# Number of images: {n_images}\n")
        f.write("\n".join(images_lines))
        f.write("\n")

    # --- points3D.txt (subsample the backprojected seed cloud) -------------
    seed_xyz = (
        np.concatenate(seed_xyz_parts) if seed_xyz_parts else np.empty((0, 3), dtype=np.float32)
    )
    seed_rgb = (
        np.concatenate(seed_rgb_parts) if seed_rgb_parts else np.empty((0, 3), dtype=np.uint8)
    )
    n_seed = int(seed_xyz.shape[0])
    if n_seed > seed_point_limit:
        rng = np.random.default_rng(20240620)
        pick = rng.choice(n_seed, size=seed_point_limit, replace=False)
        pick.sort()
        init_xyz = seed_xyz[pick]
        init_rgb = seed_rgb[pick]
    else:
        init_xyz = seed_xyz
        init_rgb = seed_rgb
    n_init = int(init_xyz.shape[0])

    points3d_path = output_sparse0 / "points3D.txt"
    with points3d_path.open("w") as f:
        f.write("# 3D point list with one line of data per point:\n")
        f.write("#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[]\n")
        f.write(f"# Number of points: {n_init}\n")
        lines = []
        for pid in range(n_init):
            x, y, z = init_xyz[pid]
            r, g, b = init_rgb[pid]
            lines.append(f"{pid + 1} {x:.6f} {y:.6f} {z:.6f} {int(r)} {int(g)} {int(b)} 0")
        f.write("\n".join(lines))
        f.write("\n")

    # --- MANDATORY reprojection sanity gate ---------------------------------
    W, H = intrinsics.width, intrinsics.height
    fx, fy, cx, cy = intrinsics.fx, intrinsics.fy, intrinsics.cx, intrinsics.cy

    n_sample = min(6, n_images)
    sample_ids = np.linspace(0, n_images - 1, n_sample).round().astype(int)
    sample_ids = sorted(set(int(i) for i in sample_ids))

    P = init_xyz.astype(np.float64)
    fractions = []
    per_frame_gate: list[dict] = []
    for si in sample_ids:
        pose = per_kf_pose[si]
        R = pose["R_w2c"]
        t = pose["t_w2c"]
        cam = P @ R.T + t
        z = cam[:, 2]
        in_front = z > 0
        n_front = int(in_front.sum())
        if n_front == 0:
            fractions.append(0.0)
            per_frame_gate.append(
                {"index": si, "name": pose["name"], "inFront": 0, "inBounds": 0, "fraction": 0.0}
            )
            continue
        cf = cam[in_front]
        u = fx * cf[:, 0] / cf[:, 2] + cx
        v = fy * cf[:, 1] / cf[:, 2] + cy
        in_b = (u >= 0) & (u < W) & (v >= 0) & (v < H)
        n_in = int(in_b.sum())
        frac = n_in / n_front
        fractions.append(frac)
        per_frame_gate.append(
            {"index": si, "name": pose["name"], "inFront": n_front, "inBounds": n_in, "fraction": frac}
        )

    mean_frac = float(np.mean(fractions)) if fractions else 0.0
    max_frac = float(np.max(fractions)) if fractions else 0.0

    passed = (mean_frac >= REPROJECTION_GATE_MEAN_FRACTION) and quat_ok
    if not quat_ok:
        gate_status = "fail"
    elif passed:
        gate_status = "pass"
    elif max_frac >= REPROJECTION_GATE_MEAN_FRACTION:
        gate_status = "partial"
    else:
        gate_status = "fail"

    gate_result = {
        "status": gate_status,
        "passed": bool(passed),
        "meanInBoundsFraction": mean_frac,
        "maxInBoundsFraction": max_frac,
        "meanInBoundsThreshold": REPROJECTION_GATE_MEAN_FRACTION,
        "quaternionRoundTripOk": bool(quat_ok),
        "quaternionRoundTripMaxErr": max_roundtrip_err,
        "quaternionRoundTripThreshold": QUATERNION_ROUNDTRIP_MAX_ERR,
        "improperRotationCount": improper_count,
        "perFrame": per_frame_gate,
    }

    # --- bundle_manifest.json ------------------------------------------------
    manifest = {
        "sequence": sequence,
        "frameStart": int(frame_start),
        "frameCount": int(frame_count),
        "maxKeyframes": int(max_keyframes),
        "keyframeCount": n_images,
        "imageCount": n_images,
        "seedPointCount": n_init,
        "seedPointTotal": n_seed,
        "seedPointLimit": int(seed_point_limit),
        "imageResolution": {"width": W, "height": H},
        "gate": gate_result,
        "outputDir": str(output_dir),
        "tarballSha256": None,
        "tarballPath": None,
    }
    manifest_path = output_dir / "bundle_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    # Archive output_dir (including the manifest written above, which does
    # not yet carry the tarball's own sha256 -- that's only knowable after
    # this archive exists). bundle_manifest.json is then rewritten on disk
    # with the sha256/path/format filled in; the copy already inside the
    # tarball intentionally keeps the pre-hash placeholder values.
    archive_path, used_zstd = _archive_bundle(output_dir)
    tarball_sha256 = _sha256_file(archive_path)

    manifest["tarballSha256"] = tarball_sha256
    manifest["tarballPath"] = str(archive_path)
    manifest["tarballFormat"] = "tar.zst" if used_zstd else "tar.gz"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    return manifest
