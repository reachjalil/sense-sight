/**
 * TypeScript mirror of the WorkerInput/WorkerOutput JSON contract documented
 * in README.md. Field names are camelCase and match the JSON wire shape
 * exactly because these types cross a JSON boundary (RunPod job input/output)
 * shared with the Python worker (`@sense-sight/runpod-worker`) — do not
 * rename fields independently here.
 */

export type JobType =
  | "refine_splat_shard"
  | "quality_submap"
  | "full_pass"
  | "online_update";

export type QualityPreset = "preview" | "balanced" | "research";

export type ShardStrategy = "contiguous_overlap" | "modulo";

export type BundleMode = "volume" | "r2";

export type OutputMode = "return" | "r2";

export interface WorkerInputBundle {
  readonly mode: BundleMode;
  readonly volumePath?: string;
  readonly uri?: string;
  readonly sha256: string;
}

export interface WorkerInputShard {
  readonly index: number;
  readonly count: number;
  readonly strategy: ShardStrategy;
  readonly keyframeStart: number;
  readonly keyframeEnd: number;
  readonly overlapKeyframes: number;
}

export interface WorkerInputTrain {
  readonly steps: number;
  readonly initScale: number;
  readonly prune: number;
  readonly qualityPreset: QualityPreset;
  readonly seedPointLimit: number;
  readonly shDegree?: number;
  readonly densify?: boolean;
  readonly scaleRegQuantile?: number;
  readonly maskDir?: string;
}

export interface WorkerInputOutput {
  readonly mode: OutputMode;
  readonly prefixUri?: string;
}

export interface WorkerInputProvenance {
  readonly imageTag: string;
  readonly poseGraphVersion?: string;
  readonly calibrationVersion?: string;
  readonly dynamicMaskVersion?: string;
}

/** The RunPod job "input" object. */
export interface WorkerInput {
  readonly jobType: JobType;
  readonly schemaVersion: "1.0.0";
  readonly worldId: string;
  readonly sequence: string;
  readonly submapId: string;
  readonly bundle: WorkerInputBundle;
  readonly shard: WorkerInputShard;
  readonly train: WorkerInputTrain;
  readonly output: WorkerInputOutput;
  readonly provenance: WorkerInputProvenance;
}

/** RunPod's own top-level job field, sibling to (not inside) "input". */
export interface RunPodJobEnvelope {
  readonly input: WorkerInput;
  readonly webhook?: string;
}

export type WorkerOutputStatus = "completed" | "failed";

export interface WorkerOutputShard {
  readonly index: number;
  readonly count: number;
  readonly submapId: string;
}

export interface WorkerOutputArtifact {
  readonly mode: OutputMode;
  readonly splatBase64?: string;
  readonly splatUri?: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface WorkerOutputScaleStats {
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly tailP99OverP50: number;
}

export interface WorkerOutputMetrics {
  readonly primitiveCount: number;
  readonly finalLoss: number;
  readonly finalL1: number;
  readonly validationLoss?: number;
  readonly sceneScaleM: number;
  readonly scaleStats: WorkerOutputScaleStats;
  readonly trainSeconds: number;
  readonly coldStartSeconds: number;
}

export interface WorkerOutputStage {
  readonly current: string;
  readonly fraction: number;
  readonly message?: string;
}

/** The handler's return value / RunPod job result. */
export interface WorkerOutput {
  readonly status: WorkerOutputStatus;
  readonly schemaVersion: "1.0.0";
  readonly shard: WorkerOutputShard;
  readonly artifact: WorkerOutputArtifact;
  readonly metrics: WorkerOutputMetrics;
  readonly stage: WorkerOutputStage;
  readonly error: string | null;
}

/**
 * Orchestrator-local job lifecycle, distinct from RunPod's own
 * IN_QUEUE/IN_PROGRESS/COMPLETED/FAILED/CANCELLED/TIMED_OUT statuses (see
 * RunPodJobStatusResponse in runpod-client.ts). This is the status this
 * package's state machine and job records track end-to-end, from bundling
 * the input payload through publishing the merged result.
 */
export type JobStatus =
  | "bundling"
  | "submitted"
  | "training"
  | "merging"
  | "published"
  | "failed";

export interface RunPodSplatJob {
  readonly id: string;
  readonly worldId: string;
  readonly submapId: string;
  readonly status: JobStatus;
  readonly runpodJobId?: string;
  readonly jobType: JobType;
  readonly sequence: string;
  readonly shardIndex: number;
  readonly shardCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}

/**
 * Mirrors a future D1 row shape for persisted job tracking. Nullable columns
 * are modeled as `| null` (not optional) to match SQLite row semantics where
 * the column exists but is unset.
 */
export interface JobRecord {
  readonly id: string;
  readonly worldId: string;
  readonly submapId: string;
  readonly sequence: string;
  readonly jobType: JobType;
  readonly tier: QualityPreset;
  readonly status: JobStatus;
  readonly reconStatus: string;
  readonly shardIndex: number;
  readonly shardCount: number;
  readonly runpodEndpoint: string;
  readonly runpodJobId: string | null;
  readonly bundleUri: string | null;
  readonly bundleSha256: string | null;
  readonly baseWorldVersion: string | null;
  readonly splatUri: string | null;
  readonly primitiveCount: number | null;
  readonly validationLoss: number | null;
  readonly scaleTail: number | null;
  readonly trainSeconds: number | null;
  readonly imageTag: string | null;
  readonly gatesJson: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
