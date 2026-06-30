#!/usr/bin/env python3
"""Photometric 3D Gaussian Splatting optimization.

Self-contained gsplat trainer. Loads a COLMAP dataset (cameras / images /
points3D), initializes one Gaussian per init point, and optimizes position +
scale + rotation + opacity + color against the source RGB frames via gsplat's
differentiable rasterizer. Exports the result in SenseSight's exact 32-byte
``.splat`` layout:

    position 3xfloat32 (12B) | scale 3xfloat32 (12B) | color RGBA 4xuint8 (4B)
    | rotation quat (x,y,z,w) 4xuint8 (4B)   = 32 bytes / Gaussian

Run on the GPU pod:
    python train_splat.py --data dataset --out scene.splat --steps 5000 \
      --checkpoint-dir checkpoints --checkpoint-every 500

This is the vendored copy used by the RunPod worker (packages/runpod-worker).
``main()`` only parses CLI args and calls ``train(args)`` so the worker handler
can invoke the trainer directly without going through a subprocess. The
default code path (sh_degree=0, densify=False, scale_reg_quantile=None,
mask_dir=None) is byte-identical to the unflagged trainer; the four flags
below are strictly opt-in.

``export_splat`` packs bytes directly via ``struct.pack`` rather than
importing ``sense-sight-splat-io`` -- this package's Docker build only copies
its own directory, so the 32-byte layout is duplicated here deliberately (see
README.md "Byte-format contract"). It mirrors `packages/splat-io` and
`packages/splat-codec` exactly; any change to the layout must be applied to
all three.
"""

from __future__ import annotations

import argparse
import struct
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


def qvec2rotmat(qw, qx, qy, qz):
    """COLMAP scalar-first quaternion -> 3x3 rotation (world-to-camera)."""
    n = qw * qw + qx * qx + qy * qy + qz * qz
    s = 2.0 / n
    return np.array(
        [
            [1 - s * (qy * qy + qz * qz), s * (qx * qy - qw * qz), s * (qx * qz + qw * qy)],
            [s * (qx * qy + qw * qz), 1 - s * (qx * qx + qz * qz), s * (qy * qz - qw * qx)],
            [s * (qx * qz - qw * qy), s * (qy * qz + qw * qx), 1 - s * (qx * qx + qy * qy)],
        ],
        dtype=np.float64,
    )


def load_colmap(data_dir: Path):
    cam_path = data_dir / "sparse" / "0" / "cameras.txt"
    img_path = data_dir / "sparse" / "0" / "images.txt"
    pts_path = data_dir / "sparse" / "0" / "points3D.txt"

    cams: dict[int, tuple] = {}
    for line in cam_path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        p = line.split()
        cid, model, W, H = int(p[0]), p[1], int(p[2]), int(p[3])
        assert model == "PINHOLE", f"expected PINHOLE, got {model}"
        fx, fy, cx, cy = map(float, p[4:8])
        cams[cid] = (W, H, fx, fy, cx, cy)

    images = []
    lines = [
        ln
        for ln in img_path.read_text().splitlines()
        if ln.strip() and not ln.startswith("#")
    ]
    i = 0
    while i < len(lines):
        p = lines[i].split()
        if len(p) < 10:
            i += 1
            continue
        qw, qx, qy, qz, tx, ty, tz = map(float, p[1:8])
        cid = int(p[8])
        name = p[9]
        R = qvec2rotmat(qw, qx, qy, qz)
        t = np.array([tx, ty, tz], dtype=np.float64)
        w2c = np.eye(4, dtype=np.float64)
        w2c[:3, :3] = R
        w2c[:3, 3] = t
        images.append({"w2c": w2c, "cam": cid, "name": name})
        if i + 1 < len(lines) and len(lines[i + 1].split()) < 10:
            i += 2
        else:
            i += 1

    xyz, rgb = [], []
    for line in pts_path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        p = line.split()
        xyz.append([float(p[1]), float(p[2]), float(p[3])])
        rgb.append([int(p[4]), int(p[5]), int(p[6])])
    return cams, images, np.array(xyz, np.float32), np.array(rgb, np.uint8)


