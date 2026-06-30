# Architecture

SenseSight is a pnpm/Turbo monorepo.

## Current Packages

- `apps/site`: Astro + React public site and console for `sensesight.live`.
- `packages/core`: app-facing TypeScript contracts for observations, risks,
  decisions, and mission events.
- `packages/world-schema`: dependency-free world, pose, sensor, and pipeline
  contracts.
- `packages/render-contracts`: renderer settings, preset manifests, and asset
  naming contracts.
- `packages/viewer`: React Three Fiber point-cloud and splat rendering
  components.
- `packages/stream-buffers`: allocation-stable buffers for live spatial
  streams.
- `packages/splat-codec`: TypeScript codec for the 32-byte `.splat` Gaussian
  format.
- `packages/splat-io`: Python `.splat` and PLY I/O helpers.
- `packages/robot-world`: Python reconstruction pipeline and COLMAP bundle
  generation.
- `packages/dataset-tools`: pnpm wrappers for dataset verification,
  inspection, and preparation.
- `packages/runpod-orchestrator`: typed RunPod job client, shard planner,
  merge, publish, and state-machine logic.
- `packages/runpod-worker`: CUDA Docker worker for RunPod Gaussian-splat
  training.
- `packages/replay-protocol`: replay stream contracts.

## Direction

The product is focused on realtime robot world generation. The repo should make
it easy to add:

- robot sensor adapters
- frame manifests and pose streams
- point-cloud and Gaussian-splat asset loaders
- semantic labels and spatial annotations
- human review events and audit trails
- Cloudflare storage and realtime APIs
- RunPod and Flash deployment wrappers that keep TypeScript orchestration
  separate from Python/CUDA worker execution

Keep application code inside apps until reuse is clear. Promote stable contracts
or adapters into `packages/` behind focused package boundaries.
