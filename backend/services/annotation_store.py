from __future__ import annotations

import json
import threading
from datetime import datetime
from typing import Any
from uuid import uuid4

from paths import ANNOTATIONS_DATA_PATH

ANNOTATIONS_VERSION = 1
ANNOTATION_KINDS = {"highlight", "note"}
STORE_WRITE_ENCODING = "utf-8"
_STORE_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _normalize_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_nonnegative_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _normalize_color(value: Any) -> str | None:
    text = _normalize_optional_text(value)
    if not text:
        return None
    return text[:32]


def _empty_store() -> dict[str, Any]:
    return {"version": ANNOTATIONS_VERSION, "annotations": []}


def _read_store_unlocked() -> dict[str, Any]:
    if not ANNOTATIONS_DATA_PATH.exists():
        return _empty_store()
    try:
        with ANNOTATIONS_DATA_PATH.open("r", encoding=STORE_WRITE_ENCODING) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return _empty_store()
    if not isinstance(data, dict):
        return _empty_store()
    annotations = data.get("annotations")
    if not isinstance(annotations, list):
        annotations = []
    return {"version": ANNOTATIONS_VERSION, "annotations": annotations}


def _write_store_unlocked(data: dict[str, Any]) -> None:
    payload = {
        "version": ANNOTATIONS_VERSION,
        "annotations": data.get("annotations", []),
    }
    tmp_path = ANNOTATIONS_DATA_PATH.with_suffix(".tmp")
    with tmp_path.open("w", encoding=STORE_WRITE_ENCODING) as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp_path.replace(ANNOTATIONS_DATA_PATH)


def _default_snippet(selected_text: str, note_text: str | None) -> str:
    source = note_text or selected_text
    cleaned = " ".join(source.split())
    return cleaned[:180]


def _normalize_annotation(raw: dict[str, Any]) -> dict[str, Any]:
    kind = str(raw.get("kind") or "highlight").strip().lower()
    if kind not in ANNOTATION_KINDS:
        kind = "highlight"

    selected_text = _normalize_optional_text(raw.get("selected_text")) or ""
    note_text = _normalize_optional_text(raw.get("note_text"))
    start_offset = _normalize_nonnegative_int(raw.get("start_offset"))
    end_offset = _normalize_nonnegative_int(raw.get("end_offset"))
    if start_offset is not None and end_offset is not None and end_offset < start_offset:
        start_offset, end_offset = end_offset, start_offset

    created_at = _normalize_optional_text(raw.get("created_at")) or _now_iso()
    updated_at = _normalize_optional_text(raw.get("updated_at")) or created_at

    return {
        "id": str(raw.get("id") or uuid4().hex[:16]),
        "book_id": str(raw.get("book_id") or "").strip(),
        "kind": kind,
        "locator": _normalize_optional_text(raw.get("locator")),
        "page": _normalize_nonnegative_int(raw.get("page")),
        "chapter_index": _normalize_nonnegative_int(raw.get("chapter_index")),
        "chapter_title": _normalize_optional_text(raw.get("chapter_title")),
        "start_offset": start_offset,
        "end_offset": end_offset,
        "selected_text": selected_text,
        "note_text": note_text,
        "color": _normalize_color(raw.get("color")),
        "snippet": _normalize_optional_text(raw.get("snippet")) or _default_snippet(selected_text, note_text),
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _sync_store_unlocked() -> dict[str, Any]:
    data = _read_store_unlocked()
    annotations = []
    changed = not ANNOTATIONS_DATA_PATH.exists()

    for raw in data.get("annotations", []):
        if not isinstance(raw, dict):
            changed = True
            continue
        normalized = _normalize_annotation(raw)
        if not normalized["book_id"] or not normalized["selected_text"]:
            changed = True
            continue
        if normalized != raw:
            changed = True
        annotations.append(normalized)

    payload = {"version": ANNOTATIONS_VERSION, "annotations": annotations}
    if changed:
        _write_store_unlocked(payload)
    return payload


def ensure_annotation_store() -> dict[str, Any]:
    with _STORE_LOCK:
        return _sync_store_unlocked()


def get_annotation_counts_by_book() -> dict[str, int]:
    with _STORE_LOCK:
        counts = {}
        for annotation in _sync_store_unlocked().get("annotations", []):
            book_id = annotation.get("book_id")
            if not book_id:
                continue
            counts[book_id] = counts.get(book_id, 0) + 1
        return counts


def list_book_annotations(book_id: str) -> list[dict[str, Any]]:
    with _STORE_LOCK:
        records = [
            dict(annotation)
            for annotation in _sync_store_unlocked().get("annotations", [])
            if annotation.get("book_id") == book_id
        ]
    return sorted(records, key=lambda item: (item.get("updated_at") or item.get("created_at") or "", item.get("id") or ""), reverse=True)


def create_annotation(book_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        now_value = _now_iso()
        record = _normalize_annotation(
            {
                **payload,
                "id": uuid4().hex[:16],
                "book_id": book_id,
                "created_at": now_value,
                "updated_at": now_value,
            }
        )
        if not record["selected_text"]:
            raise ValueError("Selected text is required")
        if record["kind"] == "note" and not record["note_text"]:
            raise ValueError("Note text is required")
        annotations = data.get("annotations", [])
        annotations.append(record)
        data["annotations"] = annotations
        _write_store_unlocked(data)
        return dict(record)


def update_annotation(annotation_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        annotations = data.get("annotations", [])
        for index, record in enumerate(annotations):
            if record.get("id") != annotation_id:
                continue
            next_record = dict(record)
            if "note_text" in payload:
                note_text = _normalize_optional_text(payload.get("note_text"))
                if next_record.get("kind") == "note" and not note_text:
                    raise ValueError("Note text is required")
                next_record["note_text"] = note_text
            if "color" in payload:
                next_record["color"] = _normalize_color(payload.get("color"))
            next_record["snippet"] = _default_snippet(next_record.get("selected_text") or "", next_record.get("note_text"))
            next_record["updated_at"] = _now_iso()
            normalized = _normalize_annotation(next_record)
            annotations[index] = normalized
            data["annotations"] = annotations
            _write_store_unlocked(data)
            return dict(normalized)
    return None


def delete_annotation(annotation_id: str) -> dict[str, Any] | None:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        annotations = data.get("annotations", [])
        for index, record in enumerate(annotations):
            if record.get("id") != annotation_id:
                continue
            removed = annotations.pop(index)
            data["annotations"] = annotations
            _write_store_unlocked(data)
            return dict(removed)
    return None


def delete_book_annotations(book_id: str) -> int:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        annotations = data.get("annotations", [])
        next_annotations = [record for record in annotations if record.get("book_id") != book_id]
        removed_count = len(annotations) - len(next_annotations)
        if removed_count > 0:
            data["annotations"] = next_annotations
            _write_store_unlocked(data)
        return removed_count
