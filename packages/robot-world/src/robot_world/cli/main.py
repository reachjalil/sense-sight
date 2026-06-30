"""Command-line interface for the robot_world reconstruction pipeline.

Subcommands (each supports ``--json`` for a single machine-readable object):

  validate-dataset <root> [--sequence S] [--json]
  build-colmap-bundle <root> --sequence S --frame-start N --frame-count N
              --max-keyframes N --output-dir DIR [--seed-point-limit N]
              [--json]
  update-world <world_id> --root <root> --store <dir> --repo-root <dir>
              [--max-frames N] [--json]

The dataset root (where image/depth paths resolve) is the positional ``root``
argument; pass ``--repo-root`` to override the path-resolution fallback root
when image/depth paths are stored relative to something other than the
dataset root.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..config import PipelineConfig
from ..ingestion.openloris_adapter import OpenLorisDatasetAdapter
from ..reconstruction.colmap_bundle import build_colmap_bundle
from ..reconstruction.incremental_updater import IncrementalUpdater
from ..schemas import CameraIntrinsics
from ..storage.world_store import WorldStore


def _emit(obj: dict, as_json: bool) -> None:
    if as_json:
        sys.stdout.write(json.dumps(obj) + "\n")
    else:
        sys.stdout.write(json.dumps(obj, indent=2) + "\n")


def cmd_validate_dataset(args: argparse.Namespace) -> int:
    adapter = OpenLorisDatasetAdapter(args.root)
    summary = adapter.summary()
    out: dict = {"command": "validate-dataset", **summary.to_dict()}

    if args.sequence:
        if args.sequence in summary.sequences:
            frames = adapter.load_frames(args.sequence)
            posed = sum(1 for f in frames if f.has_pose)
            out["sequence_detail"] = {
                "sequence": args.sequence,
                "frame_count": len(frames),
                "posed_frame_count": posed,
                "modalities": adapter.sequence_modalities(args.sequence),
            }
            out["ok"] = True
        else:
            out["ok"] = False
            out["error"] = f"sequence {args.sequence!r} not found"
    else:
        out["ok"] = summary.detected

    if not args.json:
        adapter.print_summary()
    _emit(out, args.json)
    return 0 if out["ok"] else 1


def cmd_build_colmap_bundle(args: argparse.Namespace) -> int:
    result = build_colmap_bundle(
        dataset_root=args.root,
        sequence=args.sequence,
        frame_start=args.frame_start,
        frame_count=args.frame_count,
        max_keyframes=args.max_keyframes,
        output_dir=args.output_dir,
        seed_point_limit=args.seed_point_limit,
    )
    out = {
        "command": "build-colmap-bundle",
        "ok": bool((result.get("gate") or {}).get("passed")),
        **result,
    }
    _emit(out, args.json)
    return 0 if out["ok"] else 1


def cmd_update_world(args: argparse.Namespace) -> int:
    store = WorldStore(args.store)
    repo_root = Path(args.repo_root) if args.repo_root else Path(args.root)

    if not store.exists(args.world_id):
        adapter = OpenLorisDatasetAdapter(args.root)
        intrinsics: CameraIntrinsics = adapter.load_intrinsics(args.sequence)
        cfg = PipelineConfig()
        store.create(
            world_id=args.world_id,
            sequence=args.sequence,
            source_dataset=adapter.dataset_name,
            intrinsics=intrinsics,
            config_hash=cfg.config_hash(),
        )

    adapter = OpenLorisDatasetAdapter(args.root)
    updater = IncrementalUpdater(adapter, repo_root, PipelineConfig())
    result = updater.update_world(args.world_id, store, max_frames=args.max_frames)
    out = {"command": "update-world", "ok": True, **result.to_dict()}
    _emit(out, args.json)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="robot-world", description="Robot sensor stream reconstruction pipeline."
    )
    sub = parser.add_subparsers(dest="subcommand", required=True)

    p_val = sub.add_parser("validate-dataset", help="Detect and summarize a dataset.")
    p_val.add_argument("root", help="Dataset root directory.")
    p_val.add_argument("--sequence", help="Inspect a single sequence in detail.")
    p_val.add_argument("--json", action="store_true", help="Emit a single JSON object.")
    p_val.set_defaults(func=cmd_validate_dataset)

    p_bundle = sub.add_parser(
        "build-colmap-bundle",
        help="Build a COLMAP sparse/0 bundle for 3DGS training.",
    )
    p_bundle.add_argument("root", help="Dataset root directory.")
    p_bundle.add_argument("--sequence", required=True, help="Sequence id.")
    p_bundle.add_argument("--frame-start", type=int, required=True)
    p_bundle.add_argument("--frame-count", type=int, required=True)
    p_bundle.add_argument("--max-keyframes", type=int, required=True)
    p_bundle.add_argument("--output-dir", required=True)
    p_bundle.add_argument("--seed-point-limit", type=int, default=80_000)
    p_bundle.add_argument("--json", action="store_true", help="Emit a single JSON object.")
    p_bundle.set_defaults(func=cmd_build_colmap_bundle)

    p_upd = sub.add_parser(
        "update-world", help="Append the next N keyframes into a new chunk."
    )
    p_upd.add_argument("world_id", help="World id to update (created if absent).")
    p_upd.add_argument("--root", required=True, help="Dataset root directory.")
    p_upd.add_argument("--sequence", required=True, help="Sequence id (for world creation).")
    p_upd.add_argument("--store", required=True, help="World store base directory.")
    p_upd.add_argument(
        "--repo-root",
        help="Fallback root for image/depth path resolution (defaults to --root).",
    )
    p_upd.add_argument("--max-frames", type=int, default=40)
    p_upd.add_argument("--json", action="store_true", help="Emit a single JSON object.")
    p_upd.set_defaults(func=cmd_update_world)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