def _gauss_window(size=11, sigma=1.5, device="cuda"):
    c = torch.arange(size, device=device) - size // 2
    g = torch.exp(-(c**2) / (2 * sigma**2))
    g = (g / g.sum()).unsqueeze(1)
    w = (g @ g.t()).unsqueeze(0).unsqueeze(0)
    return w.expand(3, 1, size, size).contiguous()


def ssim(a, b, window):
    mu_a = F.conv2d(a, window, padding=5, groups=3)
    mu_b = F.conv2d(b, window, padding=5, groups=3)
    mu_a2, mu_b2, mu_ab = mu_a * mu_a, mu_b * mu_b, mu_a * mu_b
    sa = F.conv2d(a * a, window, padding=5, groups=3) - mu_a2
    sb = F.conv2d(b * b, window, padding=5, groups=3) - mu_b2
    sab = F.conv2d(a * b, window, padding=5, groups=3) - mu_ab
    c1, c2 = 0.01**2, 0.03**2
    s = ((2 * mu_ab + c1) * (2 * sab + c2)) / (
        (mu_a2 + mu_b2 + c1) * (sa + sb + c2)
    )
    return s.mean()


def _load_mask(mask_dir: Path, image_name: str, W: int, H: int, device: str):
    """Load a same-basename mask (any common extension), resized + thresholded.

    Returns a (H, W, 1) float32 tensor in {0.0, 1.0} on ``device``, or ``None``
    when no mask file is found for this image.
    """
    stem = Path(image_name).stem
    candidate = None
    for ext in (".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"):
        p = mask_dir / f"{stem}{ext}"
        if p.exists():
            candidate = p
            break
    if candidate is None:
        return None
    pil = Image.open(candidate).convert("L")
    if pil.size != (W, H):
        pil = pil.resize((W, H))
    arr = (np.asarray(pil, dtype=np.float32) / 255.0) >= 0.5
    t = torch.from_numpy(arr.astype(np.float32)).to(device).unsqueeze(-1)
    return t


def _build_optimizer(param_groups: list[dict]) -> torch.optim.Adam:
    return torch.optim.Adam(param_groups)


