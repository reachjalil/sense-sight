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

export type TrainedRenderProfileId = "balanced" | "photoreal" | "holographic";

export interface TrainedRenderProfileOption {
  readonly id: TrainedRenderProfileId;
  readonly label: string;
  readonly description: string;
  readonly profile: TrainedRenderProfile;
}

/** Operator-controlled x-ray style tuning for seeing into dense splats. */
export interface InteriorVisibilityTuning {
  /** Enables shape overlays and applies the tuned splat render profile. */
  readonly enabled: boolean;
  /** Target scene opacity, 0..1. Lower values expose room interiors. */
  readonly opacity: number;
  /** 0..1 spacing pressure. Higher values make splats smaller and airier. */
  readonly spacing: number;
  /** 0..1 color/alpha contrast pressure. Higher values lift visible detail. */
  readonly intensity: number;
}

export type SceneShapeKind = "room" | "corridor" | "alcove";

/** A room-like footprint inferred from a reconstruction point distribution. */
export interface InferredSceneShape {
  readonly id: string;
  readonly label: string;
  readonly kind: SceneShapeKind;
  readonly bounds: Bounds;
  readonly footprint: ReadonlyArray<readonly [number, number]>;
  readonly pointCount: number;
  readonly areaM2: number;
  readonly confidence: number;
}

export interface SceneShapeAnalysis {
  readonly shapes: readonly InferredSceneShape[];
  readonly gridCellSizeM: number;
  readonly occupiedCellCount: number;
  readonly sampledPointCount: number;
}

