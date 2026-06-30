# GPU base: PyTorch's official CUDA 12.1 devel image. "devel" (not "runtime")
# is required because gsplat JIT-compiles a CUDA extension on first use via
# nvcc, which the runtime-only image does not ship.
FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-devel

WORKDIR /workspace

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY pyproject.toml README.md ./
COPY vendored/ ./vendored/
COPY src/ ./src/

RUN pip install --no-input -e .

# Force gsplat's CUDA extension JIT compile at build time, not on the first
# real job. Must not fail when this build runs on a GPU-less CI runner.
RUN python -m runpod_worker.warmup

CMD ["python", "-m", "runpod_worker.handler"]
