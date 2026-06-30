"""RunPod serverless handler: ``handler(job) -> dict`` (the WorkerOutput JSON).

Parses ``job["input"]`` into :class:`~runpod_worker.schema.WorkerInput`,
resolves and verifies the data bundle, runs the vendored gsplat trainer, writes
the ``.splat`` artifact, publishes it (inline or to R2), computes scale stats,
and returns a :class:`~runpod_worker.schema.WorkerOutput` dict. Always returns
a dict -- failures are caught and reported as ``status: "failed"`` rather than
raised, so a RunPod job never surfaces as an opaque worker crash.
"""

from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np

from . import io_r2
from .schema import SCHEMA_VERSION, WorkerInput

_QUALITY_PRESET_STEPS = {
    "preview": 300,
    "balanced": 3000,
    "research": 9000,
}

# Mirrors the 32-byte .splat record layout owned by packages/splat-io and
# packages/splat-codec: position 3xf32 | scale 3xf32 | rgba 4xu8 | rotation
# 4xu8. Kept as a local, dependency-free reader (numpy only) so this package
# does not need a path/install dependency on splat-io just to compute scale
# percentiles for WorkerOutput.metrics.
_SPLAT_RECORD_BYTES = 32
_SPLAT_DTYPE = np.dtype(
    [
        ("pos", "<f4", (3,)),
        ("scale", "<f4", (3,)),
        ("rgba", "u1", (4,)),
        ("rot", "u1", (4,)),
    ]
)


def _read_splat_scales(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    if len(raw) % _SPLAT_RECORD_BYTES != 0:
        raise ValueError(
            f"{path} size {len(raw)} is not a multiple of {_SPLAT_RECORD_BYTES}"
        )
    if len(raw) == 0:
        return np.zeros((0, 3), dtype=np.float32)
    rows = np.frombuffer(raw, dtype=_SPLAT_DTYPE)
    return np.array(rows["scale"], dtype=np.float32)


def _steps_for(worker_input: WorkerInput) -> int:
    if worker_input.train.steps:
        return int(worker_input.train.steps)
    return _QUALITY_PRESET_STEPS.get(worker_input.train.quality_preset, 3000)


def _train_args(
    worker_input: WorkerInput, data_dir: Path, out_path: Path
) -> argparse.Namespace:
    shard = worker_input.shard
    train_spec = worker_input.train
    return argparse.Namespace(
        data=str(data_dir),
        out=str(out_path),
        steps=_steps_for(worker_input),
        init_scale=float(train_spec.init_scale),
        checkpoint_dir=None,
        checkpoint_every=0,
        image_shard_index=0,
        image_shard_count=1,
        keyframe_start=int(shard.keyframe_start),
        keyframe_end=int(shard.keyframe_end),
        sh_degree=int(train_spec.sh_degree or 0),
        densify=bool(train_spec.densify or False),
        scale_reg_quantile=train_spec.scale_reg_quantile,
        mask_dir=train_spec.mask_dir,
    )


def _scale_stats(out_path: Path) -> dict[str, float]:
    scales = _read_splat_scales(out_path)
    if scales.size == 0:
        return {"p50": 0.0, "p90": 0.0, "p99": 0.0, "tailP99OverP50": 0.0}
    magnitudes = np.linalg.norm(scales, axis=1)
    p50 = float(np.percentile(magnitudes, 50))
    p90 = float(np.percentile(magnitudes, 90))
    p99 = float(np.percentile(magnitudes, 99))
    tail_ratio = float(p99 / p50) if p50 > 0 else 0.0
    return {"p50": p50, "p90": p90, "p99": p99, "tailP99OverP50": tail_ratio}


def _empty_output(schema_version: str) -> dict[str, Any]:
    return {
        "status": "failed",
        "schemaVersion": schema_version,
        "shard": {"index": 0, "count": 1, "submapId": ""},
        "artifact": {"mode": "return", "byteLength": 0, "sha256": ""},
        "metrics": {
            "primitiveCount": 0,
            "finalLoss": 0.0,
            "finalL1": 0.0,
            "sceneScaleM": 0.0,
            "scaleStats": {"p50": 0.0, "p90": 0.0, "p99": 0.0, "tailP99OverP50": 0.0},
            "trainSeconds": 0.0,
            "coldStartSeconds": 0.0,
        },
        "stage": {"current": "failed", "fraction": 0.0},
        "error": None,
    }


def handler(job: dict[str, Any]) -> dict[str, Any]:
    cold_start = time.monotonic()
    raw_input = job.get("input", {})
    output = _empty_output(raw_input.get("schemaVersion", SCHEMA_VERSION))

    try:
        worker_input = WorkerInput.from_dict(raw_input)
        output["shard"] = {
            "index": worker_input.shard.index,
            "count": worker_input.shard.count,
            "submapId": worker_input.submap_id,
        }

        with tempfile.TemporaryDirectory(prefix="runpod-worker-") as tmp:
            tmp_dir = Path(tmp)
            bundle_dict = {
                "mode": worker_input.bundle.mode,
                "volumePath": worker_input.bundle.volume_path,
                "uri": worker_input.bundle.uri,
                "sha256": worker_input.bundle.sha256,
            }
            data_dir = io_r2.fetch_bundle(bundle_dict, tmp_dir / "bundle")

            cold_start_seconds = time.monotonic() - cold_start
            out_path = tmp_dir / "scene.splat"
            train_args = _train_args(worker_input, data_dir, out_path)
            from . import trainer

            result = trainer.train(train_args)

            scale_stats = _scale_stats(out_path)

            output_spec = {
                "mode": worker_input.output.mode,
                "prefixUri": worker_input.output.prefix_uri,
            }
            artifact = io_r2.upload_artifact(out_path, output_spec)

            output["status"] = "completed"
            output["schemaVersion"] = worker_input.schema_version or SCHEMA_VERSION
            output["artifact"] = artifact
            output["metrics"] = {
                "primitiveCount": result["primitive_count"],
                "finalLoss": result["final_loss"],
                "finalL1": result["final_l1"],
                "sceneScaleM": result["scene_scale_m"],
                "scaleStats": scale_stats,
                "trainSeconds": result["train_seconds"],
                "coldStartSeconds": cold_start_seconds,
            }
            output["stage"] = {"current": "completed", "fraction": 1.0}
            output["error"] = None
            return output
    except Exception as exc:  # noqa: BLE001 - worker must always return, never raise
        output["status"] = "failed"
        output["error"] = str(exc)
        output["stage"] = {"current": "failed", "fraction": output["stage"].get("fraction", 0.0)}
        return output


if __name__ == "__main__":
    import runpod

    # NOTE: verify the exact progress-reporting helper name against the
    # installed `runpod` SDK version (e.g. something under
    # `runpod.serverless.modules`) before wiring live progress updates -- the
    # API has moved across SDK releases. Not required for handler correctness.
    runpod.serverless.start({"handler": handler})