export interface SceneShapeAnalysisOptions {
  readonly maxSamples?: number;
  readonly targetGridCells?: number;
  readonly minCellSizeM?: number;
  readonly maxCellSizeM?: number;
  readonly minComponentCells?: number;
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
  label: "Balanced Spark",
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

export const PHOTOREAL_TRAINED_RENDER_PROFILE: TrainedRenderProfile = {
  ...DEFAULT_TRAINED_RENDER_PROFILE,
  label: "Photo real Spark",
  radiusDefault: 1.18,
  radiusMin: 0.18,
  radiusMax: 5,
  radiusStep: 0.04,
  minAlpha: 3 / 255,
  maxPixelRadius: 360,
  maxStdDev: Math.sqrt(8),
  focalAdjustment: 1.32,
  falloff: 1,
  sortRadial: true,
  opacity: 1,
  fallbackMinAlpha: 4 / 255,
  fallbackMinScale: 0.00015,
  fallbackMaxScale: 0.052,
  fallbackMaxScreenSize: 92,
  fallbackAlphaPower: 0.92,
  fallbackColorGain: 1.08,
  fallbackOpacity: 1,
};

export const HOLOGRAPHIC_TRAINED_RENDER_PROFILE: TrainedRenderProfile = {
  ...DEFAULT_TRAINED_RENDER_PROFILE,
  label: "Minority Report",
  radiusDefault: 0.62,
  radiusMin: 0.08,
  radiusMax: 1.6,
  radiusStep: 0.02,
  minAlpha: 10 / 255,
  maxPixelRadius: 48,
  maxStdDev: 1.7,
  focalAdjustment: 0.94,
  falloff: 0.72,
  sortRadial: true,
  opacity: 0.54,
  fallbackMinAlpha: 12 / 255,
  fallbackMinScale: 0.0002,
  fallbackMaxScale: 0.018,
  fallbackMaxScreenSize: 22,
  fallbackAlphaPower: 1.62,
  fallbackColorGain: 1.34,
  fallbackOpacity: 0.54,
};

export const TRAINED_RENDER_PROFILES: Record<
  TrainedRenderProfileId,
  TrainedRenderProfile
> = {
  balanced: DEFAULT_TRAINED_RENDER_PROFILE,
  photoreal: PHOTOREAL_TRAINED_RENDER_PROFILE,
  holographic: HOLOGRAPHIC_TRAINED_RENDER_PROFILE,
};

export const TRAINED_RENDER_PROFILE_OPTIONS: readonly TrainedRenderProfileOption[] =
  [
    {
      id: "photoreal",
      label: "Photo real",
      description:
        "High-fidelity Spark 3DGS with full opacity and large splats.",
      profile: PHOTOREAL_TRAINED_RENDER_PROFILE,
    },
    {
      id: "holographic",
      label: "Holographic",
      description: "Transparent, airy splats for the Minority Report view.",
      profile: HOLOGRAPHIC_TRAINED_RENDER_PROFILE,
    },
    {
      id: "balanced",
      label: "Balanced",
      description: "Default Spark/fallback tuning for mixed inspection.",
      profile: DEFAULT_TRAINED_RENDER_PROFILE,
    },
  ];

export const DEFAULT_INTERIOR_VISIBILITY_TUNING: InteriorVisibilityTuning = {
  enabled: true,
  opacity: 0.58,
  spacing: 0.55,
  intensity: 0.72,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(
    Math.floor((sorted.length - 1) * clamp01(fraction)),
    0,
    sorted.length - 1
  );
  return sorted[index] ?? 0;
}

/**
 * Derives an interior-inspection render profile from a normal trained-splat
 * profile. Opacity lowers the whole splat shell, spacing tightens large/low
 * alpha splats so gaps open up, and intensity restores readable surface color
 * after the scene is made translucent.
 */
export function applyInteriorVisibilityProfile(
  profile: TrainedRenderProfile,
  tuning: InteriorVisibilityTuning
): TrainedRenderProfile {
  if (!tuning.enabled) return profile;

  const opacity = clamp(tuning.opacity, 0.08, 1);
  const spacing = clamp01(tuning.spacing);
  const intensity = clamp01(tuning.intensity);
  const minAlphaTarget = lerp(profile.minAlpha, 18 / 255, spacing);
  const fallbackMinAlphaTarget = lerp(
    profile.fallbackMinAlpha,
    18 / 255,
    spacing
  );

  return {
    ...profile,
    label: `${profile.label} interior`,
    radiusDefault: Math.max(
      profile.radiusMin,
      profile.radiusDefault * lerp(1, 0.46, spacing)
    ),
    minAlpha: clamp(minAlphaTarget, 1 / 255, 64 / 255),
    maxPixelRadius: Math.max(
      6,
      Math.round(profile.maxPixelRadius * lerp(1, 0.38, spacing))
    ),
    maxStdDev: Math.max(0.75, profile.maxStdDev * lerp(1, 0.62, spacing)),
    focalAdjustment: profile.focalAdjustment * lerp(1, 0.92, spacing),
    falloff: profile.falloff * lerp(1, 0.78, spacing),
    opacity,
    fallbackMinAlpha: clamp(fallbackMinAlphaTarget, 1 / 255, 64 / 255),
    fallbackMaxScreenSize: Math.max(
      4,
      Math.round(profile.fallbackMaxScreenSize * lerp(1, 0.42, spacing))
    ),
    fallbackAlphaPower: profile.fallbackAlphaPower * lerp(1, 1.75, spacing),
    fallbackColorGain: profile.fallbackColorGain * lerp(1, 1.42, intensity),
    fallbackOpacity: opacity,
  };
}

/**
 * Infers room-like shapes from a seed point cloud by projecting points onto
 * XZ, thresholding an adaptive occupancy grid, then flood-filling connected
 * dense footprints. This intentionally stays geometric and local: semantic
 * room labels can replace it later without changing the console contract.
 */
export function inferSceneShapesFromPoints(
  positions: Float32Array,
  bounds: Bounds,
  options: SceneShapeAnalysisOptions = {}
): SceneShapeAnalysis {
  const pointTotal = Math.floor(positions.length / 3);
  const spanX = Math.max(0.001, bounds.max.x - bounds.min.x);
  const spanZ = Math.max(0.001, bounds.max.z - bounds.min.z);
  const targetGridCells = options.targetGridCells ?? 72;
  const cellSize = clamp(
    Math.max(spanX, spanZ) / targetGridCells,
    options.minCellSizeM ?? 0.28,
    options.maxCellSizeM ?? 1.2
  );
  const width = Math.max(1, Math.ceil(spanX / cellSize));
  const depth = Math.max(1, Math.ceil(spanZ / cellSize));
  const counts = new Uint32Array(width * depth);
  const maxSamples = Math.max(1, options.maxSamples ?? 90_000);
  const sampleStep = Math.max(1, Math.floor(pointTotal / maxSamples));
  let sampledPointCount = 0;

  for (let point = 0; point < pointTotal; point += sampleStep) {
    const offset = point * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    if (
      x < bounds.min.x ||
      x > bounds.max.x ||
      z < bounds.min.z ||
      z > bounds.max.z
    ) {
      continue;
    }
    const cellX = clamp(
      Math.floor((x - bounds.min.x) / cellSize),
      0,
      width - 1
    );
    const cellZ = clamp(
      Math.floor((z - bounds.min.z) / cellSize),
      0,
      depth - 1
    );
    counts[cellZ * width + cellX] += 1;
    sampledPointCount += 1;
  }

  const nonzeroCounts = Array.from(counts).filter((count) => count > 0);
  if (nonzeroCounts.length === 0) {
    return {
      shapes: [],
      gridCellSizeM: cellSize,
      occupiedCellCount: 0,
      sampledPointCount,
    };
  }

  const occupancyThreshold = Math.max(2, percentile(nonzeroCounts, 0.34));
  const occupied = new Uint8Array(width * depth);
  let occupiedCellCount = 0;
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] >= occupancyThreshold) {
      occupied[index] = 1;
      occupiedCellCount += 1;
    }
  }

  const expanded = new Uint8Array(width * depth);
  for (let cellZ = 0; cellZ < depth; cellZ += 1) {
    for (let cellX = 0; cellX < width; cellX += 1) {
      const index = cellZ * width + cellX;
      if (occupied[index] !== 1) continue;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = cellX + dx;
          const nextZ = cellZ + dz;
          if (nextX < 0 || nextX >= width || nextZ < 0 || nextZ >= depth) {
            continue;
          }
          expanded[nextZ * width + nextX] = 1;
        }
      }
    }
  }

  const visited = new Uint8Array(width * depth);
  const minComponentCells = options.minComponentCells ?? 6;
  const shapes: InferredSceneShape[] = [];

  for (let start = 0; start < expanded.length; start += 1) {
    if (expanded[start] !== 1 || visited[start] === 1) continue;

    const stack = [start];
    visited[start] = 1;
    let minX = width;
    let maxX = 0;
    let minZ = depth;
    let maxZ = 0;
    let cellCount = 0;
    let pointCount = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) continue;
      const cellX = index % width;
      const cellZ = Math.floor(index / width);
      minX = Math.min(minX, cellX);
      maxX = Math.max(maxX, cellX);
      minZ = Math.min(minZ, cellZ);
      maxZ = Math.max(maxZ, cellZ);
      cellCount += 1;
      pointCount += counts[index] ?? 0;

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= expanded.length) continue;
        if (
          (next === index - 1 && cellX === 0) ||
          (next === index + 1 && cellX === width - 1)
        ) {
          continue;
        }
        if (expanded[next] !== 1 || visited[next] === 1) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }

    if (cellCount < minComponentCells) continue;

    const x0 = clamp(
      bounds.min.x + minX * cellSize,
      bounds.min.x,
      bounds.max.x
    );
    const x1 = clamp(
      bounds.min.x + (maxX + 1) * cellSize,
      bounds.min.x,
      bounds.max.x
    );
    const z0 = clamp(
      bounds.min.z + minZ * cellSize,
      bounds.min.z,
      bounds.max.z
    );
    const z1 = clamp(
      bounds.min.z + (maxZ + 1) * cellSize,
      bounds.min.z,
      bounds.max.z
    );
    const widthM = Math.max(0.001, x1 - x0);
    const depthM = Math.max(0.001, z1 - z0);
    const areaM2 = widthM * depthM;
    const aspectRatio = Math.max(widthM, depthM) / Math.min(widthM, depthM);
    const fillRatio = clamp01(
      cellCount / Math.max(1, (maxX - minX + 1) * (maxZ - minZ + 1))
    );
    const kind: SceneShapeKind =
      aspectRatio >= 1.85 && areaM2 >= 8
        ? "corridor"
        : areaM2 >= 8
          ? "room"
          : "alcove";

    shapes.push({
      id: `shape-${shapes.length + 1}`,
      label: `${kind} ${shapes.length + 1}`,
      kind,
      bounds: {
        min: { x: x0, y: bounds.min.y, z: z0 },
        max: { x: x1, y: bounds.max.y, z: z1 },
      },
      footprint: [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
      pointCount,
      areaM2,
      confidence: clamp01(
        0.25 + fillRatio * 0.45 + Math.min(0.3, Math.log10(pointCount + 1) / 12)
      ),
    });
  }

  shapes.sort((a, b) => b.areaM2 - a.areaM2 || b.pointCount - a.pointCount);

  return {
    shapes: shapes.slice(0, 12),
    gridCellSizeM: cellSize,
    occupiedCellCount,
    sampledPointCount,
  };
}
