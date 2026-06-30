import {
  decodeSplat,
  encodeSplat,
  SPLAT_RECORD_BYTES,
} from "@sense-sight/splat-codec";
import { describe, expect, it } from "vitest";
import { mergeSplatShards } from "./merge";

/** Builds a synthetic `.splat` shard buffer from plain per-Gaussian arrays. */
function buildShard(points: {
  positions: number[];
  colors: number[];
  scales: number[];
  rotations: number[];
  alphas: number[];
}): ArrayBuffer {
  return encodeSplat({
    positions: points.positions,
    colors: points.colors,
    scale: 0,
    scales: points.scales,
    rotations: points.rotations,
    alphas: points.alphas,
  });
}

describe("mergeSplatShards", () => {
  it("throws when a shard buffer is not a multiple of the record size", () => {
    const malformed = new ArrayBuffer(SPLAT_RECORD_BYTES + 1);
    expect(() => mergeSplatShards([malformed], { voxelSizeM: 0.05 })).toThrow();
  });

  it("throws on a non-positive voxelSizeM", () => {
    const shard = buildShard({
      positions: [0, 0, 0],
      colors: [255, 0, 0],
      scales: [0.1, 0.1, 0.1],
      rotations: [1, 2, 3, 4],
      alphas: [255],
    });
    expect(() => mergeSplatShards([shard], { voxelSizeM: 0 })).toThrow();
    expect(() => mergeSplatShards([shard], { voxelSizeM: -1 })).toThrow();
  });

  it("merges two overlapping shards into fewer Gaussians than naive concatenation", () => {
    const voxelSizeM = 1;

    // Shard A: a unique point at x=10 (no overlap), plus an overlap-border
    // point at the origin voxel.
    const shardA = buildShard({
      positions: [10, 0, 0, 0.1, 0.1, 0.1],
      colors: [200, 10, 10, 100, 100, 100],
      scales: [0.05, 0.02, 0.02, 0.01, 0.01, 0.01],
      rotations: [1, 2, 3, 4, 5, 6, 7, 8],
      alphas: [255, 64],
    });

    // Shard B: a unique point at x=20 (no overlap), plus a second sample of
    // the SAME overlap-border voxel as shard A's second point, with a
    // larger per-axis scale and higher opacity.
    const shardB = buildShard({
      positions: [20, 0, 0, 0.2, 0.15, 0.05],
      colors: [10, 200, 10, 50, 150, 250],
      scales: [0.03, 0.03, 0.03, 0.2, 0.01, 0.01],
      rotations: [9, 10, 11, 12, 13, 14, 15, 16],
      alphas: [255, 200],
    });

    const naiveConcatCount = 4; // 2 points per shard, 4 total if never deduped.

    const merged = mergeSplatShards([shardA, shardB], { voxelSizeM });
    const decoded = decodeSplat(merged);

    // The two overlap-border points (both inside voxel (0,0,0) at
    // voxelSizeM=1) collapse into one Gaussian, so total count is strictly
    // smaller than naive concatenation.
    expect(decoded.count).toBe(3);
    expect(decoded.count).toBeLessThan(naiveConcatCount);

    // Find the merged overlap-voxel Gaussian (near the origin) vs. the two
    // untouched unique points (x=10 and x=20).
    const points = Array.from({ length: decoded.count }, (_, i) => ({
      x: decoded.positions[i * 3],
      y: decoded.positions[i * 3 + 1],
      z: decoded.positions[i * 3 + 2],
      sx: decoded.scales[i * 3],
      sy: decoded.scales[i * 3 + 1],
      sz: decoded.scales[i * 3 + 2],
      a: decoded.colors[i * 4 + 3],
      rx: decoded.rotations[i * 4],
    }));

    const uniqueA = points.find((p) => Math.abs(p.x - 10) < 1e-3);
    const uniqueB = points.find((p) => Math.abs(p.x - 20) < 1e-3);
    const mergedOverlap = points.find(
      (p) => Math.abs(p.x - 10) >= 1e-3 && Math.abs(p.x - 20) >= 1e-3
    );

    expect(uniqueA).toBeDefined();
    expect(uniqueB).toBeDefined();
    expect(mergedOverlap).toBeDefined();

    // Anisotropic scale survives: the merged Gaussian's per-axis scale is
    // the MAX across the bucket's members per axis, not collapsed to one
    // isotropic value, and not simply averaged.
    expect(mergedOverlap?.sx).toBeCloseTo(Math.max(0.01, 0.2), 5);
    expect(mergedOverlap?.sy).toBeCloseTo(Math.max(0.01, 0.01), 5);
    expect(mergedOverlap?.sz).toBeCloseTo(Math.max(0.01, 0.01), 5);
    // The three scale components differ, proving anisotropy was preserved
    // rather than collapsed to a single scalar.
    expect(mergedOverlap?.sx).not.toBeCloseTo(mergedOverlap?.sy ?? -1, 5);

    // Real (non-trivial, non-zero, non-255-default) alpha survives via the
    // opacity-weighted mean of 64 and 200.
    expect(mergedOverlap?.a).toBeGreaterThan(0);
    expect(mergedOverlap?.a).toBeLessThan(255);
    const expectedAlpha =
      (64 * (64 / 255) + 200 * (200 / 255)) / (64 / 255 + 200 / 255);
    expect(mergedOverlap?.a).toBeCloseTo(Math.round(expectedAlpha), 0);

    // Rotation comes from the highest-opacity member (alpha 200 > 64), so
    // the merged rotation's first byte should be shard B's (13), not shard
    // A's (5).
    expect(mergedOverlap?.rx).toBe(13);

    // Unique, non-overlapping points are untouched: alpha and scale pass
    // through unchanged.
    expect(uniqueA?.a).toBe(255);
    expect(uniqueA?.sx).toBeCloseTo(0.05, 5);
    expect(uniqueB?.a).toBe(255);
    expect(uniqueB?.sx).toBeCloseTo(0.03, 5);
  });

  it("falls back to a plain mean position for an all-zero-opacity bucket", () => {
    const shardA = buildShard({
      positions: [0.1, 0.1, 0.1],
      colors: [10, 20, 30],
      scales: [0.01, 0.01, 0.01],
      rotations: [1, 1, 1, 1],
      alphas: [0],
    });
    const shardB = buildShard({
      positions: [0.3, 0.3, 0.3],
      colors: [30, 40, 50],
      scales: [0.02, 0.02, 0.02],
      rotations: [2, 2, 2, 2],
      alphas: [0],
    });

    const merged = mergeSplatShards([shardA, shardB], { voxelSizeM: 1 });
    const decoded = decodeSplat(merged);

    expect(decoded.count).toBe(1);
    expect(decoded.positions[0]).toBeCloseTo(0.2, 5);
    expect(decoded.positions[1]).toBeCloseTo(0.2, 5);
    expect(decoded.positions[2]).toBeCloseTo(0.2, 5);
    expect(decoded.colors[3]).toBe(0);
  });

  it("keeps points in different voxels separate (no over-merging)", () => {
    const shard = buildShard({
      positions: [0, 0, 0, 5, 5, 5],
      colors: [255, 0, 0, 0, 255, 0],
      scales: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02],
      rotations: [1, 2, 3, 4, 5, 6, 7, 8],
      alphas: [255, 255],
    });

    const merged = mergeSplatShards([shard], { voxelSizeM: 0.5 });
    const decoded = decodeSplat(merged);

    expect(decoded.count).toBe(2);
  });
});
