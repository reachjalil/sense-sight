/**
 * @sense-sight/viewer — React-Three-Fiber rendering components for point
 * clouds and Gaussian splats. Composable, props-driven primitives that turn
 * `@sense-sight/world-schema` poses, `@sense-sight/stream-buffers` live
 * buffers, and `@sense-sight/splat-codec` `.splat` assets into a Three.js
 * scene. Coupled only to those packages — no app state, no data fetching
 * beyond loading a trained-splat asset by URL.
 */

export * from "./sprite";
export * from "./clouds";
export * from "./primitives";
export * from "./camera";
