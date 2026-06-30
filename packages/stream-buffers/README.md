# @sense-sight/stream-buffers

Incremental, non-allocating buffer management for live point-cloud and
trained-Gaussian-splat reconstructions.

## Why buffers live outside reactive state

A streaming reconstruction can emit hundreds of thousands of points or
gaussians over the life of a session, arriving in a steady stream of small
batches. If each batch were pushed into React (or any other reactive
framework's) state, every message would trigger a state update, a
re-render, and — for typed-array data — a new array allocation and copy. At
streaming rates that turns into a re-render storm and constant garbage
collection pressure, exactly when the renderer most needs a stable frame
budget.

This package avoids that by keeping the data outside the reactive system
entirely:

- `createCloudStream()` and `createSplatStream()` each return a small
  closure-based store that owns plain `TypedArray`s (`Float32Array`,
  `Uint8Array`).
- `initCloud(total)` / `initSplat(total)` pre-allocate those arrays once, to
  a declared capacity. There is no resizing after that — capacity is fixed
  for the life of the stream.
- `appendPoints(...)` / `appendGaussians(...)` write incoming batches
  directly into the next free slice of the existing arrays. No new arrays
  are allocated per call, and nothing already written is copied or moved.
- Anything that would overflow capacity is silently dropped rather than
  throwing or reallocating. A producer that doesn't know the exact final
  size up front can over-provision capacity and stream without ceremony;
  a producer that mis-sizes it loses the excess instead of crashing the
  session.

The renderer never receives "the new points" as a value. Instead it:

1. Calls `getBuffers()` once to get a stable reference to the underlying
   `TypedArray`s (for example, to hand to a `BufferGeometry` attribute).
2. Calls `getRevealed()` to know how much of those buffers is valid right
   now, and uses it to drive the geometry's draw range — so the cloud or
   splat set "paints in" as data arrives instead of popping in all at once.
3. For splats, also calls `getVersion()`, a counter that increments once
   per `appendGaussians` call. The renderer compares the last version it
   painted against the current one to decide whether a repaint is needed,
   instead of relying on object identity or deep-comparing buffer
   contents.

In other words: the buffers are the source of truth, and a small
getter/counter pair (`getRevealed`, `getVersion`) is the only signal a
reactive layer needs to know "something changed, go re-read the buffers."
This keeps the hot path — receiving a batch and writing it into memory —
completely decoupled from whatever UI framework is rendering it, so the
component tree above the renderer can stay simple and re-render only when
it actually needs to (e.g. on mount, or on `getVersion()` changing), never
once per network message.

## Usage

```ts
import { createCloudStream, createSplatStream } from "@sense-sight/stream-buffers";

const cloud = createCloudStream();
cloud.initCloud(50_000);
cloud.appendPoints(xyzBatch, rgbBatch);

const { positions, colors, capacity } = cloud.getBuffers()!;
const revealed = cloud.getRevealed();
// bind `positions`/`colors` directly to a geometry attribute and set the
// draw range to `revealed`; both stay the same array reference for the
// life of the stream.

const splats = createSplatStream();
splats.initSplat(20_000);
splats.appendGaussians(positions, scales, rotations, colorsRGBA, opacities);

const lastVersion = splats.getVersion();
// on each frame/tick, compare splats.getVersion() to lastVersion to decide
// whether to update the draw range and re-upload to the GPU.
```

## API

- `createCloudStream(): CloudStream` — `initCloud`, `appendPoints`,
  `getBuffers`, `getRevealed`, `resetCloud`.
- `createSplatStream(): SplatStream` — `initSplat`, `appendGaussians`,
  `getBuffers`, `getRevealed`, `getVersion`, `resetSplat`.

`CloudBuffers` holds `positions`/`colors` (`Float32Array`, capacity \* 3
floats each). `SplatBuffers` holds `positions`/`scales`
(`Float32Array`, capacity \* 3 floats), `rotations` (`Float32Array`,
capacity \* 4 floats, quaternion x/y/z/w), `colors` (`Uint8Array`, capacity
\* 4 bytes, RGBA), and `opacities` (`Float32Array`, capacity floats, 0..1).
