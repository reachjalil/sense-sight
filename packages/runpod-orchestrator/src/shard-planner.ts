export interface PlannedShard {
  readonly index: number;
  readonly count: number;
  readonly keyframeStart: number;
  readonly keyframeEnd: number;
  readonly overlapKeyframes: number;
  readonly strategy: "contiguous_overlap";
}

/**
 * Split [0, totalKeyframes) into `shardCount` contiguous, evenly-sized
 * windows, each extended by `overlapKeyframes` on its internal borders
 * (clamped at the sequence ends so the first shard never starts below 0 and
 * the last shard never ends past totalKeyframes). Unlike a modulo/interleaved
 * strategy, every shard's keyframes are a single contiguous run.
 */
export function planShards(
  totalKeyframes: number,
  shardCount: number,
  overlapKeyframes: number
): PlannedShard[] {
  if (totalKeyframes <= 0) {
    throw new Error(`totalKeyframes must be > 0, got ${totalKeyframes}`);
  }
  if (shardCount <= 0) {
    throw new Error(`shardCount must be > 0, got ${shardCount}`);
  }
  if (overlapKeyframes < 0) {
    throw new Error(`overlapKeyframes must be >= 0, got ${overlapKeyframes}`);
  }

  const baseSize = Math.floor(totalKeyframes / shardCount);
  const remainder = totalKeyframes % shardCount;

  const shards: PlannedShard[] = [];
  let cursor = 0;
  for (let index = 0; index < shardCount; index++) {
    const size = baseSize + (index < remainder ? 1 : 0);
    const boundaryStart = cursor;
    const boundaryEnd = cursor + size;

    const keyframeStart = Math.max(0, boundaryStart - overlapKeyframes);
    const keyframeEnd = Math.min(
      totalKeyframes,
      boundaryEnd + overlapKeyframes
    );

    shards.push({
      index,
      count: keyframeEnd - keyframeStart,
      keyframeStart,
      keyframeEnd,
      overlapKeyframes,
      strategy: "contiguous_overlap",
    });

    cursor = boundaryEnd;
  }

  return shards;
}
