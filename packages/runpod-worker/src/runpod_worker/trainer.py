"""Single import surface for the vendored gsplat trainer.

``vendored/`` lives alongside ``src/`` (a sibling directory, not nested under
the ``runpod_worker`` package) so the Docker image and this repo can both
copy/track it as one self-contained, faithfully-ported file
(``packages/runpod-worker/vendored/train_splat.py``). It is not laid out as a
regular installable package, so we resolve it by adding the package root to
``sys.path`` (idempotent) rather than a Python relative import -- adjust this
if you reshape the package layout.
"""

from __future__ import annotations

import sys
from pathlib import Path

_PACKAGE_ROOT = Path(__file__).resolve().parents[2]
if str(_PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_ROOT))

from vendored.train_splat import export_splat, load_colmap, train  # noqa: E402

__all__ = ["export_splat", "load_colmap", "train"]
