/**
 * Design-level contracts for the realtime world-generation pipeline: the
 * algorithm layer that turns synchronized robot sensor streams into a
 * navigable Gaussian-splat (or point-cloud) world model plus queryable
 * spatial memory.
 *
 * These interfaces are intentionally implementation-free. They pin down the
 * inputs, stages, configuration, and outputs so the pipeline can be built as
 * a Python/CUDA service, a WASM module, or a hosted API without changing any
 * consumer of this package.
 */

import type { Pose, SensorType } from "./geometry";
import type { WorldModel } from "./world-model";

/** Ordered pipeline stages a reconstruction run passes through. */
export const WORLD_PIPELINE_STAGES = [
  "ingest",
  "synchronize",
  "pose_estimation",
  "dynamic_masking",
  "reconstruction",
  "semantic_tagging",
  "optimization",
  "export",
] as const;
export type WorldPipelineStage = (typeof WORLD_PIPELINE_STAGES)[number];

/** A time-synchronized bundle of sensor payloads for one keyframe. */
export interface SensorFrame {
  readonly frameIndex: number;
  /** ISO-8601 capture time after synchronization. */
  readonly timestamp: string;
  /** Per-modality opaque payload handles, decoded by the implementation. */
  readonly payloads: Partial<Record<SensorType, ArrayBufferLike | string>>;
  /** Best-known pose prior at capture, refined during pose_estimation. */
  readonly posePrior?: Pose;
}

/** Tunables for a reconstruction run. */
export interface WorldReconstructionConfig {
  /** Primary photometric backend. */
  readonly backend: "colmap_3dgs" | "vggt_3dgs" | "gaussian_surfels";
  /** Mask moving people/objects for a clean static map. */
  readonly maskDynamicObjects: boolean;
  /** Fuse LiDAR to seed/clamp geometry where photometric cues are weak. */
  readonly useLidarDepthFusion: boolean;
  /** Target Gaussian/point budget (compression vs. fidelity). */
  readonly maxPrimitives?: number;
  /** Voxel size (meters) for incremental update bucketing. */
  readonly updateVoxelM?: number;
  /** Produce semantic layers (floor, walls, doors, hazards, …). */
  readonly semanticLayers: boolean;
}

/** Progress callback payload emitted as the pipeline advances. */
export interface WorldReconstructionProgress {
  readonly stage: WorldPipelineStage;
  /** 0..1 within the current stage. */
  readonly fraction: number;
  readonly message?: string;
}

/** Result of a (full or incremental) reconstruction run. */
export interface WorldReconstructionResult {
  readonly worldModel: WorldModel;
  /** Frames that contributed, for provenance/audit. */
  readonly contributingFrames: readonly number[];
  readonly elapsedMs: number;
}

/** A spatial-memory query a consumer can run against a built world model. */
export interface SpatialQuery {
  readonly kind: "nearest_points" | "free_space" | "label_lookup";
  /** Query origin in world meters. */
  readonly point: readonly [number, number, number];
  readonly radiusM?: number;
  readonly labelFilter?: string;
}

/** A single hit returned from a {@link SpatialQuery}. */
export interface SpatialQueryMatch {
  readonly label: string;
  readonly point: readonly [number, number, number];
  /** 0..1 confidence or relevance score. */
  readonly score?: number;
}

/**
 * The pipeline surface. An implementation may run remotely; consumers treat
 * it as an async service that emits progress and returns navigable world
 * models without caring where the reconstruction actually happens.
 */
export interface RealtimeWorldSkill {
  /** Build a world model from scratch over a set of frames. */
  reconstruct(
    frames: readonly SensorFrame[],
    config: WorldReconstructionConfig,
    onProgress?: (progress: WorldReconstructionProgress) => void
  ): Promise<WorldReconstructionResult>;
  /** Fold new frames into an existing map without a full rebuild. */
  update(
    baseModelId: string,
    frames: readonly SensorFrame[],
    onProgress?: (progress: WorldReconstructionProgress) => void
  ): Promise<WorldReconstructionResult>;
  /** Query the spatial memory of a built map. */
  query(
    modelId: string,
    query: SpatialQuery
  ): Promise<readonly SpatialQueryMatch[]>;
  /** Export a built map to a portable asset URI. */
  export(modelId: string, format: "splat" | "ksplat" | "ply"): Promise<string>;
}
