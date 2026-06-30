# @sense-sight/world-schema

Framework-agnostic, dependency-free TypeScript contracts for robot spatial
world models: geometry primitives, pose, sensor streams, reconstructed world
models, and the realtime world-generation pipeline interface.

This is a lower-level type layer than `@sense-sight/core`: it does not
duplicate core's mission-facing `SensorObservation` / `SpatialPose` shapes,
and nothing here is wired into core today. Reach for this package when you
need the richer geometry/pose/sensor/world-model vocabulary that a
reconstruction pipeline, viewer, or dataset adapter operates on.
