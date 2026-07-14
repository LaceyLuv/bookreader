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
from services.reading_progress_store import delete_reading_progress

JOURNAL_VERSION = 1
DELETE_PHASES = {
    "intent",
    "file_staged",
    "metadata_deleted",
    "annotations_deleted",
    "progress_deleted",
    "trash_deleted",
}
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


def _relative_path(value: str, *, field: str) -> Path:
    candidate = Path(value)
    if not value or candidate.is_absolute() or ".." in candidate.parts:
        raise RuntimeError(f"Unsafe {field} in delete journal")
    return candidate


def _validate_operations(payload: dict[str, Any], books_dir: Path) -> list[dict[str, Any]]:
    root = books_dir.resolve()
    validated: list[dict[str, Any]] = []
    for operation_key, raw_operation in payload["operations"].items():
        if not isinstance(raw_operation, dict):
            raise RuntimeError(f"Invalid delete operation: {operation_key}")
        book_id = raw_operation.get("book_id")
        if not isinstance(book_id, str) or not book_id or book_id != operation_key:
            raise RuntimeError(f"Invalid book id in delete journal: {operation_key}")
        stored = _relative_path(str(raw_operation.get("stored_filename") or ""), field="stored filename")
        if len(stored.parts) != 1:
            raise RuntimeError(f"Unsafe stored filename in delete journal for {book_id}")
        trash_relative = _relative_path(str(raw_operation.get("trash_name") or ""), field="trash path")
        source = (root / stored).resolve()
        trash = (root / trash_relative).resolve()
        if not source.is_relative_to(root) or not trash.is_relative_to(root) or source == trash:
            raise RuntimeError(f"Unsafe path in delete journal for {book_id}")
        phase = raw_operation.get("phase")
        if phase not in DELETE_PHASES:
            raise RuntimeError(f"Invalid delete phase for {book_id}: {phase}")
        validated.append({**raw_operation, "source": source, "trash": trash})
    return validated


def begin_delete(
    record: dict[str, Any],
    trash_name: str,
    *,
    journal_path: Path = DELETE_JOURNAL_PATH,
) -> dict[str, Any]:
    book_id = str(record["id"])
    stored_filename = Path(str(record["stored_filename"])).name
    trash_relative = _relative_path(trash_name, field="trash path").as_posix()
    operation = {
        "book_id": book_id,
        "stored_filename": stored_filename,
        "trash_name": trash_relative,
        "phase": "intent",
    }
    with _LOCK:
        payload = _read(journal_path)
        existing = payload["operations"].get(book_id)
        if existing is not None:
            if existing.get("stored_filename") != stored_filename:
                raise RuntimeError(f"Conflicting delete operation is already journaled: {book_id}")
            _relative_path(str(existing.get("trash_name") or ""), field="trash path")
            return dict(existing)
        payload["operations"][book_id] = operation
        _write(journal_path, payload)
    return dict(operation)


def mark_delete_phase(book_id: str, phase: str, *, journal_path: Path = DELETE_JOURNAL_PATH) -> None:
    if phase not in DELETE_PHASES:
        raise ValueError(f"Unknown delete phase: {phase}")
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
    delete_progress: Callable[[str], Any] = delete_reading_progress,
) -> list[str]:
    """Finish durable delete intents. Each step is safe to repeat after another crash."""
    with _LOCK:
        payload = _read(journal_path)
        operations = _validate_operations(payload, books_dir)

    recovered: list[str] = []
    root = books_dir.resolve()
    for operation in operations:
        book_id = str(operation["book_id"])
        source = operation["source"]
        trash = operation["trash"]

        if source.exists():
            if trash.exists():
                raise RuntimeError(f"Both source and staged delete file exist for {book_id}")
            trash.parent.mkdir(parents=True, exist_ok=True)
            source.replace(trash)
            _fsync_directory(root)
            _fsync_directory(trash.parent)
        mark_delete_phase(book_id, "file_staged", journal_path=journal_path)
        delete_record(book_id)
        mark_delete_phase(book_id, "metadata_deleted", journal_path=journal_path)
        delete_annotations(book_id)
        mark_delete_phase(book_id, "annotations_deleted", journal_path=journal_path)
        delete_progress(book_id)
        mark_delete_phase(book_id, "progress_deleted", journal_path=journal_path)
        trash.unlink(missing_ok=True)
        mark_delete_phase(book_id, "trash_deleted", journal_path=journal_path)
        _fsync_directory(root)
        _fsync_directory(trash.parent)
        finish_delete(book_id, journal_path=journal_path)
        recovered.append(book_id)
    return recovered
