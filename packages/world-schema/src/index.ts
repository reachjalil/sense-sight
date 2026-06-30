/**
 * @sense-sight/world-schema — framework-agnostic, dependency-free TypeScript
 * contracts for robot spatial world models: geometry primitives, pose,
 * sensor streams, reconstructed world models, and the realtime
 * world-generation pipeline interface.
 *
 * Coordinate convention: right-handed, +Y up, meters, scalar-last
 * quaternions.
 */

// --- Geometry, pose, sensors ---
export type {
  Bounds,
  Footprint,
  Pose,
  PoseSource,
  Quaternion,
  SensorStatus,
  SensorStream,
  SensorType,
  Vec3,
} from "./geometry";

// --- World model ---
export type {
  ReconstructionStatus,
  SemanticLayer,
  SemanticLayerKind,
  SpatialZone,
  SpatialZoneKind,
  WorldModel,
} from "./world-model";

// --- Realtime world-generation pipeline ---
export { WORLD_PIPELINE_STAGES } from "./pipeline";
export type {
  RealtimeWorldSkill,
  SensorFrame,
  SpatialQuery,
  SpatialQueryMatch,
  WorldPipelineStage,
  WorldReconstructionConfig,
  WorldReconstructionProgress,
  WorldReconstructionResult,
} from "./pipeline";
