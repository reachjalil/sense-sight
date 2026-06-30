import {
  decodeSplat,
  encodeSplat,
  SPLAT_RECORD_BYTES,
} from "@sense-sight/splat-codec";

export interface MergeSplatShardsOptions {
  /** Voxel edge length (meters) used to bucket-and-dedup overlapping Gaussians. */
  readonly voxelSizeM: number;
}

interface Gaussian {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly rw: number;
}

function voxelKey(x: number, y: number, z: number, voxelSizeM: number): string {
  const vx = Math.floor(x / voxelSizeM);
  const vy = Math.floor(y / voxelSizeM);
  const vz = Math.floor(z / voxelSizeM);
  return `${vx}:${vy}:${vz}`;
}

interface MergedGaussian {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Opacity-weighted mean alpha (0..255) across the bucket's members. */
  readonly a: number;
  /** Max per-axis scale across the bucket's members (preserves anisotropy). */
  readonly scale: readonly [number, number, number];
  /** Rotation of the bucket's highest-opacity member (already-encoded bytes). */
  readonly rotation: readonly [number, number, number, number];
}

function mergeBucket(members: readonly Gaussian[]): MergedGaussian {
  let weightSum = 0;
  let wx = 0;
  let wy = 0;
  let wz = 0;
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wa = 0;
  let maxSx = 0;
  let maxSy = 0;
  let maxSz = 0;
  let bestOpacity = -1;
  let bestRotation: readonly [number, number, number, number] = [
    members[0].rx,
    members[0].ry,
    members[0].rz,
    members[0].rw,
  ];

  for (const member of members) {
    const weight = member.a / 255;
    weightSum += weight;
    wx += member.x * weight;
    wy += member.y * weight;
    wz += member.z * weight;
    wr += member.r * weight;
    wg += member.g * weight;
    wb += member.b * weight;
    wa += member.a * weight;
    maxSx = Math.max(maxSx, member.sx);
    maxSy = Math.max(maxSy, member.sy);
    maxSz = Math.max(maxSz, member.sz);
    if (member.a > bestOpacity) {
      bestOpacity = member.a;
      bestRotation = [member.rx, member.ry, member.rz, member.rw];
    }
  }

  const scale: readonly [number, number, number] = [maxSx, maxSy, maxSz];

  if (weightSum > 0) {
    return {
      x: wx / weightSum,
      y: wy / weightSum,
      z: wz / weightSum,
      r: wr / weightSum,
      g: wg / weightSum,
      b: wb / weightSum,
      a: wa / weightSum,
      scale,
      rotation: bestRotation,
    };
  }

  // All-zero-opacity bucket: weighted mean is undefined, fall back to a
  // plain arithmetic mean so a fully-transparent cluster doesn't collapse to
  // the origin.
  const n = members.length;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (const member of members) {
    sx += member.x;
    sy += member.y;
    sz += member.z;
    sr += member.r;
    sg += member.g;
    sb += member.b;
  }
  return {
    x: sx / n,
    y: sy / n,
    z: sz / n,
    r: sr / n,
    g: sg / n,
    b: sb / n,
    a: 0,
    scale,
    rotation: bestRotation,
  };
}

/**
 * Decode every shard, assert byte alignment, concatenate all Gaussians, then
 * voxel-dedup overlapping geometry (each shard's overlap border can see the
 * same physical Gaussians as its neighbor): bucket by floor(position /
 * voxelSizeM) per axis, and within each bucket keep a single merged Gaussian
 * — position/color/alpha opacity-weighted, scale taking the bucket's max per
 * axis (preserves anisotropy), rotation taken from the highest-opacity
 * member. Returns the re-encoded `.splat` buffer with full per-Gaussian
 * scale/rotation/alpha preserved (lossy only in the dedup itself, not in the
 * encoding).
 */
export function mergeSplatShards(
  shardBuffers: ArrayBuffer[],
  opts: MergeSplatShardsOptions
): ArrayBuffer {
  const { voxelSizeM } = opts;
  if (voxelSizeM <= 0) {
    throw new Error(`voxelSizeM must be > 0, got ${voxelSizeM}`);
  }

  const buckets = new Map<string, Gaussian[]>();

  shardBuffers.forEach((buffer, shardIndex) => {
    if (buffer.byteLength % SPLAT_RECORD_BYTES !== 0) {
      throw new Error(
        `shard ${shardIndex} byte length ${buffer.byteLength} is not a multiple of ${SPLAT_RECORD_BYTES}`
      );
    }

    const decoded = decodeSplat(buffer);
    for (let i = 0; i < decoded.count; i++) {
      const gaussian: Gaussian = {
        x: decoded.positions[i * 3],
        y: decoded.positions[i * 3 + 1],
        z: decoded.positions[i * 3 + 2],
        sx: decoded.scales[i * 3],
        sy: decoded.scales[i * 3 + 1],
        sz: decoded.scales[i * 3 + 2],
        r: decoded.colors[i * 4],
        g: decoded.colors[i * 4 + 1],
        b: decoded.colors[i * 4 + 2],
        a: decoded.colors[i * 4 + 3],
        rx: decoded.rotations[i * 4],
        ry: decoded.rotations[i * 4 + 1],
        rz: decoded.rotations[i * 4 + 2],
        rw: decoded.rotations[i * 4 + 3],
      };
      const key = voxelKey(gaussian.x, gaussian.y, gaussian.z, voxelSizeM);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(gaussian);
      } else {
        buckets.set(key, [gaussian]);
      }
    }
  });

  const merged = Array.from(buckets.values(), mergeBucket);

  const positions = new Float32Array(merged.length * 3);
  const colors = new Uint8Array(merged.length * 3);
  const scales = new Float32Array(merged.length * 3);
  const rotations = new Uint8Array(merged.length * 4);
  const alphas = new Uint8Array(merged.length);
  let fallbackScale = 0;

  merged.forEach((gaussian, i) => {
    positions[i * 3] = gaussian.x;
    positions[i * 3 + 1] = gaussian.y;
    positions[i * 3 + 2] = gaussian.z;
    colors[i * 3] = Math.round(gaussian.r);
    colors[i * 3 + 1] = Math.round(gaussian.g);
    colors[i * 3 + 2] = Math.round(gaussian.b);
    scales[i * 3] = gaussian.scale[0];
    scales[i * 3 + 1] = gaussian.scale[1];
    scales[i * 3 + 2] = gaussian.scale[2];
    rotations[i * 4] = gaussian.rotation[0];
    rotations[i * 4 + 1] = gaussian.rotation[1];
    rotations[i * 4 + 2] = gaussian.rotation[2];
    rotations[i * 4 + 3] = gaussian.rotation[3];
    alphas[i] = Math.round(gaussian.a);
    fallbackScale = Math.max(fallbackScale, ...gaussian.scale);
  });

  return encodeSplat({
    positions,
    colors,
    scale: fallbackScale,
    scales,
    rotations,
    alphas,
  });
}
