/**
 * @sense-sight/render-contracts — shared rendering contracts for splat and
 * point-cloud world viewers.
 *
 * Pins down the layer toggles, render presets, coordinate-frame handling, and
 * trained-render tuning profile a viewer needs, so rendering stays
 * implementation-free and swappable between mock, procedural, and trained
 * Gaussian-splat assets.
 */

import type { Bounds } from "@sense-sight/world-schema";

/** Which optional visual layers a viewer should draw for a given frame. */
export interface RenderLayers {
  readonly pointcloud: boolean;
  readonly trajectory: boolean;
  readonly splat: boolean;
  readonly grid: boolean;
  readonly annotations: boolean;
}

/**
 * Tunable parameters for rendering a trained Gaussian-splat asset. Mirrors
 * the knobs a splat rasterizer exposes (point radius bounds, alpha/scale
 * clamping, screen-space falloff) plus a fallback set used when the
 * primary rasterizer path is unavailable and the viewer must draw splats as
 * shaded points instead.
 */
export interface TrainedRenderProfile {
  readonly label: string;
  readonly radiusDefault: number;
  readonly radiusMin: number;
  readonly radiusMax: number;
  readonly radiusStep: number;
  readonly minAlpha: number;
  readonly maxPixelRadius: number;
  readonly maxStdDev: number;
  readonly focalAdjustment: number;
  readonly falloff: number;
  readonly sortRadial: boolean;
  readonly opacity: number;
  readonly fallbackMinAlpha: number;
  readonly fallbackMinScale: number;
  readonly fallbackMaxScale: number;
  readonly fallbackMaxScreenSize: number;
  readonly fallbackAlphaPower: number;
  readonly fallbackColorGain: number;
  readonly fallbackOpacity: number;
}

/**
 * Discriminates which rendering transform a trained splat asset needs at
 * load time.
 *
 * - `"normalized"` — the asset's point positions and camera-to-world
 *   convention were normalized into the viewer's world frame during export
 *   (re-centered, axis-aligned, and rescaled to fit known {@link Bounds}).
 *   The viewer must still apply an orientation correction and a bounds-fit
 *   rescale to land the asset in its own world frame.
 * - `"training-frame"` — the asset still carries the coordinate
 *   convention produced directly by the training run (un-normalized). The
 *   viewer only needs a single axis-sign flip at load time and no further
 *   reframing.
 */
export type CoordinateFrame = "normalized" | "training-frame";

/** A named, reproducible rendering configuration for a world viewer. */
export interface RenderPreset {
  readonly label: string;
  readonly description: string;
  readonly base: string;
  readonly pointSize: number;
  readonly tone: string;
  readonly coordinateFrame: CoordinateFrame;
  readonly worldBounds?: Bounds;
  readonly trainedRender?: TrainedRenderProfile;
}

/**
 * Asset-directory naming contract a viewer reads. Every world-generation
 * output directory is expected to use these exact filenames so a viewer can
 * locate assets without per-pipeline configuration.
 */
export const ASSET_FILENAMES = {
  world: "world.json",
  keyframes: "keyframes.json",
  pointsXyz: "points_xyz.f32",
  pointsRgb: "points_rgb.u8",
  seedSplat: "seed.splat",
  trainingDiagnostics: "training_diagnostics.json",
} as const;

export type AssetFilenameKey = keyof typeof ASSET_FILENAMES;

/**
 * Which of {@link ASSET_FILENAMES} a given preset requires versus may
 * optionally provide. `required` assets must exist for the preset to render;
 * `optional` assets enhance the preset (diagnostics, alternate trained-splat
 * variants) but their absence should degrade gracefully rather than fail the
 * load.
 */
export interface PresetAssetManifest {
  readonly preset: string;
  readonly required: readonly AssetFilenameKey[];
  readonly optional: readonly AssetFilenameKey[];
}

/**
 * Builds the filename for a trained-splat asset at a given training
 * iteration, e.g. `trained-30000.splat` or `trained-30000-viewer.splat`.
 */
export function trainedSplatFilename(
  iterations: number,
  variant?: "viewer" | "regularized"
): string {
  const suffix = variant ? `-${variant}` : "";
  return `trained-${iterations}${suffix}.splat`;
}

export const DEFAULT_TRAINED_RENDER_PROFILE: TrainedRenderProfile = {
  label: "default",
  radiusDefault: 1,
  radiusMin: 0.25,
  radiusMax: 4,
  radiusStep: 0.05,
  minAlpha: 8 / 255,
  maxPixelRadius: 64,
  maxStdDev: 3,
  focalAdjustment: 1,
  falloff: 1,
  sortRadial: true,
  opacity: 0.95,
  fallbackMinAlpha: 8 / 255,
  fallbackMinScale: 0.25,
  fallbackMaxScale: 4,
  fallbackMaxScreenSize: 64,
  fallbackAlphaPower: 1,
  fallbackColorGain: 1,
  fallbackOpacity: 0.95,
};
