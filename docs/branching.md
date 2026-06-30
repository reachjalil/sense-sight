# Branching and Release Flow

## Branches

- `main` is production and deploys to Cloudflare Pages.
- Feature work should use short-lived branches named `codex/<scope>` or
  `feature/<scope>`.
- Dependabot uses its default branch naming.

## Pull Requests

All changes should land through pull requests after the initial scaffold.

Required local checks:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
```

## Deployment

The `Deploy Cloudflare Pages` workflow publishes `apps/site/dist` to the
Cloudflare Pages project `sense-sight` when `main` updates.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Local deployment:

```bash
pnpm --filter @sense-sight/site deploy
```
