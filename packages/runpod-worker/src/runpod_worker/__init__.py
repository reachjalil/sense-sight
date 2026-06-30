"""runpod-worker — RunPod serverless GPU worker for Gaussian splat training.

Wraps the vendored gsplat trainer (``vendored/train_splat.py``) behind a RunPod
``handler(job) -> dict`` that speaks the WorkerInput/WorkerOutput JSON contract
shared with the TypeScript orchestrator side of SenseSight.
"""

from __future__ import annotations

__version__ = "0.1.0"
