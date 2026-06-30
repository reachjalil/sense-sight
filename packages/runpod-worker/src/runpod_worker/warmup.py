"""Docker build-time CUDA JIT warmup for gsplat.

Builds a tiny synthetic single-Gaussian scene and calls ``gsplat.rasterization``
once so the CUDA extension's JIT compile happens during the image build, not on
the first real job. Intended to run as a Dockerfile ``RUN`` step:

    RUN python -m runpod_worker.warmup

Must never raise when CUDA is unavailable (e.g. a CI smoke-build on a
GPU-less runner) -- it prints a message and exits 0 in that case.
"""

from __future__ import annotations

import sys


def main() -> int:
    import torch

    if not torch.cuda.is_available():
        print("[warmup] CUDA not available; skipping gsplat JIT warmup.", flush=True)
        return 0

    import torch.nn.functional as F
    from gsplat import rasterization

    dev = "cuda"
    means = torch.zeros((1, 3), device=dev)
    quats = torch.tensor([[1.0, 0.0, 0.0, 0.0]], device=dev)
    scales = torch.full((1, 3), 0.05, device=dev)
    opacities = torch.full((1,), 0.5, device=dev)
    colors = torch.full((1, 3), 0.5, device=dev)
    viewmat = torch.eye(4, device=dev).unsqueeze(0)
    viewmat[0, 2, 3] = 3.0
    K = torch.tensor([[[100.0, 0.0, 32.0], [0.0, 100.0, 32.0], [0.0, 0.0, 1.0]]], device=dev)

    rasterization(
        means=means,
        quats=F.normalize(quats, dim=-1),
        scales=scales,
        opacities=opacities,
        colors=colors,
        viewmats=viewmat,
        Ks=K,
        width=64,
        height=64,
        sh_degree=None,
        render_mode="RGB",
        packed=False,
    )
    print("[warmup] gsplat CUDA JIT compile complete.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
