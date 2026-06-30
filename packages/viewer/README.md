# @sense-sight/viewer

React-Three-Fiber rendering components for point clouds and Gaussian splats —
static assets and live-streaming buffers alike. Drop these into your own
`<Canvas>`:

```tsx
import { Canvas } from "@react-three/fiber";
import {
  SplatPointCloud,
  TrainedSplatCloud,
  SparkTrainedSplatCloud,
  FloorGrid,
  TrajectoryLine,
} from "@sense-sight/viewer";

<Canvas>
  <FloorGrid visible />
  <SplatPointCloud positions={positions} colors={colors} visible />
  <SparkTrainedSplatCloud url="/world/corridor-1/scene.spz" visible />
  <TrajectoryLine points={trajectory} visible />
</Canvas>;
```

Props-driven and store-agnostic; coupled only to `@sense-sight/world-schema`
(types), `@sense-sight/stream-buffers` (live buffer shapes), and
`@sense-sight/splat-codec` (the `.splat` reader). `three`, `react`,
`@react-three/fiber`, and `@react-three/drei` are peers your app already
provides.

## Components

### `SplatPointCloud`

A static colored point cloud rendered as soft splat sprites (a textured
`THREE.Points` with a radial-gradient alpha map), for a one-shot reconstructed
scene that does not change after load.

Props:

- `positions: Float32Array` — interleaved xyz, meters.
- `colors: Float32Array` — interleaved rgb, 0..1.
- `visible: boolean`
- `revealCount?: number` — render only the first N points, for a progressive
  "reconstruction is filling in" reveal animation. Defaults to all points.
- `size?: number` — sprite size in world units (sizeAttenuation on). Default
  `0.075`.
- `opacity?: number` — default `0.95`.

### `StreamedPointCloud`

A live/incremental point cloud bound to externally-owned
`@sense-sight/stream-buffers` `CloudBuffers`. The caller owns and grows the
buffers (via `createCloudStream`); this component binds them directly as
`BufferAttribute`s and only advances the draw range + flags attributes dirty
on each update — no reallocation, no copying.

Props:

- `buffers: CloudBuffers | null` — from `@sense-sight/stream-buffers`.
- `visible: boolean`
- `revealedPoints: number` — current draw-range length, e.g.
  `stream.getRevealed()`.
- `cloudVersion: number` — bump this whenever new points have been appended so
  the component knows to mark attributes `needsUpdate`.
- `size?: number` — default `0.05`.
- `opacity?: number` — default `0.95`.

### `TrainedSplatCloud`

Loads and renders a trained Gaussian-splat `.splat` asset (the
`@sense-sight/splat-codec` 32-byte-per-record format) as soft Gaussian
sprites: a custom `ShaderMaterial` reads per-point size/color/alpha and draws
a screen-space Gaussian falloff. This is a lightweight, dependency-light
viewer path — it does not rasterize full anisotropic covariance ellipses or
depth-sort splats like a native 3DGS renderer. Fails closed: a failed fetch or
decode logs a warning and renders nothing, it never throws into the canvas.

Props:

- `url: string` — fetched and decoded with `decodeSplat` on mount/`url`
  change.
- `visible: boolean`
- `size?: number` — global size multiplier. Default `1`.
- `minAlpha?: number` — drop splats below this alpha byte (0..255) at load
  time. Default `32`.
- `minScale?: number` / `maxScale?: number` — drop splats whose max-axis scale
  (meters) falls outside this range at load time. Defaults `0.00025` /
  `0.04`.
- `maxScreenSize?: number` — clamp on `gl_PointSize` in pixels. Default `28`.
- `alphaPower?: number` — gamma applied to per-splat alpha. Default `1.35`.
- `colorGain?: number` — multiplier applied to splat color before clamping.
  Default `1`.
- `opacity?: number` — global opacity multiplier. Default `0.86`.

### `SparkTrainedSplatCloud`

