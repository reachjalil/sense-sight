# @sense-sight/render-contracts

Shared rendering contracts for splat and point-cloud world viewers.

This package pins down the layer toggles, render presets, coordinate-frame
handling, trained-render tuning profile, and asset-directory naming contract
that a viewer needs at load time, so rendering stays implementation-free and
swappable between mock, procedural, and trained Gaussian-splat assets. It
depends on `@sense-sight/world-schema` for the `Bounds` type used to describe
a preset's world-space fit.

## Exports

- `RenderLayers` — which optional visual layers a viewer should draw.
- `TrainedRenderProfile` — tunable rasterizer/fallback parameters for a
  trained Gaussian-splat asset.
- `CoordinateFrame` — discriminates which rendering transform a trained splat
  asset needs at load time (`"normalized"` vs `"training-frame"`).
- `RenderPreset` — a named, reproducible rendering configuration.
- `ASSET_FILENAMES` — the asset-directory naming contract a viewer reads
  (`world.json`, `keyframes.json`, `points_xyz.f32`, `points_rgb.u8`,
  `seed.splat`, `training_diagnostics.json`).
- `AssetFilenameKey` — key type over `ASSET_FILENAMES`.
- `PresetAssetManifest` — which asset filenames a preset requires versus may
  optionally provide.
- `trainedSplatFilename(iterations, variant?)` — builds a trained-splat
  filename, e.g. `trained-30000.splat` or `trained-30000-viewer.splat`.
- `DEFAULT_TRAINED_RENDER_PROFILE` — a ready-to-use `TrainedRenderProfile`.

This package should stay dependency-light and renderer-agnostic. Put
durable, viewer-facing rendering contracts here when more than one app or
pipeline needs to agree on the same shape.
