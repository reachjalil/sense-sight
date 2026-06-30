# Dataset Access

SenseSight's reconstruction pipeline targets the OpenLORIS-Scene corridor
dataset. The prepared dataset is large (tens of GB of RGB-D frames) and is
never committed to this repository.

## Shared local dataset root

If you already have the dataset prepared (for example, alongside a
`human-sense` checkout), point `data/<dataset>` at it instead of downloading
again. Both repos can share one on-disk copy:

```
~/robot-data/sensesight/openloris-gaussian-splat/   # the real, prepared dataset
human-sense/data/openloris-gaussian-splat            -> ~/robot-data/sensesight/openloris-gaussian-splat
sense-sight/data/openloris-gaussian-splat             -> ~/robot-data/sensesight/openloris-gaussian-splat
```

```bash
mkdir -p data
ln -s ~/robot-data/sensesight/openloris-gaussian-splat data/openloris-gaussian-splat
```

`data/` is gitignored here, so the symlink (or a real directory, if you'd
rather keep a local copy) never gets committed.

## `SENSESIGHT_DATA_ROOT`

Tools that need the dataset path read `SENSESIGHT_DATA_ROOT` first and fall
back to `./data/<dataset>` when it's unset:

```bash
export SENSESIGHT_DATA_ROOT=~/robot-data/sensesight/openloris-gaussian-splat
```

Set this in your shell profile or a local (gitignored) `.env` if you keep the
dataset outside this repo's `data/` directory entirely.

## Preparing the dataset from scratch

If you don't have a prepared copy yet:

```bash
pnpm dataset:verify
pnpm dataset:inspect
pnpm dataset:prepare
```

See `packages/dataset-tools` for what each command does and
`packages/robot-world`'s README for the reconstruction pipeline that consumes
the prepared output.
