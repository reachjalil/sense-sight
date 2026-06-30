# @sense-sight/runpod-orchestrator

Framework-agnostic RunPod job orchestration for Gaussian-splat reconstruction:
a typed REST client, contiguous-overlap shard planning, a job state machine,
and lossless multi-shard splat merge/publish logic.

This package has no RunPod SDK or MCP dependency — `RunPodClient` is a plain
`fetch`-based client constructed with an API key, so it runs the same inside a
Worker, a server process, or a CLI. It depends on `@sense-sight/splat-codec`
(byte-level `.splat` encode/decode) and `@sense-sight/world-schema`
(`WorldModel`/`WorldPipelineStage`) via `workspace:*`.

## Job lifecycle

```
bundling -> submitted -> training -> merging -> published
(any status) -> failed
```

- **bundling** — the orchestrator is assembling the input bundle (COLMAP/3DGS
  training inputs) for a shard.
- **submitted** — the job has been handed to a RunPod endpoint
  (`RunPodClient.runEndpoint` / `runSyncEndpoint`).
- **training** — the worker is actively training/refining the shard.
- **merging** — all shards for a submap/world have completed and are being
  combined (`mergeSplatShards`).
- **published** — the merged result has been written out
  (`buildPresetManifest`'s `world.json` / `training.json` /
  `training_diagnostics.json`).
- **failed** — terminal failure state, reachable from any non-terminal status.

`isValidTransition(from, to)` in `src/state-machine.ts` encodes this graph and
is the only place that should decide whether a status change is legal.

**Invariant:** a failed job must never overwrite a `"ready"` world. This
package's state machine only validates the job-status transition graph (e.g.
`isValidTransition(currentStatus, "failed")` returning `true`); it is
world-model-agnostic and pure, so it cannot and does not inspect a stored
`WorldModel`. The caller that applies a `JobStatus` to a persisted
`WorldModel` is responsible for separately checking that the target world's
`reconstructionStatus` is not already `"ready"` before persisting a failure.

`jobStatusToReconstructionStatus` and `jobStatusToStage` map a `JobStatus`
onto `WorldModel["reconstructionStatus"]` and `WorldPipelineStage`
respectively, for surfacing job progress on a world record without the caller
re-deriving the mapping.

## WorkerInput / WorkerOutput contract

This is the JSON wire shape shared between this package's `src/job-types.ts`
and the RunPod serverless worker (`@sense-sight/runpod-worker`, the sibling
Python package). Both sides must match this exactly — it is a JSON
boundary, not an internal type either side can drift independently. If either
side changes, update this section, `src/job-types.ts`, and the Python
worker's handler together.

### `WorkerInput` (the RunPod job `input` object)

```json
{
  "jobType": "refine_splat_shard" | "quality_submap" | "full_pass" | "online_update",
  "schemaVersion": "1.0.0",
  "worldId": "string",
  "sequence": "string",
  "submapId": "string",
  "bundle": { "mode": "volume" | "r2", "volumePath": "string?", "uri": "string?", "sha256": "string" },
  "shard": { "index": 0, "count": 4, "strategy": "contiguous_overlap" | "modulo", "keyframeStart": 0, "keyframeEnd": 30, "overlapKeyframes": 5 },
  "train": { "steps": 7000, "initScale": 0.01, "prune": 0.005, "qualityPreset": "preview" | "balanced" | "research", "seedPointLimit": 80000, "shDegree": 3, "densify": true, "scaleRegQuantile": 0.99, "maskDir": "string?" },
  "output": { "mode": "return" | "r2", "prefixUri": "string?" },
  "provenance": { "imageTag": "string", "poseGraphVersion": "string?", "calibrationVersion": "string?", "dynamicMaskVersion": "string?" }
}
```

The top-level RunPod job also carries an optional `"webhook": string` field —
RunPod's own envelope field, a sibling of `"input"`, not part of
`WorkerInput` itself (`RunPodJobEnvelope` in `src/job-types.ts`).

### `WorkerOutput` (the handler's return value / job result)

```json
{
  "status": "completed" | "failed",
  "schemaVersion": "1.0.0",
  "shard": { "index": 0, "count": 4, "submapId": "string" },
  "artifact": { "mode": "return" | "r2", "splatBase64": "string?", "splatUri": "string?", "byteLength": 0, "sha256": "string" },
  "metrics": {
    "primitiveCount": 0,
    "finalLoss": 0,
    "finalL1": 0,
    "validationLoss": 0,
    "sceneScaleM": 0,
    "scaleStats": { "p50": 0, "p90": 0, "p99": 0, "tailP99OverP50": 0 },
    "trainSeconds": 0,
    "coldStartSeconds": 0
  },
  "stage": { "current": "string", "fraction": 0, "message": "string?" },
  "error": "string | null"
}
```

`schemaVersion` is currently always the literal `"1.0.0"` on both sides; bump
it (and document the change here) only when the wire shape changes
incompatibly.

## Shard planning correctness

