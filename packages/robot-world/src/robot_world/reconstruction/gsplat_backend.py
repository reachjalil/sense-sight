"""Optimized 3D Gaussian backend adapter (gsplat).

The feasible-now backend is
:class:`~robot_world.reconstruction.point_gaussian_backend.PointGaussianBackend`
(RGB-D backprojection -> colored points that also serve as Gaussian init).
:meth:`GsplatBackend.build` is the online/incremental photometric optimizer:
given that point initialization plus a small batch of posed keyframes, it runs
a short ``gsplat``/PyTorch optimization window over Gaussian positions,
scales, rotations, opacities, and colors and returns the optimized primitives
as numpy arrays. It is meant to be invoked repeatedly on small new keyframe
batches, not as a full multi-thousand-step from-scratch trainer.

In an environment where ``gsplat`` / ``torch`` are not installed,
:meth:`is_available` returns ``False`` and :meth:`build` raises
:class:`BackendUnavailable`. The point backend is the graceful fallback.
``gsplat`` and ``torch`` are imported lazily, inside :meth:`build`, and only
when both are already importable -- this module never imports them at load
time, so building this package never requires CUDA or PyTorch.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

from ..config import BackprojectConfig
from ..schemas import CameraIntrinsics, Keyframe, PointCloudChunk
from .point_gaussian_backend import quaternion_to_matrix


class BackendUnavailable(RuntimeError):
    """Raised when a reconstruction backend's dependencies are not installed."""


def _module_importable(name: str) -> bool:
    """True if ``name`` can be imported without importing it (cheap probe)."""

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


