export const SPLAT_RECORD_BYTES = 32;

const IDENTITY_ROTATION = [128, 128, 128, 255] as const;

export interface DecodedSplat {
  readonly count: number;
  /** 3 * count, xyz interleaved, meters. */
  readonly positions: Float32Array;
  /** 3 * count, per-axis Gaussian scale, meters. */
  readonly scales: Float32Array;
  /** 4 * count, rgba interleaved, 0..255. */
  readonly colors: Uint8Array;
  /** 4 * count, encoded rotation quaternion bytes (x,y,z,w), 0..255. */
  readonly rotations: Uint8Array;
}

export function decodeSplat(input: ArrayBuffer | Uint8Array): DecodedSplat {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength % SPLAT_RECORD_BYTES !== 0) {
    throw new Error(
      `.splat byte length ${bytes.byteLength} is not a multiple of ${SPLAT_RECORD_BYTES}`
    );
  }

  const count = bytes.byteLength / SPLAT_RECORD_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const rotations = new Uint8Array(count * 4);

  for (let i = 0; i < count; i++) {
    const offset = i * SPLAT_RECORD_BYTES;

    positions[i * 3] = view.getFloat32(offset, true);
    positions[i * 3 + 1] = view.getFloat32(offset + 4, true);
    positions[i * 3 + 2] = view.getFloat32(offset + 8, true);

    scales[i * 3] = view.getFloat32(offset + 12, true);
    scales[i * 3 + 1] = view.getFloat32(offset + 16, true);
    scales[i * 3 + 2] = view.getFloat32(offset + 20, true);

    colors[i * 4] = bytes[offset + 24];
    colors[i * 4 + 1] = bytes[offset + 25];
    colors[i * 4 + 2] = bytes[offset + 26];
    colors[i * 4 + 3] = bytes[offset + 27];

    rotations[i * 4] = bytes[offset + 28];
    rotations[i * 4 + 1] = bytes[offset + 29];
    rotations[i * 4 + 2] = bytes[offset + 30];
    rotations[i * 4 + 3] = bytes[offset + 31];
  }

  return { count, positions, scales, colors, rotations };
}

export interface EncodeSplatInput {
  /** 3 * count, xyz interleaved, meters. */
  readonly positions: ArrayLike<number>;
  /** 3 * count, rgb interleaved, 0..255. */
  readonly colors: ArrayLike<number>;
  /** Isotropic Gaussian scale (meters) applied to all three axes when `scales` is omitted. */
  readonly scale: number;
  /** Optional 3 * count per-axis scale (meters); overrides `scale` per Gaussian when present. */
  readonly scales?: ArrayLike<number>;
  /** Optional 4 * count pre-encoded rotation bytes (x,y,z,w, 0..255); falls back to the identity quaternion per Gaussian when omitted. */
  readonly rotations?: ArrayLike<number>;
  /** Optional count alpha bytes (0..255); falls back to fully opaque (255) per Gaussian when omitted. */
  readonly alphas?: ArrayLike<number>;
}

/**
 * Encodes points as Gaussians. `scales`/`rotations`/`alphas` are optional
 * per-point overrides — omitting all three broadcasts a single isotropic
 * `scale`, the identity rotation, and full opacity across every Gaussian.
 */
export function encodeSplat({
  positions,
  colors,
  scale,
  scales,
  rotations,
  alphas,
}: EncodeSplatInput): ArrayBuffer {
  const count = Math.floor(positions.length / 3);
  if (colors.length < count * 3) {
    throw new Error("colors must hold 3 components per position");
  }

  const hasScales = scales !== undefined && scales.length >= count * 3;
  const hasRotations = rotations !== undefined && rotations.length >= count * 4;
  const hasAlphas = alphas !== undefined && alphas.length >= count;

  const buffer = new ArrayBuffer(count * SPLAT_RECORD_BYTES);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < count; i++) {
    const offset = i * SPLAT_RECORD_BYTES;

    view.setFloat32(offset, positions[i * 3], true);
    view.setFloat32(offset + 4, positions[i * 3 + 1], true);
    view.setFloat32(offset + 8, positions[i * 3 + 2], true);

    if (hasScales) {
      view.setFloat32(offset + 12, (scales as ArrayLike<number>)[i * 3], true);
      view.setFloat32(
        offset + 16,
        (scales as ArrayLike<number>)[i * 3 + 1],
        true
      );
      view.setFloat32(
        offset + 20,
        (scales as ArrayLike<number>)[i * 3 + 2],
        true
      );
    } else {
      view.setFloat32(offset + 12, scale, true);
      view.setFloat32(offset + 16, scale, true);
      view.setFloat32(offset + 20, scale, true);
    }

    bytes[offset + 24] = colors[i * 3] & 0xff;
    bytes[offset + 25] = colors[i * 3 + 1] & 0xff;
    bytes[offset + 26] = colors[i * 3 + 2] & 0xff;
    bytes[offset + 27] = hasAlphas
      ? (alphas as ArrayLike<number>)[i] & 0xff
      : 255;

    if (hasRotations) {
      bytes[offset + 28] = (rotations as ArrayLike<number>)[i * 4] & 0xff;
      bytes[offset + 29] = (rotations as ArrayLike<number>)[i * 4 + 1] & 0xff;
      bytes[offset + 30] = (rotations as ArrayLike<number>)[i * 4 + 2] & 0xff;
      bytes[offset + 31] = (rotations as ArrayLike<number>)[i * 4 + 3] & 0xff;
    } else {
      bytes[offset + 28] = IDENTITY_ROTATION[0];
      bytes[offset + 29] = IDENTITY_ROTATION[1];
      bytes[offset + 30] = IDENTITY_ROTATION[2];
      bytes[offset + 31] = IDENTITY_ROTATION[3];
    }
  }

  return buffer;
}
