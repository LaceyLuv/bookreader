from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]

RUNTIME_IGNORE_PROBES = [
    "backend/library.json",
    "backend/library.json.bak",
    "backend/.library.json.tmp",
    "backend/annotations.json",
    "backend/annotations.json.bak",
    "backend/.annotations.json.tmp",
    "backend/reading-progress.json",
    "backend/reading-progress.json.bak",
    "backend/.reading-progress.json.tmp",
    "backend/delete-journal.json",
    "backend/.delete-journal.json.123.tmp",
    "backend/restore-journal.json",
    "backend/.restore-journal.json.tmp",
    "backend/backups/example.bookreader-backup",
    "backend/.restore-sessions/example/state.json",
    "backend/txt-index/example.sqlite3",
]

RUNTIME_PATHSPECS = [
    ":(glob)backend/library.json*",
    ":(glob)backend/.library.json*",
    ":(glob)backend/annotations.json*",
    ":(glob)backend/.annotations.json*",
    ":(glob)backend/reading-progress.json*",
    ":(glob)backend/.reading-progress.json*",
    ":(glob)backend/delete-journal.json*",
    ":(glob)backend/.delete-journal.json*",
    ":(glob)backend/restore-journal.json*",
    ":(glob)backend/.restore-journal.json*",
    ":(glob)backend/backups/**",
    ":(glob)backend/.restore-sessions/**",
    ":(glob)backend/txt-index/**",
]


def _require_git_checkout() -> None:
    if not (ROOT / ".git").exists() or shutil.which("git") is None:
        pytest.skip("Git checkout required for repository hygiene checks")


def test_runtime_store_variants_are_gitignored():
    _require_git_checkout()

    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-z", "--stdin"],
        cwd=ROOT,
        input=("\0".join(RUNTIME_IGNORE_PROBES) + "\0").encode(),
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr.decode(errors="replace")
    ignored = result.stdout.decode().rstrip("\0").split("\0")
    assert ignored == RUNTIME_IGNORE_PROBES


def test_runtime_store_snapshots_are_not_tracked():
    _require_git_checkout()

    result = subprocess.run(
        ["git", "ls-files", "--", *RUNTIME_PATHSPECS],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )

    assert result.stdout.strip() == ""
