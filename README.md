# SenseSight

[![CI](https://github.com/reachjalil/sense-sight/actions/workflows/ci.yml/badge.svg)](https://github.com/reachjalil/sense-sight/actions/workflows/ci.yml)

SenseSight is an open-source workspace for realtime robot world generation.
It turns live robot sensor streams into explorable 3D spatial memory so a
person can see what the robot sees while the model is forming.

The public site is planned for [sensesight.live](https://sensesight.live).

## Workspace

- `apps/site`: Astro site for the public SenseSight experience, deployed to
  Cloudflare Pages.
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

## Deployment

```bash
pnpm --filter @sense-sight/site deploy
```

The GitHub Actions deployment workflow expects `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets.

## License

Apache-2.0
