# splat-io

Dependency-light I/O for Gaussian point clouds. **numpy only** — no torch, no
Open3D, no CUDA.

- Read/write the antimatter15/INRIA **32-byte `.splat`** format (round-trippable).
- Write colored binary **PLY**.
- Estimate a sensible **isotropic Gaussian scale** from point spacing.

```python
from splat_io import write_splat, read_splat, estimate_gaussian_scale

scale = estimate_gaussian_scale(xyz)          # median-NN spacing, clamped
write_splat("scene.splat", xyz, rgb, scale=scale)
gaussians = read_splat("scene.splat")          # verify layout
```

## `.splat` byte layout

Each Gaussian is **32 bytes**, little-endian, in this exact field order:

| Field    | Type             | Bytes | Offset |
| -------- | ---------------- | ----- | ------ |
| position | 3x `float32`     | 12    | 0      |
| scale    | 3x `float32`     | 12    | 12     |
| color    | RGBA 4x `uint8`  | 4     | 24     |
| rotation | quat 4x `uint8`  | 4     | 28     |

A file is simply `N` of these records concatenated — no header, no footer.
File size must be a multiple of 32 bytes; `read_splat` rejects anything else.

Rotation is a unit quaternion `(x, y, z, w)` packed into 4 bytes via
`round(q * 128 + 128)` clamped to `0..255` per component. The identity
rotation `(0, 0, 0, 1)` therefore encodes as `(128, 128, 128, 255)`, which is
what `write_splat` emits by default (point-cloud init has no orientation).

`write_splat` emits one isotropic Gaussian per input point: position = point
xyz, color = point rgb, alpha = 255, scale = the same value on all three axes
unless per-point `scales`/`rotations`/`alpha` overrides are supplied.

This layout pairs byte-for-byte with the TypeScript `@sense-sight/splat-codec`
package, so a cloud written in Python loads identically in the browser viewer.

## Install

```bash
pip install -e ".[test]"
```

## Test

```bash
pytest
```
