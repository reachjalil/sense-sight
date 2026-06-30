# Contributing

Thanks for helping improve SenseSight.

## Development

```bash
pnpm install
pnpm dev
```

Before opening a pull request, run:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
```

## Pull Requests

- Keep changes scoped and reviewable.
- Add or update tests when shared behavior changes.
- Keep durable product or architecture decisions in `docs/`.
- Prefer package-local code until reuse is clear.
- Use `@sense-sight/*` for internal packages.

## Product Direction

SenseSight focuses on realtime robot world generation:

- live robot sensor streams
- explorable 3D spatial memory
- Gaussian-splat-ready reconstruction paths
- human-in-the-loop review as a trust boundary

Avoid generic AI-dashboard language. The product promise is that a person can
see what the robot sees while the world model is forming.
