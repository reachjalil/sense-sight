export interface CloudBuffers {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  /** Capacity in points (positions/colors hold capacity*3 floats). */
  readonly capacity: number;
}

export interface CloudStream {
  /** (Re)allocate the buffers for a scene of `total` points. */
  initCloud(total: number): void;
  /**
   * Append one frame's incremental points. `xyz` are meters (triples); `rgb`
   * are 0..255 triples normalized to 0..1 for `vertexColors`. Returns the new
   * revealed-point count. Points beyond capacity are dropped.
   */
  appendPoints(xyz: readonly number[], rgb: readonly number[]): number;
  /** The live buffers, or null before a scene has been initialized. */
  getBuffers(): CloudBuffers | null;
  /** Points appended so far (the geometry draw range). */
  getRevealed(): number;
  /** Drop the cloud (e.g. on reset). */
  resetCloud(): void;
}

/** Create an isolated incremental point-cloud stream. */
export function createCloudStream(): CloudStream {
  let buffers: CloudBuffers | null = null;
  let revealed = 0;

  return {
    initCloud(total: number): void {
      const capacity = Math.max(0, Math.floor(total));
      buffers = {
        positions: new Float32Array(capacity * 3),
        colors: new Float32Array(capacity * 3),
        capacity,
      };
      revealed = 0;
    },
    appendPoints(xyz: readonly number[], rgb: readonly number[]): number {
      if (!buffers) return revealed;
      const incoming = Math.floor(Math.min(xyz.length, rgb.length) / 3);
      const room = buffers.capacity - revealed;
      const n = Math.min(incoming, room);
      for (let i = 0; i < n; i += 1) {
        const dst = (revealed + i) * 3;
        const src = i * 3;
        buffers.positions[dst] = xyz[src];
        buffers.positions[dst + 1] = xyz[src + 1];
        buffers.positions[dst + 2] = xyz[src + 2];
        buffers.colors[dst] = rgb[src] / 255;
        buffers.colors[dst + 1] = rgb[src + 1] / 255;
        buffers.colors[dst + 2] = rgb[src + 2] / 255;
      }
      revealed += n;
      return revealed;
    },
    getBuffers(): CloudBuffers | null {
      return buffers;
    },
    getRevealed(): number {
      return revealed;
    },
    resetCloud(): void {
      buffers = null;
      revealed = 0;
    },
  };
}

export interface SplatBuffers {
  readonly positions: Float32Array;
  readonly scales: Float32Array;
  /** Quaternion x,y,z,w (capacity*4 floats). */
  readonly rotations: Float32Array;
  /** RGBA bytes (capacity*4). */
  readonly colors: Uint8Array;
  /** Per-splat opacity, 0..1 (capacity floats). */
  readonly opacities: Float32Array;
  /** Capacity in gaussians (positions/scales hold capacity*3 floats). */
  readonly capacity: number;
}

export interface SplatStream {
  /** (Re)allocate the buffers for a scene of `total` trained gaussians. */
  initSplat(total: number): void;
  /**
   * Append one batch's incremental gaussians. `positions`/`scales` are
   * meters (triples); `rotations` are quaternion x,y,z,w (quadruples);
   * `colorsRGBA` are 0..255 quadruples; `opacities` are 0..1. Returns the
   * new revealed-gaussian count. Gaussians beyond capacity are dropped.
   */
  appendGaussians(
    positions: readonly number[],
    scales: readonly number[],
    rotations: readonly number[],
    colorsRGBA: readonly number[],
    opacities: readonly number[]
  ): number;
  /** The live buffers, or null before a scene has been initialized. */
  getBuffers(): SplatBuffers | null;
  /** Gaussians appended so far (the geometry draw range). */
  getRevealed(): number;
  /** Monotonic counter incremented on every appendGaussians call. */
  getVersion(): number;
  /** Drop the splat (e.g. on reset). */
  resetSplat(): void;
}

/** Create an isolated incremental trained-Gaussian-splat stream. */
export function createSplatStream(): SplatStream {
  let buffers: SplatBuffers | null = null;
  let revealed = 0;
  let version = 0;

  return {
    initSplat(total: number): void {
      const capacity = Math.max(0, Math.floor(total));
      buffers = {
        positions: new Float32Array(capacity * 3),
        scales: new Float32Array(capacity * 3),
        rotations: new Float32Array(capacity * 4),
        colors: new Uint8Array(capacity * 4),
        opacities: new Float32Array(capacity),
        capacity,
      };
      revealed = 0;
    },
    appendGaussians(
      positions: readonly number[],
      scales: readonly number[],
      rotations: readonly number[],
      colorsRGBA: readonly number[],
      opacities: readonly number[]
    ): number {
      if (!buffers) return revealed;
      const incoming = Math.min(
        Math.floor(positions.length / 3),
        Math.floor(scales.length / 3),
        Math.floor(rotations.length / 4),
        Math.floor(colorsRGBA.length / 4),
        opacities.length
      );
      const room = buffers.capacity - revealed;
      const n = Math.min(incoming, room);
      for (let i = 0; i < n; i += 1) {
        const dst3 = (revealed + i) * 3;
        const src3 = i * 3;
        buffers.positions[dst3] = positions[src3];
        buffers.positions[dst3 + 1] = positions[src3 + 1];
        buffers.positions[dst3 + 2] = positions[src3 + 2];
        buffers.scales[dst3] = scales[src3];
        buffers.scales[dst3 + 1] = scales[src3 + 1];
        buffers.scales[dst3 + 2] = scales[src3 + 2];

        const dst4 = (revealed + i) * 4;
        const src4 = i * 4;
        buffers.rotations[dst4] = rotations[src4];
        buffers.rotations[dst4 + 1] = rotations[src4 + 1];
        buffers.rotations[dst4 + 2] = rotations[src4 + 2];
        buffers.rotations[dst4 + 3] = rotations[src4 + 3];
        buffers.colors[dst4] = colorsRGBA[src4];
        buffers.colors[dst4 + 1] = colorsRGBA[src4 + 1];
        buffers.colors[dst4 + 2] = colorsRGBA[src4 + 2];
        buffers.colors[dst4 + 3] = colorsRGBA[src4 + 3];

        buffers.opacities[revealed + i] = opacities[i];
      }
      revealed += n;
      version += 1;
      return revealed;
    },
    getBuffers(): SplatBuffers | null {
      return buffers;
    },
    getRevealed(): number {
      return revealed;
    },
    getVersion(): number {
      return version;
    },
    resetSplat(): void {
      buffers = null;
      revealed = 0;
      version = 0;
    },
  };
}