def train(args) -> dict:
    """Run the photometric optimization described by ``args``.

    ``args`` may be an ``argparse.Namespace`` (as produced by ``main()``'s CLI
    parser) or any object exposing the same attributes (a dataclass works fine).
    Returns a result summary dict: ``primitive_count``, ``final_loss``,
    ``final_l1``, ``scene_scale_m``, ``train_seconds``.
    """

    from gsplat import rasterization

    train_start = time.monotonic()
    dev = "cuda"
    data = Path(args.data)
    cams, images, init_xyz, init_rgb = load_colmap(data)
    if args.image_shard_count < 1:
        raise ValueError("--image-shard-count must be >= 1")
    if not 0 <= args.image_shard_index < args.image_shard_count:
        raise ValueError("--image-shard-index must be in [0, image_shard_count)")
    if args.image_shard_count > 1:
        images = [
            im
            for i, im in enumerate(images)
            if i % args.image_shard_count == args.image_shard_index
        ]
        if not images:
            raise ValueError("image shard selected no images")
    print(f"[data] {len(images)} images, {len(init_xyz)} init points", flush=True)

    sh_degree = int(getattr(args, "sh_degree", 0) or 0)
    densify = bool(getattr(args, "densify", False))
    scale_reg_quantile = getattr(args, "scale_reg_quantile", None)
    mask_dir_arg = getattr(args, "mask_dir", None)
    mask_dir = Path(mask_dir_arg) if mask_dir_arg else None

    gt, viewmats, Ks, image_names = [], [], [], []
    for im in images:
        W, H, fx, fy, cx, cy = cams[im["cam"]]
        pil = Image.open(data / "images" / im["name"]).convert("RGB")
        if pil.size != (W, H):
            pil = pil.resize((W, H))
        gt.append(torch.from_numpy(np.asarray(pil, np.float32) / 255.0))
        viewmats.append(torch.from_numpy(im["w2c"].astype(np.float32)))
        Ks.append(
            torch.tensor([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=torch.float32)
        )
        image_names.append(im["name"])
    gt = torch.stack(gt).to(dev)
    viewmats = torch.stack(viewmats).to(dev)
    Ks = torch.stack(Ks).to(dev)
    W, H = cams[images[0]["cam"]][0], cams[images[0]["cam"]][1]
    C = len(images)

    masks = None
    if mask_dir is not None:
        masks = [_load_mask(mask_dir, name, W, H, dev) for name in image_names]

    cam_centers = (-viewmats[:, :3, :3].transpose(1, 2) @ viewmats[:, :3, 3:]).squeeze(
        -1
    )
    scene_scale = float((cam_centers - cam_centers.mean(0)).norm(dim=1).mean()) + 1e-3
    print(f"[data] {W}x{H}, scene_scale={scene_scale:.2f}m", flush=True)

    N = len(init_xyz)
    means = torch.nn.Parameter(torch.from_numpy(init_xyz).to(dev))
    log_scales = torch.nn.Parameter(
        torch.full((N, 3), float(np.log(args.init_scale)), device=dev)
    )
    quats = torch.nn.Parameter(
        torch.tensor([1.0, 0, 0, 0], device=dev).repeat(N, 1)
    )
    opacities = torch.nn.Parameter(torch.full((N,), _logit(0.5), device=dev))
    rgb0 = torch.from_numpy(init_rgb.astype(np.float32) / 255.0).clamp(1e-4, 1 - 1e-4)
    colors = torch.nn.Parameter(_logit_t(rgb0).to(dev))

    sh_rest = None
    sh_rest_coeffs = max(0, (sh_degree + 1) ** 2 - 1) if sh_degree > 0 else 0
    if sh_degree > 0:
        sh_rest = torch.nn.Parameter(
            torch.zeros((N, sh_rest_coeffs, 3), device=dev)
        )

    def _make_param_groups():
        groups = [
            {"params": [means], "lr": 1.6e-4 * scene_scale},
            {"params": [log_scales], "lr": 5e-3},
            {"params": [quats], "lr": 1e-3},
            {"params": [opacities], "lr": 5e-2},
            {"params": [colors], "lr": 2.5e-3},
        ]
        if sh_rest is not None:
            groups.append({"params": [sh_rest], "lr": 2.5e-3 / 20})
        return groups

    opt = _build_optimizer(_make_param_groups())
    window = _gauss_window(device=dev)
    checkpoint_dir = Path(args.checkpoint_dir) if args.checkpoint_dir else None
    if checkpoint_dir:
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

    densify_start, densify_end, densify_every = 500, int(args.steps * 0.8), 100
    grad_accum = torch.zeros(N, device=dev) if densify else None
    grad_accum_count = 0

    def _export(path: Path):
        export_splat(
            path,
            means.detach(),
            torch.exp(log_scales).detach(),
            F.normalize(quats, dim=-1).detach(),
            torch.sigmoid(opacities).detach(),
            torch.sigmoid(colors).detach(),
            scale_reg_quantile=scale_reg_quantile,
        )

    torch.manual_seed(0)
    loss_value = float("nan")
    l1_value = float("nan")
    for step in range(args.steps):
        idx = int(torch.randint(0, C, (1,)).item())
        colors_arg = torch.sigmoid(colors)
        rasterize_kwargs = dict(
            means=means,
            quats=F.normalize(quats, dim=-1),
            scales=torch.exp(log_scales),
            opacities=torch.sigmoid(opacities),
            viewmats=viewmats[idx : idx + 1],
            Ks=Ks[idx : idx + 1],
            width=W,
            height=H,
            render_mode="RGB",
            packed=False,
        )
        if sh_rest is not None:
            sh_coeffs = torch.cat([colors_arg.unsqueeze(1), sh_rest], dim=1)
            renders, _, _ = rasterization(
                colors=sh_coeffs, sh_degree=sh_degree, **rasterize_kwargs
            )
        else:
            renders, _, _ = rasterization(
                colors=colors_arg, sh_degree=None, **rasterize_kwargs
            )
        pred = renders[0].clamp(0, 1)
        target = gt[idx]
        if masks is not None and masks[idx] is not None:
            keep_mask = 1.0 - masks[idx]
            pred = pred * keep_mask
            target = target * keep_mask
        l1 = (pred - target).abs().mean()
        a = pred.permute(2, 0, 1).unsqueeze(0)
        b = target.permute(2, 0, 1).unsqueeze(0)
        loss = 0.8 * l1 + 0.2 * (1.0 - ssim(a, b, window))
        opt.zero_grad(set_to_none=True)
        loss.backward()
        if grad_accum is not None and means.grad is not None:
            grad_accum += means.grad.detach().norm(dim=-1)
            grad_accum_count += 1
        opt.step()
        loss_value = float(loss.item())
        l1_value = float(l1.item())
        if step % 500 == 0 or step == args.steps - 1:
            print(
                f"[step {step:5d}/{args.steps}] loss={loss_value:.4f} l1={l1_value:.4f}",
                flush=True,
            )
        if (
            densify
            and densify_start <= step <= densify_end
            and step % densify_every == 0
            and step > 0
            and grad_accum_count > 0
        ):
            means, log_scales, quats, opacities, colors, sh_rest, N = _densify_and_prune(
                means,
                log_scales,
                quats,
                opacities,
                colors,
                sh_rest,
                grad_accum / max(grad_accum_count, 1),
                dev=dev,
            )
            opt = _build_optimizer(_make_param_groups())
            grad_accum = torch.zeros(N, device=dev)
            grad_accum_count = 0
        if (
            checkpoint_dir
            and args.checkpoint_every > 0
            and step > 0
            and (step % args.checkpoint_every == 0 or step == args.steps - 1)
        ):
            _export(checkpoint_dir / f"scene_step_{step:05d}.splat")

    _export(Path(args.out))
    print(f"[done] wrote {args.out} ({N} gaussians)", flush=True)

    train_seconds = time.monotonic() - train_start
    return {
        "primitive_count": int(N),
        "final_loss": loss_value,
        "final_l1": l1_value,
        "scene_scale_m": scene_scale,
        "train_seconds": train_seconds,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="dataset")
    ap.add_argument("--out", default="scene.splat")
    ap.add_argument("--steps", type=int, default=5000)
    ap.add_argument("--init-scale", type=float, default=0.035)
    ap.add_argument("--checkpoint-dir", default=None)
    ap.add_argument("--checkpoint-every", type=int, default=0)
    ap.add_argument("--image-shard-index", type=int, default=0)
    ap.add_argument("--image-shard-count", type=int, default=1)
    ap.add_argument(
        "--sh-degree",
        type=int,
        default=0,
        help="Spherical-harmonics degree for per-Gaussian view-dependent color. "
        "0 (default) keeps RGB-only behavior byte-identical to the original "
        "trainer; the .splat export always bakes the DC term only.",
    )
    ap.add_argument(
        "--densify",
        action="store_true",
        default=False,
        help="Enable gradient-based clone/prune densification between step 500 "
        "and 80%% of --steps. Off by default (no behavior change).",
    )
    ap.add_argument(
        "--scale-reg-quantile",
        type=float,
        default=None,
        help="When set, clamp each axis's exported scale to its value at this "
        "quantile across kept Gaussians. Omitted by default (no clamping).",
    )
    ap.add_argument(
        "--mask-dir",
        default=None,
        help="Directory of same-basename masks; masked pixels are excluded from "
        "the photometric loss. Omitted by default (no masking).",
    )
    args = ap.parse_args()
    train(args)


def _logit(p):
    return float(np.log(p / (1 - p)))


def _logit_t(x):
    return torch.log(x / (1 - x))


def _densify_and_prune(
    means,
    log_scales,
    quats,
    opacities,
    colors,
    sh_rest,
    grad_norm,
    *,
    dev: str,
    clone_quantile: float = 0.95,
    prune_opacity: float = 0.005,
):
    """Clone high-gradient Gaussians and prune low-opacity ones.

    Rebuilds every parameter tensor (and, by the caller, the Adam optimizer)
    rather than mutating optimizer state in place -- gsplat/this trainer does
    not expose per-Gaussian optimizer-state surgery, so a fresh Adam instance
    after each pass is the simplest correct approach.
    """

    with torch.no_grad():
        opac = torch.sigmoid(opacities)
        keep = opac >= prune_opacity
        threshold = torch.quantile(grad_norm, clone_quantile)
        clone = (grad_norm >= threshold) & keep

        def _select(t):
            return t[keep]

        def _clone_selected(t):
            return t[keep][clone[keep]]

        new_means = torch.cat([_select(means), _clone_selected(means)], dim=0)
        new_log_scales = torch.cat([_select(log_scales), _clone_selected(log_scales)], dim=0)
        new_quats = torch.cat([_select(quats), _clone_selected(quats)], dim=0)
        new_opacities = torch.cat([_select(opacities), _clone_selected(opacities)], dim=0)
        new_colors = torch.cat([_select(colors), _clone_selected(colors)], dim=0)
        new_sh_rest = None
        if sh_rest is not None:
            new_sh_rest = torch.cat([_select(sh_rest), _clone_selected(sh_rest)], dim=0)

    means = torch.nn.Parameter(new_means.detach().clone())
    log_scales = torch.nn.Parameter(new_log_scales.detach().clone())
    quats = torch.nn.Parameter(new_quats.detach().clone())
    opacities = torch.nn.Parameter(new_opacities.detach().clone())
    colors = torch.nn.Parameter(new_colors.detach().clone())
    if new_sh_rest is not None:
        sh_rest = torch.nn.Parameter(new_sh_rest.detach().clone())
    N = means.shape[0]
    print(f"[densify] -> {N} gaussians", flush=True)
    return means, log_scales, quats, opacities, colors, sh_rest, N


def export_splat(
    path: Path,
    means,
    scales,
    quats,
    opac,
    colors,
    prune=0.03,
    *,
    scale_reg_quantile: float | None = None,
):
    """Write the project's 32-byte .splat layout (rotation as x,y,z,w bytes)."""
    keep = opac.cpu().numpy() >= prune
    means = means.cpu().numpy().astype(np.float32)[keep]
    scales = scales.cpu().numpy().astype(np.float32)[keep]
    quats = quats.cpu().numpy().astype(np.float32)[keep]
    opac = opac.cpu().numpy().astype(np.float32)[keep]
    colors = (colors.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)[keep]
    a = (opac * 255.0).clip(0, 255).astype(np.uint8)
    if scale_reg_quantile is not None and scales.shape[0] > 0:
        clamp = np.quantile(scales, scale_reg_quantile, axis=0)
        scales = np.clip(scales, None, clamp)
    N = means.shape[0]
    print(
        f"[export] {path} kept {N} / {keep.size} gaussians (opacity >= {prune})",
        flush=True,
    )
    buf = bytearray()
    for i in range(N):
        buf += struct.pack("<3f", *means[i])
        buf += struct.pack("<3f", *scales[i])
        buf += bytes((int(colors[i, 0]), int(colors[i, 1]), int(colors[i, 2]), int(a[i])))
        w, x, y, z = quats[i]
        buf += bytes(
            (
                int(np.clip(x * 128 + 128, 0, 255)),
                int(np.clip(y * 128 + 128, 0, 255)),
                int(np.clip(z * 128 + 128, 0, 255)),
                int(np.clip(w * 128 + 128, 0, 255)),
            )
        )
    path.write_bytes(bytes(buf))


if __name__ == "__main__":
    main()
