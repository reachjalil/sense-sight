/**
 * @sense-sight/runpod-orchestrator — framework-agnostic RunPod job
 * orchestration for Gaussian-splat reconstruction: a typed REST client,
 * contiguous-overlap shard planning, a job state machine, and splat-shard
 * merge/publish logic. See README.md for the WorkerInput/WorkerOutput JSON
 * schema this package's job-types.ts mirrors.
 */

// --- Job contract types ---
export type {
  BundleMode,
  JobRecord,
  JobStatus,
  JobType,
  OutputMode,
  QualityPreset,
  RunPodJobEnvelope,
  RunPodSplatJob,
  ShardStrategy,
  WorkerInput,
  WorkerInputBundle,
  WorkerInputOutput,
  WorkerInputProvenance,
  WorkerInputShard,
  WorkerInputTrain,
  WorkerOutput,
  WorkerOutputArtifact,
  WorkerOutputMetrics,
  WorkerOutputScaleStats,
  WorkerOutputShard,
  WorkerOutputStage,
  WorkerOutputStatus,
} from "./job-types";

// --- RunPod REST client ---
export { RunPodClient } from "./runpod-client";
export type {
  RunPodClientOptions,
  RunPodEndpointHealth,
  RunPodExecutionPolicy,
  RunPodJobStatus,
  RunPodJobStatusResponse,
  RunPodRunOptions,
} from "./runpod-client";

// --- Shard planning ---
export { planShards } from "./shard-planner";
export type { PlannedShard } from "./shard-planner";

// --- Job state machine ---
export {
  isValidTransition,
  jobStatusToReconstructionStatus,
  jobStatusToStage,
} from "./state-machine";

// --- Shard merge ---
export { mergeSplatShards } from "./merge";
export type { MergeSplatShardsOptions } from "./merge";

// --- Publish manifests ---
export { buildPresetManifest } from "./publish";
export type { MergedSplatResult, PresetManifest } from "./publish";
