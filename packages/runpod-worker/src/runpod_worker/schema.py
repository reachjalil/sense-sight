"""WorkerInput / WorkerOutput dataclasses — mirrors the TypeScript contract exactly.

Python fields are snake_case; JSON wire keys are camelCase. ``from_dict``/
``to_dict`` convert between the two so this module is the single place that
encodes the mapping. Keep this in lockstep with the TypeScript side of the
contract — field names, optionality, and literal values must match
byte-for-byte at the JSON level.

Schema version: "1.0.0".
"""

from __future__ import annotations

from dataclasses import dataclass, fields, is_dataclass
from typing import Any, Literal, get_args, get_origin, get_type_hints

SCHEMA_VERSION = "1.0.0"

JobType = Literal[
    "refine_splat_shard", "quality_submap", "full_pass", "online_update"
]
BundleMode = Literal["volume", "r2"]
ShardStrategy = Literal["contiguous_overlap", "modulo"]
QualityPreset = Literal["preview", "balanced", "research"]
OutputMode = Literal["return", "r2"]
WorkerStatus = Literal["completed", "failed"]


def _camel(snake: str) -> str:
    head, *rest = snake.split("_")
    return head + "".join(part.title() for part in rest)


def _to_json(value: Any) -> Any:
    if is_dataclass(value) and not isinstance(value, type):
        out: dict[str, Any] = {}
        for f in fields(value):
            v = getattr(value, f.name)
            if v is None:
                continue
            out[_camel(f.name)] = _to_json(v)
        return out
    if isinstance(value, list):
        return [_to_json(v) for v in value]
    return value


def _from_json(cls: type, data: dict[str, Any]) -> Any:
    hints = get_type_hints(cls)
    kwargs: dict[str, Any] = {}
    for f in fields(cls):
        key = _camel(f.name)
        if key not in data:
            continue
        raw = data[key]
        nested = _unwrap_optional(hints.get(f.name, f.type))
        if raw is not None and isinstance(nested, type) and is_dataclass(nested):
            kwargs[f.name] = _from_json(nested, raw)
        else:
            kwargs[f.name] = raw
    return cls(**kwargs)


def _unwrap_optional(tp: Any) -> Any:
    if get_origin(tp) is not None:
        args = [a for a in get_args(tp) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return tp


@dataclass
class BundleRef:
    mode: BundleMode
    sha256: str
    volume_path: str | None = None
    uri: str | None = None


@dataclass
class ShardSpec:
    index: int
    count: int
    strategy: ShardStrategy
    keyframe_start: int
    keyframe_end: int
    overlap_keyframes: int


@dataclass
class TrainSpec:
    steps: int
    init_scale: float
    prune: float
    quality_preset: QualityPreset
    seed_point_limit: int
    sh_degree: int | None = None
    densify: bool | None = None
    scale_reg_quantile: float | None = None
    mask_dir: str | None = None


@dataclass
class OutputSpec:
    mode: OutputMode
    prefix_uri: str | None = None


@dataclass
class Provenance:
    image_tag: str
    pose_graph_version: str | None = None
    calibration_version: str | None = None
    dynamic_mask_version: str | None = None


@dataclass
class WorkerInput:
    job_type: JobType
    schema_version: str
    world_id: str
    sequence: str
    submap_id: str
    bundle: BundleRef
    shard: ShardSpec
    train: TrainSpec
    output: OutputSpec
    provenance: Provenance

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkerInput":
        return _from_json(cls, data)

    def to_dict(self) -> dict[str, Any]:
        return _to_json(self)


@dataclass
class ShardResult:
    index: int
    count: int
    submap_id: str


@dataclass
class ArtifactResult:
    mode: OutputMode
    byte_length: int
    sha256: str
    splat_base64: str | None = None
    splat_uri: str | None = None


@dataclass
class ScaleStats:
    p50: float
    p90: float
    p99: float
    tail_p99_over_p50: float


@dataclass
class Metrics:
    primitive_count: int
    final_loss: float
    final_l1: float
    scene_scale_m: float
    scale_stats: ScaleStats
    train_seconds: float
    cold_start_seconds: float
    validation_loss: float | None = None


@dataclass
class StageInfo:
    current: str
    fraction: float
    message: str | None = None


@dataclass
class WorkerOutput:
    status: WorkerStatus
    schema_version: str
    shard: ShardResult
    artifact: ArtifactResult
    metrics: Metrics
    stage: StageInfo
    error: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkerOutput":
        return _from_json(cls, data)

    def to_dict(self) -> dict[str, Any]:
        out = _to_json(self)
        out["error"] = self.error
        return out
