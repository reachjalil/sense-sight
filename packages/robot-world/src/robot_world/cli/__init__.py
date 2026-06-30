"""Command-line interface for the robot-world reconstruction pipeline.

Intentionally does not import `.main` here: this package is invoked both as
`python -m robot_world.cli.main` and via the `robot-world` console-script
entry point (`robot_world.cli.main:main`); eagerly importing `main` in this
`__init__` would register it in `sys.modules` under two different names and
trigger Python's "module already imported" `RuntimeWarning` on `-m` runs.
"""

from __future__ import annotations
