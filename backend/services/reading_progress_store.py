from __future__ import annotations

import json
import os
import shutil
import threading
from datetime import datetime, timezone
from typing import Any

from paths import READING_PROGRESS_DATA_PATH

STORE_VERSION = 1
_LOCK = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"version": STORE_VERSION, "progress": {}}


def _backup_path():
    return READING_PROGRESS_DATA_PATH.with_name(READING_PROGRESS_DATA_PATH.name + ".bak")


def _read_file(path):
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or not isinstance(data.get("progress", {}), dict):
        raise ValueError("Invalid reading progress store")
    return {"version": STORE_VERSION, "progress": data.get("progress", {})}


def _read_unlocked():
    if not READING_PROGRESS_DATA_PATH.exists():
        return _empty()
    try:
        return _read_file(READING_PROGRESS_DATA_PATH)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        try:
            recovered = _read_file(_backup_path())
        except (OSError, ValueError, json.JSONDecodeError):
            raise RuntimeError("Unable to read reading progress store or backup") from exc
        _write_unlocked(recovered, keep_backup=False)
        return recovered


def _write_unlocked(data, *, keep_backup=True):
    READING_PROGRESS_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    if keep_backup and READING_PROGRESS_DATA_PATH.exists():
        shutil.copy2(READING_PROGRESS_DATA_PATH, _backup_path())
    temporary = READING_PROGRESS_DATA_PATH.with_name(READING_PROGRESS_DATA_PATH.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump({"version": STORE_VERSION, "progress": data.get("progress", {})}, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(READING_PROGRESS_DATA_PATH)
    try:
        directory_fd = os.open(str(READING_PROGRESS_DATA_PATH.parent), os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        pass


def ensure_reading_progress_store():
    with _LOCK:
        data = _read_unlocked()
        if not READING_PROGRESS_DATA_PATH.exists():
            _write_unlocked(data, keep_backup=False)
        return data


def get_reading_progress(book_id: str):
    with _LOCK:
        record = _read_unlocked()["progress"].get(book_id)
        return dict(record) if isinstance(record, dict) else None


def save_reading_progress(book_id: str, payload: dict[str, Any]):
    with _LOCK:
        data = _read_unlocked()
        record = dict(payload)
        record["version"] = STORE_VERSION
        record["updatedAt"] = record.get("updatedAt") or datetime.now(timezone.utc).isoformat()
        data["progress"][book_id] = record
        _write_unlocked(data)
        return dict(record)


def delete_reading_progress(book_id: str):
    with _LOCK:
        data = _read_unlocked()
        removed = data["progress"].pop(book_id, None)
        if removed is not None:
            _write_unlocked(data)
        return removed is not None