Renders a trained Gaussian-splat asset through
[`@sparkjsdev/spark`](https://www.npmjs.com/package/@sparkjsdev/spark)'s
native Three.js 3DGS renderer (`SparkRenderer` + `SplatMesh`). Unlike
`TrainedSplatCloud`, this preserves true per-Gaussian orientation, covariance,
opacity, and sorted alpha blending, so prefer it for photoreal inspection.
Keep `TrainedSplatCloud` available as a fallback for assets or environments
Spark can't load.

Props:

- `url: string` — passed straight to `new SplatMesh({ url })`. Supports any
  format Spark can load (`.spz`, `.ply`, `.splat`, ...), not just the local
  `@sense-sight/splat-codec` format.
- `visible: boolean`
- `position?`, `rotation?`, `scale?` — object transform applied to the
  `SplatMesh`. `scale` may be a uniform number or a `[x, y, z]` tuple.
- `opacity?: number` — default `1`.
- `minAlpha?`, `maxPixelRadius?`, `minPixelRadius?`, `maxStdDev?`,
  `focalAdjustment?`, `falloff?`, `sortRadial?` — forwarded to
  `SparkRenderer`; see Spark's docs for tuning splat culling/sorting quality
  vs. performance.
- `onReady?: (mesh: SplatMesh) => void` — called once the mesh finishes
  initializing.
- `onError?: (error: unknown) => void` — called if Spark fails to load the
  asset; the component then renders nothing (fails closed, same as
  `TrainedSplatCloud`).

### `StreamedTrainedSplatCloud`

The live-streaming counterpart to `TrainedSplatCloud`, bound to externally-
owned `@sense-sight/stream-buffers` `SplatBuffers` (via `createSplatStream`)
instead of a fetched `.splat` file. Reuses the same soft-Gaussian-sprite
shader, but reads scale/rotation/color/opacity from per-vertex buffer
attributes that the caller appends to over time (e.g. a live training session
publishing optimized Gaussians incrementally), rather than values baked in at
load time. Binds buffers directly — no reallocation on append.

Props:

- `buffers: SplatBuffers | null` — from `@sense-sight/stream-buffers`.
- `visible: boolean`
- `revealedGaussians: number` — current draw-range length, e.g.
  `stream.getRevealed()`.
- `gaussianVersion: number` — bump on every append so the component marks
  attributes `needsUpdate`, e.g. `stream.getVersion()`.
- `size?: number` — default `1`.
- `maxScreenSize?: number` — default `28`.
- `alphaPower?: number` — default `1.35`.
- `colorGain?: number` — default `1`.
- `opacity?: number` — default `0.86`.

### `FloorGrid`

A reference floor grid for orienting a point cloud or splat scene in space.
Wraps `@react-three/drei`'s `Grid` with an infinite, distance-faded grid tuned
for a robot-scale (meter) scene.

Props:

- `visible: boolean`
- `cellColor?: string` — minor gridline color. Default `"#1c2630"`.
- `sectionColor?: string` — major gridline color (every 4 cells). Default
  `"#3a4b5c"`.

### `TrajectoryLine`

Draws a polyline through a sequence of world-space points — typically the
path a robot or sensor has traveled through the reconstructed world.

Props:

- `points: readonly Vec3[]` — from `@sense-sight/world-schema`. Needs at
  least 2 points to render.
- `visible: boolean`
- `color?: string` — default `"#4fd1ff"`.

### `CameraRig`

Smoothly flies the active camera and its orbit controls' target to a focus
point whenever `focus.version` changes (an ease-in-out lerp over ~0.67s).
Requires `@react-three/fiber`'s `controls` state to be set to an
orbit-controls-like object exposing `target` and `update()` (e.g. drei's
`OrbitControls` with `makeDefault`).

Props:

- `focus: { target: Vec3; version: number }` — bump `version` to trigger a new
  fly-to; `target` is the new world-space focus point.

### `FirstPersonCamera`

Drives the active camera from a streamed pose + heading, for a first-person
"ride along with the sensor" view. Smoothly lerps position and look-at target
every frame rather than snapping.

Props:

- `pos: Vec3` — world-space eye position (x/z used directly; y is overridden
  by `eyeHeight`).
- `heading: number` — yaw in radians.
- `eyeHeight?: number` — default `0.9`.

### `useSplatSprite` / `createSplatSprite`

The radial-gradient sprite texture used by `SplatPointCloud` and
`StreamedPointCloud` to make raw `THREE.Points` read as soft splats instead of
hard squares. `createSplatSprite` builds a fresh `THREE.CanvasTexture` from a
list of `GradientStop`s; `useSplatSprite` memoizes it for use inside an R3F
component. Two stop presets are exported: `DEFAULT_SPLAT_STOPS` (dense opaque
core, quick falloff — reads as defined surface splats) and
`SOFT_SPLAT_STOPS` (broader halo, for first-person / sparse previews).

## What's not here

`primitives.tsx` in the reference implementation this package was ported from
also held operator-console-specific components — risk zone overlays,
annotation markers, route paths, click-to-place waypoints, and a robot
marker. Those are decision/operator-product concerns, not "render what the
robot sees," so they were intentionally not ported. `FloorGrid` and
`TrajectoryLine` were kept because they're generic to any spatial viewer:
a ground reference grid and "draw the path a sensor traveled" apply equally
to a bare viewer with no operator workflow attached.

## Testing

This package intentionally ships no automated tests. Every export here is
rendering code that needs a live DOM + WebGL context (canvas, texture
creation, shader compilation) to exercise meaningfully; a unit test would
either mock so much of `three`/`@react-three/fiber` that it stops verifying
anything real, or require a headless-GL harness that isn't worth the
complexity for this package's surface area yet. Verify changes by running a
consuming app's dev server and inspecting the canvas.
