# runpod-worker

RunPod serverless handler for Gaussian-splat training/refinement. Vendors the
gsplat trainer (`vendored/train_splat.py`) so the worker image is
self-contained and tracked in git.

Unlike [`packages/robot-world`](../robot-world) (provider-neutral
reconstruction input prep), this package is intentionally **RunPod-specific**:
it calls the RunPod serverless SDK directly and is built into a CUDA Docker
image RunPod runs as a GPU worker.

## Job contract

The handler reads `job["input"]` as a `WorkerInput` and returns a
`WorkerOutput` dict (see `src/runpod_worker/schema.py` for the dataclasses;
this is the Python mirror of the TypeScript orchestrator's job-types contract
— keep both in lockstep at the JSON level).

```jsonc
// WorkerInput (job.input)
{
  "jobType": "refine_splat_shard" | "quality_submap" | "full_pass" | "online_update",
  "schemaVersion": "1.0.0",
  "worldId": "openloris-corridor1-2",
  "sequence": "corridor1-2",
  "submapId": "corridor1-2-0480-0839",
  "bundle": { "mode": "volume" | "r2", "volumePath": "...", "uri": "...", "sha256": "sha256:..." },
  "shard": { "index": 0, "count": 4, "strategy": "contiguous_overlap", "keyframeStart": 0, "keyframeEnd": 45, "overlapKeyframes": 8 },
  "train": { "steps": 300, "initScale": 0.035, "prune": 0.03, "qualityPreset": "preview", "seedPointLimit": 80000,
             "shDegree": 0, "densify": false, "scaleRegQuantile": null, "maskDir": null },
  "output": { "mode": "return" | "r2", "prefixUri": "s3://..." },
  "provenance": { "imageTag": "...", "poseGraphVersion": "...", "calibrationVersion": "...", "dynamicMaskVersion": "..." }
}
```

The top-level `job` object also carries an optional `"webhook": string`.

```jsonc
// WorkerOutput (the job result)
{
  "status": "completed" | "failed",
  "schemaVersion": "1.0.0",
  "shard": { "index": 0, "count": 4, "submapId": "..." },
  "artifact": { "mode": "return" | "r2", "splatBase64": "...", "splatUri": "...", "byteLength": 0, "sha256": "..." },
  "metrics": {
    "primitiveCount": 0, "finalLoss": 0, "finalL1": 0, "validationLoss": 0,
    "sceneScaleM": 0, "scaleStats": { "p50": 0, "p90": 0, "p99": 0, "tailP99OverP50": 0 },
    "trainSeconds": 0, "coldStartSeconds": 0
  },
  "stage": { "current": "completed", "fraction": 1.0, "message": "..." },
  "error": null
}
```

`schema.py`'s `_camel`/`_from_json`/`_to_json` helpers map every dataclass
field generically between Python snake_case and wire-format camelCase, so the
field list above is the single source of truth — there is no separate manual
mapping to keep in sync per field.

## Byte-format contract

The trained `.splat` artifact uses the same 32-byte-per-Gaussian layout as
[`packages/splat-io`](../splat-io) (Python reader/writer) and
[`packages/splat-codec`](../splat-codec) (TypeScript codec):

```
position 3x float32 (12B) | scale 3x float32 (12B) | color RGBA 4x uint8 (4B) | rotation quat (x,y,z,w) 4x uint8 (4B)
```

This package does **not** depend on `splat-io` at runtime. The Docker build
(see `Dockerfile`) only copies this package's own directory — not its
siblings — so `vendored/train_splat.py`'s `export_splat()` packs these bytes
directly via `struct.pack`, and `src/runpod_worker/handler.py` re-reads them
with a small local `numpy`-only struct dtype (`_SPLAT_DTYPE`) to compute
`metrics.scaleStats`. Both are intentionally self-contained duplicates of the
same byte layout rather than an import dependency, so this package's Docker
build context never needs to reach outside `packages/runpod-worker/`.

**If the 32-byte layout ever changes, it must change in all three places**:
`packages/splat-io/src/splat_io/splat.py`,
`packages/splat-codec/src/index.ts`, and this package's
`vendored/train_splat.py` (`export_splat`) + `src/runpod_worker/handler.py`
(`_SPLAT_DTYPE`).

## Build

```bash
docker build -t runpod-worker:dev -f packages/runpod-worker/Dockerfile packages/runpod-worker
```

`warmup.py` runs as a build-time `RUN` step so the gsplat CUDA extension JIT
compiles into the image layer, not the first request.

## Run the handler locally (debugging)

```bash
cd packages/runpod-worker
python3 -c '
from runpod_worker.handler import handler
print(handler({"input": {...}}))
'
```

`trainer.py` resolves `vendored/train_splat.py` by adding the package root to
`sys.path` (it lives alongside `src/`, not nested under the
`runpod_worker` package), so no extra `PYTHONPATH` is needed when running from
`packages/runpod-worker/`.

## Test

```bash
cd packages/runpod-worker
python3 -m pytest tests/ -v
```

GPU-dependent assertions are guarded with `pytest.importorskip("torch")` /
`pytest.importorskip("gsplat")`, so the suite skips (not fails) without those
installed.

## Install

```bash
pip install -e ".[test]"
```