`planShards(totalKeyframes, shardCount, overlapKeyframes)` splits
`[0, totalKeyframes)` into `shardCount` **contiguous** windows — every
shard's keyframe range is a single unbroken run, never an interleaved/modulo
selection (`i, i + shardCount, i + 2 * shardCount, ...`). This matters for
3DGS training: contiguous keyframes stay photometrically co-visible, which a
modulo split would break.

- Window sizes are as even as possible: `floor(total / shardCount)`, with the
  remainder distributed one-per-shard starting from shard 0.
- Internal borders (between adjacent shards) are extended by
  `overlapKeyframes` on both sides, so neighboring shards share a training
  overlap region that `mergeSplatShards` later dedups.
- The sequence ends are always clamped to `[0, totalKeyframes)` — the first
  shard never starts below `0` and the last shard never ends past
  `totalKeyframes`, even if `overlapKeyframes` is large relative to the
  sequence.

## Merge correctness

`mergeSplatShards(shardBuffers, { voxelSizeM })`:

1. Decodes every shard via `@sense-sight/splat-codec`'s `decodeSplat` and
   asserts each buffer's byte length is a multiple of `SPLAT_RECORD_BYTES`
   before touching it.
2. Concatenates every shard's Gaussians into one set.
3. Voxel-dedups overlap geometry: buckets each Gaussian by
   `floor(position / voxelSizeM)` per axis, and within a bucket keeps **one**
   merged Gaussian:
   - position / color / alpha — opacity-weighted mean (falls back to a plain
     arithmetic mean for an all-zero-opacity bucket, so a fully transparent
     cluster does not collapse to the origin).
   - scale — the **per-axis max** across the bucket's members. This
     preserves anisotropy; it never collapses a bucket's scale to one
     isotropic scalar.
   - rotation — taken from the bucket's highest-opacity member.
4. Re-encodes via `encodeSplat` with full per-point `scales`, `rotations`,
   and `alphas` — the merged output keeps real anisotropic scale and real
   alpha per Gaussian, not the lossy isotropic/opaque-only encoding path.

The result is always smaller than or equal to a naive concatenation of the
input shards' Gaussian counts, strictly smaller whenever any overlap region
actually shares a voxel across shards.

## Publish manifests

`buildPresetManifest(merged, worldId)` is pure data — no file I/O — producing
the `world.json` / `training.json` / `training_diagnostics.json` content a
caller writes into a published world's asset directory. It applies two
quality gates directly from `WorkerOutputMetrics`:

- `validationLossOk = metrics.validationLoss <= 0.08` (`null` when
  `validationLoss` was not reported).
- `scaleTailOk = metrics.scaleStats.tailP99OverP50 <= 4.5`.

The remaining gates in `training_diagnostics.json` (`regularizedScaleOk`,
`viewerScaleOk`, `regularizedFilterOk`, `viewerFilterOk`, `sensorFusionOk`,
`interactiveAssetOk`) require information this package does not have
visibility into (regularization config, viewer-side budgets, cross-sensor
fusion residuals, a live viewer load check) and are left `null` for the
caller to fill in.

## Exports

- **Job contract types** — `JobType`, `QualityPreset`, `ShardStrategy`,
  `BundleMode`, `OutputMode`, `WorkerInput` (and its nested
  `WorkerInputBundle`/`WorkerInputShard`/`WorkerInputTrain`/
  `WorkerInputOutput`/`WorkerInputProvenance`), `RunPodJobEnvelope`,
  `WorkerOutput` (and its nested `WorkerOutputShard`/`WorkerOutputArtifact`/
  `WorkerOutputMetrics`/`WorkerOutputScaleStats`/`WorkerOutputStage`/
  `WorkerOutputStatus`), `JobStatus`, `RunPodSplatJob`, `JobRecord`.
- **`RunPodClient`** — `runEndpoint`, `runSyncEndpoint`, `getJobStatus`,
  `cancelJob`, `retryJob`, `streamJob` (async generator polling to a terminal
  status), `endpointHealth`. Plus `RunPodClientOptions`,
  `RunPodJobStatus`, `RunPodJobStatusResponse`, `RunPodExecutionPolicy`,
  `RunPodRunOptions`, `RunPodEndpointHealth`.
- **`planShards`** / `PlannedShard` — contiguous-overlap shard planning.
- **`isValidTransition`**, **`jobStatusToReconstructionStatus`**,
  **`jobStatusToStage`** — the job state machine.
- **`mergeSplatShards`** / `MergeSplatShardsOptions` — multi-shard splat
  merge.
- **`buildPresetManifest`** / `MergedSplatResult` / `PresetManifest` — publish
  manifest construction.

## Out of scope

- Persisting `JobRecord` rows — this package only shapes the type; storage
  (D1, Postgres, etc.) belongs to the calling service.
- Bundling COLMAP/3DGS training inputs into a `bundle.uri`/`volumePath` — this
  package consumes a bundle reference, it does not build one.
- Writing `buildPresetManifest`'s output to disk or object storage — the
  caller decides the destination.
