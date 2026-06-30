from __future__ import annotations

from runpod_worker.handler import _train_args
from runpod_worker.schema import WorkerInput


def test_train_args_use_contiguous_keyframe_window(tmp_path):
    worker_input = WorkerInput.from_dict(
        {
            "jobType": "refine_splat_shard",
            "schemaVersion": "1.0.0",
            "worldId": "world",
            "sequence": "sequence",
            "submapId": "submap",
            "bundle": {
                "mode": "volume",
                "volumePath": "/data/bundle",
                "sha256": "abc",
            },
            "shard": {
                "index": 2,
                "count": 35,
                "strategy": "contiguous_overlap",
                "keyframeStart": 45,
                "keyframeEnd": 80,
                "overlapKeyframes": 5,
            },
            "train": {
                "steps": 300,
                "initScale": 0.035,
                "prune": 0.03,
                "qualityPreset": "preview",
                "seedPointLimit": 80000,
            },
            "output": {"mode": "return"},
            "provenance": {"imageTag": "dev"},
        }
    )

    args = _train_args(worker_input, tmp_path / "data", tmp_path / "scene.splat")

    assert args.keyframe_start == 45
    assert args.keyframe_end == 80
    assert args.image_shard_index == 0
    assert args.image_shard_count == 1
