# @sense-sight/dataset-tools

Thin wrapper scripts that shell out to the [`robot-world`](../robot-world)
Python CLI, so the rest of the workspace gets plain `pnpm dataset:*`
commands instead of every contributor remembering `PYTHONPATH` and CLI flags.

## Scripts

- `dataset:verify` — runs `robot-world validate-dataset` against the dataset
  root and exits non-zero if the dataset isn't detected.
- `dataset:inspect` — runs `validate-dataset` with `--sequence corridor1-2`
  for a detailed, single-sequence summary (frame counts, posed-frame counts,
  available modalities).
- `dataset:prepare` — runs `build-colmap-bundle` to produce a COLMAP
  `sparse/0` bundle for `corridor1-2`, ready to hand to a 3D Gaussian
  Splatting trainer.

Run them from the repo root via Turbo/pnpm filtering, or directly:

```bash
pnpm --filter @sense-sight/dataset-tools dataset:verify
pnpm --filter @sense-sight/dataset-tools dataset:inspect
pnpm --filter @sense-sight/dataset-tools dataset:prepare
```

Each script resolves the dataset path from `SENSESIGHT_DATA_ROOT` when set,
falling back to the repo-local `data/openloris-gaussian-splat` symlink. See
[`docs/data.md`](../../docs/data.md) for the full convention, dataset layout,
and how to share one on-disk copy across checkouts.

This package also exports `resolveDatasetRoot()` (`src/index.ts`) so other
TypeScript tooling in the workspace can resolve the same path without
re-deriving the `SENSESIGHT_DATA_ROOT` fallback logic.

## Requirements

These scripts shell out to Python; they assume `packages/robot-world` and its
sibling `packages/splat-io` are present in this checkout (no install step
required — invocation is via `PYTHONPATH`, matching `packages/robot-world`'s
README).
