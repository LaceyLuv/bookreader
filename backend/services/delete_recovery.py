from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from paths import BOOKS_DIR, DELETE_JOURNAL_PATH
from services.annotation_store import delete_book_annotations
from services.library_store import delete_book_record

JOURNAL_VERSION = 1
_LOCK = threading.Lock()


def _fsync_directory(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _read(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": JOURNAL_VERSION, "operations": {}}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if payload.get("version") != JOURNAL_VERSION or not isinstance(payload.get("operations"), dict):
        raise RuntimeError(f"Invalid delete journal: {path}")
    return payload


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def begin_delete(record: dict[str, Any], trash_name: str, *, journal_path: Path = DELETE_JOURNAL_PATH) -> None:
    book_id = str(record["id"])
    operation = {
        "book_id": book_id,
        "stored_filename": Path(str(record["stored_filename"])).name,
        "trash_name": Path(trash_name).name,
        "phase": "intent",
    }
    with _LOCK:
        payload = _read(journal_path)
        payload["operations"][book_id] = operation
        _write(journal_path, payload)


def mark_delete_phase(book_id: str, phase: str, *, journal_path: Path = DELETE_JOURNAL_PATH) -> None:
    with _LOCK:
        payload = _read(journal_path)
        operation = payload["operations"].get(book_id)
        if operation is None:
            raise RuntimeError(f"Delete operation is not journaled: {book_id}")
        operation["phase"] = phase
        _write(journal_path, payload)


def finish_delete(book_id: str, *, journal_path: Path = DELETE_JOURNAL_PATH) -> None:
    with _LOCK:
        payload = _read(journal_path)
        payload["operations"].pop(book_id, None)
        if payload["operations"]:
            _write(journal_path, payload)
        else:
            journal_path.unlink(missing_ok=True)
            _fsync_directory(journal_path.parent)


def recover_pending_deletes(
    *,
    books_dir: Path = BOOKS_DIR,
    journal_path: Path = DELETE_JOURNAL_PATH,
    delete_record: Callable[[str], Any] = delete_book_record,
    delete_annotations: Callable[[str], Any] = delete_book_annotations,
) -> list[str]:
    """Finish durable delete intents. Each step is safe to repeat after another crash."""
    with _LOCK:
        payload = _read(journal_path)
        operations = list(payload["operations"].values())

    recovered: list[str] = []
    root = books_dir.resolve()
    for operation in operations:
        book_id = str(operation["book_id"])
        source = (root / Path(str(operation["stored_filename"])).name).resolve()
        trash = (root / Path(str(operation["trash_name"])).name).resolve()
        if source.parent != root or trash.parent != root:
            raise RuntimeError(f"Unsafe path in delete journal for {book_id}")

        if source.exists():
            if trash.exists():
                raise RuntimeError(f"Both source and staged delete file exist for {book_id}")
            source.replace(trash)
            _fsync_directory(root)
        delete_record(book_id)
        delete_annotations(book_id)
        trash.unlink(missing_ok=True)
        _fsync_directory(root)
        finish_delete(book_id, journal_path=journal_path)
        recovered.append(book_id)
    return recovered
