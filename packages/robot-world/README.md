# robot-world

Robot sensor stream reconstruction pipeline. Converts OpenLORIS-style RGB-D +
ground-truth pose streams into:

1. a **persistent, chunked, append-only world store** (no monolithic point
   cloud file), and
2. a **COLMAP-format bundle** (`sparse/0/{cameras,images,points3D}.txt`) ready
   to hand to any COLMAP-compatible 3D Gaussian Splatting trainer.

The reconstruction core is **`PointGaussianBackend`**: dependency-light RGB-D
backprojection into the dataset's world frame, producing colored points that
also serve as isotropic 3D Gaussian seeds. An optional **`GsplatBackend`**
seam documents how a real `gsplat`/PyTorch photometric optimizer would plug
in — it is never imported unless both `gsplat` and `torch` are already
installed, so building or testing this package never requires CUDA.

## Layout

```
src/robot_world/
  config.py schemas.py            # pipeline config + core data model
  ingestion/   OpenLORIS dataset adapter, manifest parsing, calibration, depth quality
  pose/        pose provider protocol, robot ground-truth provider, pose selector
  reconstruction/
    keyframes.py                  # motion-gated keyframe selection
    point_gaussian_backend.py     # real RGB-D -> colored point backprojection
    gsplat_backend.py             # optional photometric optimizer seam
    colmap_bundle.py              # COLMAP sparse/0 bundle builder + QA gates
    incremental_updater.py        # append-only world updates
  storage/     chunk_store, world_store, versioning, on-disk schema
  cli/         small focused CLI (validate-dataset, build-colmap-bundle, update-world)
tests/         synthetic-fixture tests (no large dataset required)
```

## Install

This package depends on [`sense-sight-splat-io`](../splat-io) (the `.splat` /
PLY writer) at import time (`storage/chunk_store.py`,
`reconstruction/gsplat_backend.py`). It is an in-repo sibling package, not
published to an index, so `pyproject.toml` does not declare it as an
installable dependency -- install both packages explicitly, in order:

```bash
pip install -e packages/splat-io
pip install -e packages/robot-world

# Or run without installing, via PYTHONPATH (mirrors the convention used by
# this repo's other Python packages):
PYTHONPATH=packages/robot-world/src:packages/splat-io/src \
  python3 -m robot_world.cli.main validate-dataset data/openloris-gaussian-splat
```

## Dataset layout

The pipeline expects the OpenLORIS-Scene layout already present under
`data/openloris-gaussian-splat`:

```
<dataset-root>/
  raw/openloris_package/<sequence>/
    color/<timestamp>.png            # RGB
    aligned_depth/<timestamp>.png    # 16-bit depth, millimeters, aligned to color
  processed/trajectories/<sequence>_frame_manifest.csv
  metadata/<sequence>_camera_intrinsics.json
  metadata/<sequence>_camera_extrinsics.json   # optional; identity if absent
```

The frame manifest is the canonical per-frame join of color path, depth path,
timestamp, and ground-truth pose (`tx,ty,tz,qx,qy,qz,qw`, scalar-last
quaternion, Z-up world frame). `OpenLorisDatasetAdapter.detect()` recognizes
either the raw package layout or a processed-manifests-only layout.

Camera intrinsics fall back to the canonical D435i color intrinsics when the
metadata file is missing. The `base_link -> color-camera` extrinsic falls back
to identity when absent (correct when poses are already camera poses, as in
the synthetic test fixtures).

## Pipeline stages

1. **Ingestion** (`ingestion/openloris_adapter.py`) — detect the dataset,
   list sequences, load the frame manifest, load intrinsics/extrinsics.
2. **Pose selection** (`pose/`) — `RobotPoseProvider` reads the manifest
   ground-truth pose per frame (confidence 1.0); `PoseSelector` arbitrates
   across providers by confidence, keeping the seam open for future pose
   sources without changing call sites.
