import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERIOR_VISIBILITY_TUNING,
  DEFAULT_TRAINED_RENDER_PROFILE,
  HOLOGRAPHIC_TRAINED_RENDER_PROFILE,
  PHOTOREAL_TRAINED_RENDER_PROFILE,
  TRAINED_RENDER_PROFILE_OPTIONS,
  applyInteriorVisibilityProfile,
  inferSceneShapesFromPoints,
  trainedSplatFilename,
} from "./index";

describe("trainedSplatFilename", () => {
  it("builds a bare filename when no variant is given", () => {
    expect(trainedSplatFilename(30000)).toBe("trained-30000.splat");
  });

  it("appends the viewer variant suffix", () => {
    expect(trainedSplatFilename(30000, "viewer")).toBe(
      "trained-30000-viewer.splat"
    );
  });

  it("appends the regularized variant suffix", () => {
    expect(trainedSplatFilename(7000, "regularized")).toBe(
      "trained-7000-regularized.splat"
    );
  });

  it("supports arbitrary iteration counts", () => {
    expect(trainedSplatFilename(1)).toBe("trained-1.splat");
    expect(trainedSplatFilename(0)).toBe("trained-0.splat");
  });
});

describe("trained render profiles", () => {
  it("offers named Spark looks for realistic and holographic inspection", () => {
    expect(TRAINED_RENDER_PROFILE_OPTIONS.map((option) => option.id)).toEqual([
      "photoreal",
      "holographic",
      "balanced",
    ]);
    expect(PHOTOREAL_TRAINED_RENDER_PROFILE.maxPixelRadius).toBeGreaterThan(
      DEFAULT_TRAINED_RENDER_PROFILE.maxPixelRadius
    );
    expect(PHOTOREAL_TRAINED_RENDER_PROFILE.radiusDefault).toBeLessThan(
      DEFAULT_TRAINED_RENDER_PROFILE.radiusDefault
    );
    expect(PHOTOREAL_TRAINED_RENDER_PROFILE.maxPixelRadius).toBeGreaterThan(
      HOLOGRAPHIC_TRAINED_RENDER_PROFILE.maxPixelRadius
    );
    expect(HOLOGRAPHIC_TRAINED_RENDER_PROFILE.opacity).toBeLessThan(
      PHOTOREAL_TRAINED_RENDER_PROFILE.opacity
    );
  });
});

describe("applyInteriorVisibilityProfile", () => {
  it("keeps the original profile when disabled", () => {
    const tuned = applyInteriorVisibilityProfile(
      DEFAULT_TRAINED_RENDER_PROFILE,
      {
        ...DEFAULT_INTERIOR_VISIBILITY_TUNING,
        enabled: false,
      }
    );

    expect(tuned).toBe(DEFAULT_TRAINED_RENDER_PROFILE);
  });

  it("reduces opacity and splat footprint for interior inspection", () => {
    const tuned = applyInteriorVisibilityProfile(
      DEFAULT_TRAINED_RENDER_PROFILE,
      {
        ...DEFAULT_INTERIOR_VISIBILITY_TUNING,
        enabled: true,
      }
    );

    expect(tuned.opacity).toBeCloseTo(
      DEFAULT_INTERIOR_VISIBILITY_TUNING.opacity
    );
    expect(tuned.radiusDefault).toBeLessThan(
      DEFAULT_TRAINED_RENDER_PROFILE.radiusDefault
    );
    expect(tuned.maxPixelRadius).toBeLessThan(
      DEFAULT_TRAINED_RENDER_PROFILE.maxPixelRadius
    );
    expect(tuned.minAlpha).toBeGreaterThan(
      DEFAULT_TRAINED_RENDER_PROFILE.minAlpha
    );
    expect(tuned.fallbackColorGain).toBeGreaterThan(
      DEFAULT_TRAINED_RENDER_PROFILE.fallbackColorGain
    );
  });
});

describe("inferSceneShapesFromPoints", () => {
  function rectangularFootprint(width: number, depth: number): Float32Array {
    const points: number[] = [];
    for (let x = -width / 2; x <= width / 2; x += 0.25) {
      for (let z = -depth / 2; z <= depth / 2; z += 0.25) {
        points.push(x, 0.05, z);
        points.push(x, 1.6, z);
      }
    }
    return new Float32Array(points);
  }

  it("labels an elongated footprint as a corridor", () => {
    const analysis = inferSceneShapesFromPoints(
      rectangularFootprint(2.5, 12),
      {
        min: { x: -2, y: 0, z: -6.5 },
        max: { x: 2, y: 2.4, z: 6.5 },
      },
      { minCellSizeM: 0.25, targetGridCells: 48 }
    );

    expect(analysis.shapes.length).toBeGreaterThanOrEqual(1);
    expect(analysis.shapes[0]?.kind).toBe("corridor");
    expect(analysis.shapes[0]?.areaM2).toBeGreaterThan(20);
  });

  it("returns no shapes for an empty cloud", () => {
    const analysis = inferSceneShapesFromPoints(new Float32Array(), {
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 2, z: 1 },
    });

    expect(analysis.shapes).toEqual([]);
    expect(analysis.sampledPointCount).toBe(0);
  });
});
