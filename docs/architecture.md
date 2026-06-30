# Architecture

SenseSight is a pnpm/Turbo monorepo.

## Current Packages

- `apps/site`: Astro marketing site for `sensesight.live`.
- `packages/core`: shared TypeScript contracts for observations, risks,
  decisions, and mission events.

## Direction

The product is focused on realtime robot world generation. The repo should make
it easy to add:

- robot sensor adapters
- frame manifests and pose streams
- point-cloud and Gaussian-splat asset loaders
- semantic labels and spatial annotations
- human review events and audit trails
- Cloudflare storage and realtime APIs

Keep application code inside apps until reuse is clear. Promote stable contracts
or adapters into `packages/` behind focused package boundaries.
