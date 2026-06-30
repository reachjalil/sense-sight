"""Bundle fetch + artifact upload for the RunPod splat worker.

``fetch_bundle`` resolves the WorkerInput ``bundle`` object into a local
directory (either an already-mounted RunPod network volume, or a download from
a presigned HTTPS URL), verifying the declared sha256 against what actually
landed on disk. ``upload_artifact`` does the inverse for the trained `.splat`
output: either uploads it to R2 (via boto3, S3-compatible) or returns it
inline as base64 for small preview shards.
"""

from __future__ import annotations

import base64
import hashlib
import os
import tarfile
import zipfile
from pathlib import Path
from typing import Any

import requests

_CHUNK_BYTES = 1024 * 1024


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK_BYTES), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256_dir(path: Path) -> str:
    """Stable sha256 over a directory tree's file contents and relative paths."""
    h = hashlib.sha256()
    for file_path in sorted(path.rglob("*")):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(path).as_posix()
        h.update(rel.encode("utf-8"))
        with file_path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(_CHUNK_BYTES), b""):
                h.update(chunk)
    return h.hexdigest()


def sha256_of(path: Path) -> str:
    """sha256 of a file, or a stable content hash of a directory tree."""
    if path.is_dir():
        return _sha256_dir(path)
    return _sha256_file(path)


def _extract_archive(archive_path: Path, dest_dir: Path) -> Path:
    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path) as zf:
            zf.extractall(dest_dir)
        return dest_dir
    if tarfile.is_tarfile(archive_path):
        with tarfile.open(archive_path) as tf:
            tf.extractall(dest_dir)
        return dest_dir
    return archive_path


def fetch_bundle(bundle: dict[str, Any], dest_dir: Path) -> Path:
    """Resolve ``bundle`` (WorkerInput.bundle, JSON shape) to a local directory.

    ``bundle.mode == "volume"``: ``bundle.volumePath`` is already mounted on
    this worker (RunPod network volume); just resolve it. ``bundle.mode ==
    "r2"``: download ``bundle.uri`` (a presigned HTTPS URL) into ``dest_dir``,
    extracting it if it is an archive. In both cases the resolved path's
    sha256 (file hash, or stable directory-tree hash) is verified against
    ``bundle.sha256``.
    """

    mode = bundle.get("mode")
    declared_sha256 = bundle.get("sha256")

    if mode == "volume":
        volume_path = bundle.get("volumePath")
        if not volume_path:
            raise ValueError("bundle.volumePath is required when bundle.mode == 'volume'")
        resolved = Path(volume_path)
        if not resolved.exists():
            raise FileNotFoundError(f"bundle volumePath does not exist: {resolved}")
    elif mode == "r2":
        uri = bundle.get("uri")
        if not uri:
            raise ValueError("bundle.uri is required when bundle.mode == 'r2'")
        dest_dir.mkdir(parents=True, exist_ok=True)
        archive_path = dest_dir / "bundle.download"
        with requests.get(uri, stream=True, timeout=300) as resp:
            resp.raise_for_status()
            with archive_path.open("wb") as fh:
                for chunk in resp.iter_content(chunk_size=_CHUNK_BYTES):
                    if chunk:
                        fh.write(chunk)
        extract_dir = dest_dir / "bundle"
        extract_dir.mkdir(parents=True, exist_ok=True)
        resolved = _extract_archive(archive_path, extract_dir)
        if resolved == archive_path:
            resolved = archive_path
    else:
        raise ValueError(f"unknown bundle.mode: {mode!r}")

    if declared_sha256:
        actual_sha256 = sha256_of(resolved)
        if actual_sha256 != declared_sha256:
            raise ValueError(
                f"bundle sha256 mismatch: declared={declared_sha256} actual={actual_sha256}"
            )

    return resolved


def _r2_client():
    import boto3

    endpoint_url = os.environ.get("R2_ENDPOINT_URL")
    access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
    secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not (endpoint_url and access_key_id and secret_access_key):
        raise RuntimeError(
            "R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must all be set "
            "for output.mode == 'r2'"
        )
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
    )


def upload_artifact(path: Path, output: dict[str, Any]) -> dict[str, Any]:
    """Publish the trained ``.splat`` at ``path`` per WorkerOutput.artifact.

    Returns a dict shaped like WorkerOutput.artifact:
    ``{mode, splatUri | splatBase64, byteLength, sha256}``.
    """

    mode = output.get("mode")
    byte_length = path.stat().st_size
    sha256 = _sha256_file(path)

    if mode == "r2":
        prefix_uri = output.get("prefixUri")
        if not prefix_uri:
            raise ValueError("output.prefixUri is required when output.mode == 'r2'")
        bucket = os.environ.get("R2_BUCKET")
        if not bucket:
            raise RuntimeError("R2_BUCKET must be set for output.mode == 'r2'")
        key = prefix_uri.rstrip("/") + "/" + path.name
        # prefix_uri may itself already encode a key prefix (no bucket); strip a
        # leading "s3://bucket/" or "r2://bucket/" form defensively.
        for scheme in ("s3://", "r2://"):
            if prefix_uri.startswith(scheme):
                without_scheme = prefix_uri[len(scheme) :]
                _, _, rest = without_scheme.partition("/")
                key = (rest.rstrip("/") + "/" + path.name) if rest else path.name
                break
        client = _r2_client()
        client.upload_file(str(path), bucket, key)
        return {
            "mode": "r2",
            "splatUri": f"{prefix_uri.rstrip('/')}/{path.name}",
            "byteLength": byte_length,
            "sha256": sha256,
        }

    if mode == "return":
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return {
            "mode": "return",
            "splatBase64": encoded,
            "byteLength": byte_length,
            "sha256": sha256,
        }

    raise ValueError(f"unknown output.mode: {mode!r}")