3. **Keyframe selection** (`reconstruction/keyframes.py`) — walks posed
   frames in time order, accepting a frame once it clears a motion gate
   (minimum translation OR rotation since the last accepted keyframe) or an
   every-Nth fallback, then drops frames with low valid-depth ratio. The
   result is uniformly subsampled to a target/cap if needed.
4. **Backprojection** (`reconstruction/point_gaussian_backend.py`) — for each
   keyframe, samples valid-depth pixels (stratified-grid by default, bounded
   to `points_per_keyframe`), backprojects to the camera frame, then composes
   the `base_link -> camera` extrinsic with the keyframe pose to land points
   in the dataset world frame (Z-up).
5. **Storage** (`storage/`) — `ChunkStore` writes one chunk's points as raw
   little-endian float32 XYZ + uint8 RGB plus a JSON manifest (bounds,
   per-keyframe point spans); `WorldStore` composes `ChunkStore` with an
   append-only `VersionLog` so new chunks are appended without ever rewriting
   prior chunks. `write_trained_chunk` additionally accepts optimized
   per-Gaussian scale/rotation/opacity (e.g. from `GsplatBackend.build`) and
   writes them losslessly as a `.splat` bundle via `splat_io`.
6. **COLMAP bundle** (`reconstruction/colmap_bundle.py`) — re-derives the same
   keyframe set for an arbitrary frame window, writes a standard COLMAP
   `sparse/0` reconstruction plus copied source images, and archives the
   result (`.tar.zst`, falling back to `.tar.gz` if `zstandard` is not
   installed). This is a provider-neutral training **input** preparer: it has
   no opinion about where training later runs.

## Quality gates

`build_colmap_bundle` never raises on a bad bundle; it always returns a
`gate` dict so a caller can inspect *why* a bundle failed before handing it to
a trainer:

- **Reprojection sanity gate** — the seed point cloud is reprojected into a
  sample of up to 6 cameras spread across the bundle; the **mean in-bounds
  fraction must be `>= 0.40`**. A wildly misaligned camera/point set
  reprojects almost nowhere on screen, so this catches broken pose math or a
  keyframe window too wide for the points to stay co-visible.
- **Quaternion round-trip gate** — every stored camera rotation is decoded
  back from its on-disk COLMAP quaternion and compared against the matrix
  that produced it; the **maximum per-camera error must be `<= 1e-6`**. This
  validates the bytes a trainer will actually read, not an in-memory matrix
  that never reaches disk.

`gate.status` is `"pass"` (both checks pass), `"partial"` (quaternion gate
passes but only the best-covered camera clears the mean threshold), or
`"fail"` (quaternion gate fails, or no camera clears the threshold).

## CLI

Every subcommand accepts `--json` for a single machine-readable JSON object on
stdout.

```bash
# Detect + summarize a dataset (optionally inspect one sequence in detail).
robot-world validate-dataset data/openloris-gaussian-splat --sequence corridor1-2 --json

# Build a COLMAP sparse/0 bundle + tarball for a frame window, ready for any
# COLMAP-compatible 3DGS trainer.
robot-world build-colmap-bundle data/openloris-gaussian-splat \
  --sequence corridor1-2 --frame-start 0 --frame-count 360 \
  --max-keyframes 72 --output-dir /tmp/corridor1-2-bundle \
  --seed-point-limit 80000 --json

# Append the next N keyframes into a NEW chunk of a world store (creates the
# world on first call; prior chunks are never rewritten).
robot-world update-world corridor1-2-world \
  --root data/openloris-gaussian-splat --sequence corridor1-2 \
  --store data/openloris-gaussian-splat/processed/world_store \
  --max-frames 40 --json
```

## Follow-ups not implemented here

- **Streaming-friendly viewer export** (e.g. a Y-up, browser-ready point/splat
  artifact) is intentionally out of scope for this package — it belongs in a
  downstream viewer/export package that owns the world<->viewer coordinate
  convention, rather than baked into the reconstruction core.
- `update-world` currently re-derives the dataset's full keyframe set on every
  call and resumes from the previously-consumed offset. For very long
  sequences, a future revision should let a caller pass an already-computed
  keyframe set to avoid repeating that work in a tight polling loop.
