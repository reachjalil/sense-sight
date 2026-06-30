"""World versioning.

Append-only version log. Each published version records the chunk set and
point total at that epoch so a reader can pin a consistent snapshot. Versions
are monotonically increasing integers; ``world.json`` always points at the
latest.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from ..schemas import now_iso


@dataclass
class WorldVersion:
    version: int
    created_at: str
    chunk_ids: list[int]
    point_total: int
    keyframe_count: int
    note: str = ""
    trained_chunk_ids: list[int] | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class VersionLog:
    versions: list[WorldVersion] = field(default_factory=list)

    @property
    def latest(self) -> WorldVersion | None:
        return self.versions[-1] if self.versions else None

    def next_version(self) -> int:
        return (self.latest.version + 1) if self.latest else 1

    def append(
        self,
        chunk_ids: list[int],
        point_total: int,
        keyframe_count: int,
        note: str = "",
        trained_chunk_ids: list[int] | None = None,
    ) -> WorldVersion:
        ver = WorldVersion(
            version=self.next_version(),
            created_at=now_iso(),
            chunk_ids=list(chunk_ids),
            point_total=point_total,
            keyframe_count=keyframe_count,
            note=note,
            trained_chunk_ids=(
                list(trained_chunk_ids) if trained_chunk_ids is not None else None
            ),
        )
        self.versions.append(ver)
        return ver

    def to_dict(self) -> dict:
        return {"versions": [v.to_dict() for v in self.versions]}

    @classmethod
    def from_dict(cls, data: dict) -> "VersionLog":
        return cls(versions=[WorldVersion(**v) for v in data.get("versions", [])])
