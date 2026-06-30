"""PointGaussianBackend: RGB-D backprojection into a colored point cloud.

For a keyframe, reads the color + aligned-depth PNGs, selects valid-depth
pixels inside the usable metric band, samples a fixed budget of them,
backprojects to the camera frame, then rotates+translates by the keyframe pose
into the dataset's world frame (Z-up). Colors are the source RGB pixels.

Each emitted point is also a valid seed for an isotropic 3D Gaussian (position
+ color), hence the name; the chunk/splat writers size each Gaussian from the
point spacing (see :func:`splat_io.estimate_gaussian_scale`).

The ground-truth pose is the OpenLORIS ``base_link`` (robot body) pose in the
world, NOT the color-camera pose. The calibrated
``base_link -> d400_color_optical_frame`` extrinsic (``base_to_camera``) is
composed before applying the pose, so points land correctly. When the
extrinsic is absent it defaults to identity (correct when poses are already
camera poses, e.g. synthetic test fixtures).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from ..config import BackprojectConfig
from ..schemas import CameraIntrinsics, Keyframe, PointCloudChunk, Quaternion


def quaternion_to_matrix(q: Quaternion) -> np.ndarray:
    """Convert a scalar-last unit quaternion to a 3x3 rotation matrix."""

    x, y, z, w = q.x, q.y, q.z, q.w
    n = x * x + y * y + z * z + w * w
    if n < 1e-12:
        return np.eye(3, dtype=np.float64)
    s = 2.0 / n
    xx, yy, zz = x * x * s, y * y * s, z * z * s
    xy, xz, yz = x * y * s, x * z * s, y * z * s
    wx, wy, wz = w * x * s, w * y * s, w * z * s
    return np.array(
        [
            [1.0 - (yy + zz), xy - wz, xz + wy],
            [xy + wz, 1.0 - (xx + zz), yz - wx],
            [xz - wy, yz + wx, 1.0 - (xx + yy)],
        ],
        dtype=np.float64,
    )


class PointGaussianBackend:
    """RGB-D backprojection backend (colored point / Gaussian seeds)."""

    name = "point_gaussian"

    def __init__(
        self,
        config: BackprojectConfig,
        repo_root: str | Path,
        search_roots: list[str | Path] | None = None,
        base_to_camera: np.ndarray | None = None,
    ) -> None:
        self.config = config
        self.repo_root = Path(repo_root)
        # Candidate roots to resolve dataset-relative paths against, in
        # priority order. Manifest paths are relative to the dataset root, so
        # callers pass that first with repo_root as fallback.
        roots = search_roots if search_roots is not None else [repo_root]
        self.search_roots = [Path(r) for r in roots]
        # base_link -> color-camera extrinsic (4x4). The pose maps base_link
        # to world, so color-frame points are first lifted into base_link via
        # this. Identity is correct when poses are already camera poses.
        if base_to_camera is None:
            base_to_camera = np.eye(4, dtype=np.float64)
        self.base_to_camera = np.asarray(base_to_camera, dtype=np.float64)
        self._R_bc = self.base_to_camera[:3, :3]
        self._t_bc = self.base_to_camera[:3, 3]

    # -- IO --------------------------------------------------------------

    def _resolve(self, rel_path: str) -> Path:
        for root in self.search_roots:
            candidate = root / rel_path
            if candidate.exists():
                return candidate
        # Fall back to the first root (error message points somewhere sensible).
        base = self.search_roots[0] if self.search_roots else self.repo_root
        return base / rel_path

    def load_color(self, rel_path: str) -> np.ndarray:
        """Load an RGB image as a uint8 (H, W, 3) array."""

        with Image.open(self._resolve(rel_path)) as img:
            return np.asarray(img.convert("RGB"), dtype=np.uint8)

    def load_depth_mm(self, rel_path: str) -> np.ndarray:
        """Load a 16-bit depth PNG as a uint16 (H, W) array (millimeters)."""

        with Image.open(self._resolve(rel_path)) as img:
            arr = np.asarray(img)
        if arr.ndim != 2:
            arr = arr[..., 0]
        return arr.astype(np.uint16)

    def depth_valid_ratio(self, rel_path: str) -> float:
        """Valid-depth ratio for a depth PNG (used by keyframe selection)."""

        from ..ingestion.quality import depth_valid_ratio

        depth = self.load_depth_mm(rel_path)
        return depth_valid_ratio(depth, self.config.min_depth_m, self.config.max_depth_m)

    # -- core --------------------------------------------------------------

    def backproject(
        self, keyframe: Keyframe, intrinsics: CameraIntrinsics
    ) -> PointCloudChunk:
        """Backproject a keyframe to world-frame colored points."""

        frame = keyframe.frame
        color = self.load_color(frame.image_path)
        depth_mm = self.load_depth_mm(frame.depth_path)

        h, w = depth_mm.shape
        # Guard against color/depth size mismatch (resize color to depth grid).
        if color.shape[0] != h or color.shape[1] != w:
            with Image.open(self._resolve(frame.image_path)) as img:
                color = np.asarray(img.convert("RGB").resize((w, h)), dtype=np.uint8)

        lo = self.config.min_depth_m * 1000.0
        hi = self.config.max_depth_m * 1000.0
        valid = (depth_mm >= lo) & (depth_mm <= hi)
        vs, us = self._sample_valid_pixels(valid, frame.frame_index)
        if vs.size == 0:
            return PointCloudChunk(
                keyframe_index=frame.frame_index,
                xyz=np.empty((0, 3), dtype=np.float32),
                rgb=np.empty((0, 3), dtype=np.uint8),
            )

        z = depth_mm[vs, us].astype(np.float64) / 1000.0  # meters
        x_cam = (us.astype(np.float64) - intrinsics.cx) / intrinsics.fx * z
        y_cam = (vs.astype(np.float64) - intrinsics.cy) / intrinsics.fy * z
        pc = np.stack([x_cam, y_cam, z], axis=1)  # (N, 3) color optical frame

        # The ground-truth pose is the base_link (robot body) pose in the
        # world, NOT the color-camera pose, so two transforms compose:
        #   1) color optical -> base_link via the calibrated extrinsic:
        #        P_base = R_bc * P_color + t_bc
        #   2) base_link -> world via the ground-truth pose:
        #        P_world = R_wb * P_base + t_wb
        # When base_to_camera is identity (synthetic tests) this reduces to
        # the plain "pose is the camera pose" case.
        p_base = pc @ self._R_bc.T + self._t_bc
        rot = quaternion_to_matrix(keyframe.pose.quaternion)
        t = np.array(
            [
                keyframe.pose.position.x,
                keyframe.pose.position.y,
                keyframe.pose.position.z,
            ],
            dtype=np.float64,
        )
        world = p_base @ rot.T + t  # (N, 3) world frame (Z-up)

        rgb = color[vs, us, :3].astype(np.uint8)
        return PointCloudChunk(
            keyframe_index=frame.frame_index,
            xyz=world.astype(np.float32),
            rgb=rgb,
        )

    def _sample_valid_pixels(
        self, valid: np.ndarray, frame_index: int
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return sampled valid pixel rows/cols within the keyframe budget.

        Building ``np.nonzero(valid)`` for the whole image before sampling
        means allocating and shuffling hundreds of thousands of candidate
        coordinates per keyframe at typical RGB-D resolutions. The default
        stratified-grid path instead starts from a deterministic lattice sized
        near the point budget, only falling back to denser scans when the
        valid pixels are sparse.
        """

        budget = max(0, int(self.config.points_per_keyframe))
        if budget == 0:
            empty = np.empty((0,), dtype=np.int64)
            return empty, empty

        valid_count = int(valid.sum())
        if valid_count == 0:
            empty = np.empty((0,), dtype=np.int64)
            return empty, empty

        rng = np.random.default_rng(self.config.sample_seed + frame_index)
        if valid_count <= budget or self.config.sample_strategy == "random":
            vs, us = np.nonzero(valid)
            if vs.size > budget:
                pick = rng.choice(vs.size, size=budget, replace=False)
                vs = vs[pick]
                us = us[pick]
            return vs, us

        h, w = valid.shape
        # Approximate a square lattice that yields at least the requested
        # count on dense depth maps, then tighten if the offset lands on
        # sparse valid regions. Floor, rather than ceil, avoids undersampling
        # dense frames.
        stride = max(1, int(np.sqrt(valid_count / budget)))
        best_vs = np.empty((0,), dtype=np.int64)
        best_us = np.empty((0,), dtype=np.int64)

        while stride >= 1:
            off_v = int(rng.integers(0, stride)) if stride > 1 else 0
            off_u = int(rng.integers(0, stride)) if stride > 1 else 0
            sub = valid[off_v:h:stride, off_u:w:stride]
            rel_v, rel_u = np.nonzero(sub)
            vs = rel_v.astype(np.int64) * stride + off_v
            us = rel_u.astype(np.int64) * stride + off_u
            best_vs, best_us = vs, us
            if vs.size >= budget or stride == 1:
                break
            stride -= 1

        if best_vs.size > budget:
            pick = rng.choice(best_vs.size, size=budget, replace=False)
            best_vs = best_vs[pick]
            best_us = best_us[pick]
        return best_vs, best_us
