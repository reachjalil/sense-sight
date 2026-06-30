# SenseSight

SenseSight is an open-source workspace for building human-in-the-loop spatial
intelligence tools for robots and embodied systems.

The public site is planned for [sensesight.live](https://sensesight.live).

## Workspace

- `apps/site`: Astro site for the public SenseSight experience.
- `packages/core`: Shared TypeScript contracts for observations, decisions, and
  spatial context.
- `docs`: Architecture, operating model, and contribution guidance.

## Local Development

```bash
pnpm install
pnpm dev
```

## Quality Gates

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
```