class GsplatBackend:
    """Adapter for a gsplat-based optimized 3D Gaussian backend.

    The constructor never imports ``gsplat``/``torch`` (so it is safe to build
    in any environment). Availability is probed lazily; ``build`` raises a
    clear :class:`BackendUnavailable` when the dependencies are missing, and
    otherwise imports ``gsplat``/``torch`` only inside its own body.
    """

    name = "gsplat"
    required_modules = ("gsplat", "torch")

    # Per-parameter-group Adam learning-rate ratios, relative to scene scale
    # for ``means``, so a short online window behaves consistently with a full
    # offline 3DGS trainer it is a repeatedly-invoked sibling of.
    _LR_MEANS_PER_SCENE_SCALE = 1.6e-4
    _LR_LOG_SCALES = 5e-3
    _LR_QUATS = 1e-3
    _LR_OPACITIES = 5e-2
    _LR_COLORS = 2.5e-3

    def __init__(
        self,
        config: BackprojectConfig,
        repo_root: str | Path,
        search_roots: list[str | Path] | None = None,
        base_to_camera: np.ndarray | None = None,
    ) -> None:
        self.config = config
        self.repo_root = Path(repo_root)
        self.search_roots = search_roots
        self.base_to_camera = base_to_camera

    # -- availability ------------------------------------------------------

    @classmethod
    def is_available(cls) -> bool:
        """True only if every required module (gsplat, torch) is importable."""

        return all(_module_importable(m) for m in cls.required_modules)

    @classmethod
    def unavailable_reason(cls) -> str:
        missing = [m for m in cls.required_modules if not _module_importable(m)]
        if not missing:
            return ""
        return "missing modules: " + ", ".join(missing)

    # -- build ---------------------------------------------------------------

    def backproject(
        self, keyframe: Keyframe, intrinsics: CameraIntrinsics
    ) -> PointCloudChunk:
        """Not provided by the optimizer seam; use ``build`` (or the point backend)."""

        raise BackendUnavailable(
            "GsplatBackend does not implement per-keyframe backprojection. Use "
            "PointGaussianBackend for the RGB-D point path, or call build() once "
            "gsplat/torch are installed."
        )

    def build(
        self,
        init_xyz: np.ndarray | None = None,
        init_rgb: np.ndarray | None = None,
        posed_frames: list[Keyframe] | None = None,
        intrinsics: CameraIntrinsics | None = None,
        iterations: int = 1500,
        sh_degree: int = 0,
    ) -> dict:
        """Run a short online/incremental Gaussian optimization window.

        Initializes one Gaussian per ``init_xyz``/``init_rgb`` point (typically
        :class:`~robot_world.reconstruction.point_gaussian_backend.PointGaussianBackend`
        output for a new keyframe batch), then optimizes positions, scales,
        rotations, opacities, and colors against ``posed_frames`` for
        ``iterations`` steps. ``sh_degree`` is accepted for forward
        compatibility with a spherical-harmonic color model; this window only
        optimizes degree-0 (flat RGB) color regardless of its value.

        Unlike a from-scratch trainer, ``iterations`` is expected to be small
        (hundreds, not thousands): this method is meant to be called
        repeatedly as new keyframe batches arrive, refining the existing
        point/Gaussian seed rather than re-optimizing the whole map each time.

        ``init_xyz`` / ``init_rgb`` / ``posed_frames`` / ``intrinsics`` are
        keyword-defaultable only so that calling ``build()`` with no arguments
        in an unavailable environment still raises :class:`BackendUnavailable`
        (the availability check below) rather than a ``TypeError`` about
        missing arguments; they are required in practice once the backend is
        available.

        Returns a dict of numpy arrays plus optimization metadata; this method
        does not write any file.
        """

        if not self.is_available():
            raise BackendUnavailable(
                "gsplat backend unavailable in this environment "
                f"({self.unavailable_reason()}). Install gsplat + torch (CUDA) to "
                "enable photometric Gaussian optimization, or use the default "
                "point backend (--backend point)."
            )
        if init_xyz is None or init_rgb is None or intrinsics is None:
            raise ValueError(
                "GsplatBackend.build requires init_xyz, init_rgb, posed_frames, "
                "and intrinsics once the backend is available"
            )
        if not posed_frames:
            raise ValueError("GsplatBackend.build requires at least one posed frame")

        import torch
        import torch.nn.functional as F
        from gsplat import rasterization

        device = "cuda" if torch.cuda.is_available() else "cpu"

        gt, viewmats, Ks = self._load_render_targets(posed_frames, intrinsics, device)
        height, width = int(intrinsics.height), int(intrinsics.width)

        cam_centers = (
            -viewmats[:, :3, :3].transpose(1, 2) @ viewmats[:, :3, 3:]
        ).squeeze(-1)
        scene_scale = (
            float((cam_centers - cam_centers.mean(0)).norm(dim=1).mean()) + 1e-3
        )

        n = int(np.asarray(init_xyz).shape[0])
        if n == 0:
            raise ValueError("GsplatBackend.build requires a non-empty init_xyz")
        init_scale = self._init_scale_m(init_xyz)

        means = torch.nn.Parameter(
            torch.as_tensor(init_xyz, dtype=torch.float32, device=device)
        )
        log_scales = torch.nn.Parameter(
            torch.full((n, 3), float(np.log(init_scale)), device=device)
        )
        quats = torch.nn.Parameter(
            torch.tensor([1.0, 0.0, 0.0, 0.0], device=device).repeat(n, 1)
        )
        opacities = torch.nn.Parameter(torch.full((n,), _logit(0.5), device=device))
        rgb0 = torch.as_tensor(
            np.asarray(init_rgb, dtype=np.float32) / 255.0, device=device
        ).clamp(1e-4, 1 - 1e-4)
        colors = torch.nn.Parameter(torch.log(rgb0 / (1.0 - rgb0)))

        optimizer = torch.optim.Adam(
            [
                {
                    "params": [means],
                    "lr": self._LR_MEANS_PER_SCENE_SCALE * scene_scale,
                },
                {"params": [log_scales], "lr": self._LR_LOG_SCALES},
                {"params": [quats], "lr": self._LR_QUATS},
                {"params": [opacities], "lr": self._LR_OPACITIES},
                {"params": [colors], "lr": self._LR_COLORS},
            ]
        )

        num_frames = gt.shape[0]
        generator = torch.Generator(device="cpu").manual_seed(0)
        final_loss = 0.0
        steps_run = 0
        for _step in range(max(0, int(iterations))):
            idx = int(torch.randint(0, num_frames, (1,), generator=generator).item())
            renders, _, _ = rasterization(
                means=means,
                quats=F.normalize(quats, dim=-1),
                scales=torch.exp(log_scales),
                opacities=torch.sigmoid(opacities),
                colors=torch.sigmoid(colors),
                viewmats=viewmats[idx : idx + 1],
                Ks=Ks[idx : idx + 1],
                width=width,
                height=height,
                sh_degree=None,
                render_mode="RGB",
                packed=False,
            )
            pred = renders[0].clamp(0, 1)
            target = gt[idx]
            loss = (pred - target).abs().mean()

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

            final_loss = float(loss.item())
            steps_run += 1

        return {
            "positions": means.detach().cpu().numpy().astype(np.float32),
            "scales": torch.exp(log_scales).detach().cpu().numpy().astype(np.float32),
            "rotations": F.normalize(quats, dim=-1)
            .detach()
            .cpu()
            .numpy()
            .astype(np.float32),
            "colors": torch.sigmoid(colors).detach().cpu().numpy().astype(np.float32),
            "opacities": torch.sigmoid(opacities)
            .detach()
            .cpu()
            .numpy()
            .astype(np.float32),
            "final_loss": final_loss,
            "iterations": steps_run,
        }

    # -- internals -----------------------------------------------------------

    def _init_scale_m(self, init_xyz: np.ndarray) -> float:
        """Isotropic Gaussian init scale (meters), delegated to splat_io.

        Reuses the same point-spacing estimator the chunk/splat writers use,
        so the optimizer starts from a scale already consistent with the rest
        of the pipeline.
        """

        from splat_io import estimate_gaussian_scale

        return estimate_gaussian_scale(np.asarray(init_xyz, dtype=np.float32))

    def _resolve(self, rel_path: str) -> Path:
        roots = (
            [Path(r) for r in self.search_roots]
            if self.search_roots
            else [self.repo_root]
        )
        for root in roots:
            candidate = root / rel_path
            if candidate.exists():
                return candidate
        return roots[0] / rel_path

    def _load_render_targets(
        self,
        posed_frames: list[Keyframe],
        intrinsics: CameraIntrinsics,
        device: str,
    ):
        """Build ground-truth images + world-to-camera viewmats + intrinsics.

        Mirrors :class:`~robot_world.reconstruction.point_gaussian_backend.PointGaussianBackend`'s
        pose composition: the ground-truth pose is the base_link pose in the
        world, so the camera-to-world rotation/translation is composed from
        ``base_to_camera`` and the keyframe pose, then inverted to the
        world-to-camera ``viewmat`` that ``gsplat.rasterization`` expects.
        """

        import torch

        base_to_camera = (
            np.asarray(self.base_to_camera, dtype=np.float64)
            if self.base_to_camera is not None
            else np.eye(4, dtype=np.float64)
        )
        r_bc = base_to_camera[:3, :3]
        t_bc = base_to_camera[:3, 3]

        height, width = int(intrinsics.height), int(intrinsics.width)
        gt_frames: list[np.ndarray] = []
        viewmat_list: list[np.ndarray] = []
        for kf in posed_frames:
            with Image.open(self._resolve(kf.frame.image_path)) as img:
                pil = img.convert("RGB")
                if pil.size != (width, height):
                    pil = pil.resize((width, height))
                gt_frames.append(np.asarray(pil, dtype=np.float32) / 255.0)

            r_wb = quaternion_to_matrix(kf.pose.quaternion)
            t_wb = np.array(
                [kf.pose.position.x, kf.pose.position.y, kf.pose.position.z],
                dtype=np.float64,
            )
            # camera -> world: R_wc = R_wb @ R_bc, t_wc = R_wb @ t_bc + t_wb
            r_wc = r_wb @ r_bc
            t_wc = r_wb @ t_bc + t_wb
            # world -> camera (the gsplat/COLMAP "viewmat" convention).
            r_cw = r_wc.T
            t_cw = -r_cw @ t_wc
            viewmat = np.eye(4, dtype=np.float32)
            viewmat[:3, :3] = r_cw.astype(np.float32)
            viewmat[:3, 3] = t_cw.astype(np.float32)
            viewmat_list.append(viewmat)

        gt = torch.as_tensor(np.stack(gt_frames), dtype=torch.float32, device=device)
        viewmats = torch.as_tensor(
            np.stack(viewmat_list), dtype=torch.float32, device=device
        )
        k = np.array(
            [
                [intrinsics.fx, 0.0, intrinsics.cx],
                [0.0, intrinsics.fy, intrinsics.cy],
                [0.0, 0.0, 1.0],
            ],
            dtype=np.float32,
        )
        ks = torch.as_tensor(
            np.repeat(k[None, :, :], len(posed_frames), axis=0),
            dtype=torch.float32,
            device=device,
        )
        return gt, viewmats, ks


def _logit(p: float) -> float:
    """Inverse-sigmoid of a scalar probability in ``(0, 1)``."""

    return float(np.log(p / (1.0 - p)))
