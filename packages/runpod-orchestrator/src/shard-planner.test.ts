import { describe, expect, it } from "vitest";
import { planShards } from "./shard-planner";

describe("planShards", () => {
  it("splits keyframes into contiguous, evenly-sized windows with no overlap", () => {
    const shards = planShards(100, 4, 0);

    expect(shards).toHaveLength(4);
    expect(shards.map((s) => [s.keyframeStart, s.keyframeEnd])).toEqual([
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
    ]);
    // Every keyframe is covered exactly once when overlap is 0.
    expect(shards.reduce((sum, s) => sum + s.count, 0)).toBe(100);
  });

  it("distributes the remainder across the first shards, one extra each", () => {
    const shards = planShards(10, 3, 0);

    // base size 3, remainder 1 -> shard 0 gets size 4, shards 1/2 get size 3.
    expect(shards.map((s) => s.keyframeEnd - s.keyframeStart)).toEqual([
      4, 3, 3,
    ]);
    expect(shards[0]).toMatchObject({ keyframeStart: 0, keyframeEnd: 4 });
    expect(shards[1]).toMatchObject({ keyframeStart: 4, keyframeEnd: 7 });
    expect(shards[2]).toMatchObject({ keyframeStart: 7, keyframeEnd: 10 });
  });

  it("extends internal borders by the overlap and clamps at the sequence ends", () => {
    const shards = planShards(100, 4, 5);

    // Unclamped boundaries would be [0,25), [25,50), [50,75), [75,100).
    // Internal borders (25, 50, 75) extend by 5 on each side; the
    // sequence ends (0 and 100) stay clamped.
    expect(shards[0]).toMatchObject({ keyframeStart: 0, keyframeEnd: 30 });
    expect(shards[1]).toMatchObject({ keyframeStart: 20, keyframeEnd: 55 });
    expect(shards[2]).toMatchObject({ keyframeStart: 45, keyframeEnd: 80 });
    expect(shards[3]).toMatchObject({ keyframeStart: 70, keyframeEnd: 100 });

    for (const shard of shards) {
      expect(shard.keyframeStart).toBeGreaterThanOrEqual(0);
      expect(shard.keyframeEnd).toBeLessThanOrEqual(100);
      expect(shard.count).toBe(shard.keyframeEnd - shard.keyframeStart);
      expect(shard.overlapKeyframes).toBe(5);
      expect(shard.strategy).toBe("contiguous_overlap");
    }
  });

  it("clamps overlap that would push a window past the sequence bounds", () => {
    // A huge overlap relative to a small sequence: every shard should still
    // clamp to [0, totalKeyframes).
    const shards = planShards(20, 5, 50);

    for (const shard of shards) {
      expect(shard.keyframeStart).toBe(0);
      expect(shard.keyframeEnd).toBe(20);
    }
  });

  it("produces contiguous (non-modulo/interleaved) keyframe runs", () => {
    const shards = planShards(37, 5, 2);

    for (const shard of shards) {
      // A contiguous run spans exactly [start, end) with no gaps inside —
      // verified implicitly by count matching the span, which a modulo
      // strategy (i, i+shardCount, i+2*shardCount, ...) would not satisfy.
      expect(shard.count).toBe(shard.keyframeEnd - shard.keyframeStart);
      expect(shard.keyframeEnd).toBeGreaterThan(shard.keyframeStart);
    }

    // Shards stay in ascending index/start order (contiguous partitioning),
    // not interleaved.
    for (let i = 1; i < shards.length; i++) {
      expect(shards[i].keyframeStart).toBeGreaterThanOrEqual(
        shards[i - 1].keyframeStart
      );
    }
  });

  it("assigns ascending shard indices", () => {
    const shards = planShards(8, 3, 1);
    expect(shards.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("throws on non-positive totalKeyframes", () => {
    expect(() => planShards(0, 2, 0)).toThrow();
    expect(() => planShards(-5, 2, 0)).toThrow();
  });

  it("throws on non-positive shardCount", () => {
    expect(() => planShards(10, 0, 0)).toThrow();
    expect(() => planShards(10, -1, 0)).toThrow();
  });

  it("throws on negative overlapKeyframes", () => {
    expect(() => planShards(10, 2, -1)).toThrow();
  });

  it("handles a single shard covering the whole sequence", () => {
    const shards = planShards(50, 1, 10);
    expect(shards).toHaveLength(1);
    expect(shards[0]).toMatchObject({ keyframeStart: 0, keyframeEnd: 50 });
  });
});
