# @sense-sight/splat-codec

Framework-agnostic TypeScript reader/writer for the `.splat` Gaussian binary
format popularized by [antimatter15/splat](https://github.com/antimatter15/splat)
and used by INRIA-derived Gaussian Splatting tooling. No Three.js, no DOM
dependency beyond standard typed arrays — safe to use in a worker, a Node
script, or a browser renderer.

## Byte layout

A `.splat` file is a flat sequence of fixed-size Gaussian records with **no
header**. Total file size must be a multiple of the record size; the number
of Gaussians is `fileSize / 32`.

Each record is **32 bytes**, **little-endian**, laid out as:

| Bytes   | Field            | Type                | Count | Notes |
|---------|------------------|---------------------|-------|-------|
| 0–11    | position (x,y,z) | `float32`           | 3     | World-space meters |
| 12–23   | scale (x,y,z)    | `float32`           | 3     | Per-axis Gaussian scale, meters |
| 24–27   | color (r,g,b,a)  | `uint8`             | 4     | 0–255 |
| 28–31   | rotation (x,y,z,w) | `uint8`           | 4     | Encoded quaternion, see below |

Field order within a record is fixed: position, then scale, then color,
then rotation. There is no padding between fields or between records.

### Rotation quaternion encoding

The rotation quaternion `(x, y, z, w)` is stored as 4 unsigned bytes rather
than floats. Each component `q` (expected range `-1..1`) is encoded as:

```
byte = round(q * 128 + 128), clamped to [0, 255]
```

and decoded as the inverse affine map (`q = (byte - 128) / 128`) if you need
floating-point quaternion components back. The identity rotation
`(x=0, y=0, z=0, w=1)` therefore encodes to `(128, 128, 128, 255)` — note `w`
encodes to `255`, not `256`, because of the clamp.

### Worked example: implementing a reader in another language

For each consecutive 32-byte chunk of the file:

1. Read 3 little-endian `float32` values → position.
2. Read 3 little-endian `float32` values → scale.
3. Read 4 unsigned bytes → RGBA color, used as-is (0–255).
4. Read 4 unsigned bytes → encoded rotation `(x, y, z, w)`. Decode each with
   `(byte - 128) / 128` if you need a unit quaternion for rendering.

A minimal Python reader:

```python
import struct

RECORD_BYTES = 32

def read_splat(data: bytes):
    assert len(data) % RECORD_BYTES == 0
    count = len(data) // RECORD_BYTES
    for i in range(count):
        o = i * RECORD_BYTES
        x, y, z = struct.unpack_from("<fff", data, o)
        sx, sy, sz = struct.unpack_from("<fff", data, o + 12)
        r, g, b, a = data[o + 24], data[o + 25], data[o + 26], data[o + 27]
        rx, ry, rz, rw = data[o + 28], data[o + 29], data[o + 30], data[o + 31]
        yield (x, y, z), (sx, sy, sz), (r, g, b, a), (rx, ry, rz, rw)
```

## API

```ts
import { decodeSplat, encodeSplat, SPLAT_RECORD_BYTES } from "@sense-sight/splat-codec";
```

### `SPLAT_RECORD_BYTES`

`32`. The fixed per-Gaussian record size.

### `decodeSplat(input: ArrayBuffer | Uint8Array): DecodedSplat`

Parses a `.splat` buffer into typed arrays:

```ts
interface DecodedSplat {
  count: number;
  positions: Float32Array; // length 3 * count, xyz interleaved
  scales: Float32Array;    // length 3 * count, per-axis scale
  colors: Uint8Array;      // length 4 * count, rgba interleaved
  rotations: Uint8Array;   // length 4 * count, encoded quaternion bytes
}
```

Throws if `input.byteLength` is not a multiple of `SPLAT_RECORD_BYTES`.

### `encodeSplat(input: EncodeSplatInput): ArrayBuffer`

Encodes points into a `.splat` buffer. Supports two modes:

- **Isotropic broadcast (simple).** Pass `positions`, `colors`, and a single
  `scale`. Every Gaussian gets that scale on all three axes, the identity
  rotation, and full opacity (alpha `255`). This is the common case for
  rendering a raw point cloud as Gaussians.
- **Full per-Gaussian fidelity.** Additionally pass any of `scales`,
  `rotations`, and/or `alphas` when you have real per-point Gaussian
  parameters (e.g. from a trained 3DGS model). Each is independent: you can
  override just rotations while still broadcasting an isotropic scale, for
  example.

```ts
interface EncodeSplatInput {
  positions: ArrayLike<number>; // 3 * count, xyz interleaved
  colors: ArrayLike<number>;    // 3 * count, rgb interleaved, 0..255
  scale: number;                // isotropic fallback scale (meters)
  scales?: ArrayLike<number>;   // optional 3 * count per-axis scale, overrides `scale`
  rotations?: ArrayLike<number>; // optional 4 * count pre-encoded quaternion bytes
  alphas?: ArrayLike<number>;    // optional count alpha bytes, defaults to 255
}
```

Per-point overrides are only used when the supplied array is long enough to
cover every Gaussian (`scales.length >= count * 3`, `rotations.length >=
count * 4`, `alphas.length >= count`); otherwise the corresponding default
applies to every Gaussian.

## Compatibility

This codec reproduces the canonical antimatter15/INRIA `.splat` byte layout
exactly, so files written here are readable by any compatible viewer or
tool, and files from other compatible writers decode correctly here.
