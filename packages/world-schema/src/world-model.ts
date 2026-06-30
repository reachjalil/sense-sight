import type { Bounds, Footprint, Vec3 } from "./geometry";

/** Lifecycle of a reconstructed scene. */
export type ReconstructionStatus =
  | "queued"
  | "reconstructing"
  | "ready"
  | "stale"
  | "failed";

/** A toggleable semantic overlay derived from the reconstruction. */
export type SemanticLayerKind =
  | "floor"
  | "walls"
  | "doors"
  | "furniture"
  | "people"
  | "navigable"
  | "hazards"
  | "labels";

export interface SemanticLayer {
  readonly id: string;
  readonly kind: SemanticLayerKind;
  readonly label: string;
  readonly visibleByDefault: boolean;
  /** Count of primitives/instances in this layer, if known. */
  readonly count?: number;
}

/**
 * The reconstructed, navigable representation of a place. `splatUri` and
 * `pointCloudUri` are the swap-in points for real Gaussian-splat / point
 * cloud assets; a viewer renders a procedural placeholder when both are
 * absent so UI work never blocks on real reconstruction output.
 */
export interface WorldModel {
  readonly id: string;
  readonly sceneName: string;
  readonly reconstructionStatus: ReconstructionStatus;
  readonly bounds: Bounds;
  readonly semanticLayers: readonly SemanticLayer[];
  /** URI to a `.splat` / `.ksplat` / `.ply` Gaussian asset, when available. */
  readonly splatUri?: string;
  /** URI to a point-cloud asset, when available. */
  readonly pointCloudUri?: string;
  /** Number of Gaussians/points, for a "reconstruction density" readout. */
  readonly primitiveCount?: number;
  /** ISO-8601 timestamp of the last reconstruction update. */
  readonly updatedAt: string;
  /** 0..1 mean reconstruction confidence across the scene. */
  readonly meanConfidence?: number;
}

/** A bounded region of interest inside a world model. */
export type SpatialZoneKind =
  | "dynamic_obstacle"
  | "restricted"
  | "narrow_clearance"
  | "drop_or_stairs"
  | "low_reconstruction_confidence"
  | "glass_or_reflective";

/** A bounded footprint region inside a world model worth flagging. */
export interface SpatialZone {
  readonly id: string;
  readonly label: string;
  readonly kind: SpatialZoneKind;
  /** Center used for camera framing and labels. */
  readonly center: Vec3;
  readonly footprint: Footprint;
  /** Height of the zone volume in meters, for a 3D prism render. */
  readonly heightM: number;
  readonly note?: string;
}
