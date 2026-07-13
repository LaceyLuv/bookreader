from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import quote

from services.backup_service import APP_VERSION


ANNOTATION_EXPORT_SCHEMA = "bookreader.annotation-export"
ANNOTATION_EXPORT_SCHEMA_VERSION = 1

_LOCATION_FIELDS = (
    "locator",
    "locator_v2",
    "page",
    "chapter_index",
    "chapter_title",
    "segment_id",
    "segment_local_start",
    "segment_local_end",
    "start_offset",
    "end_offset",
    "offset_unit",
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _optional_number(value: Any, fallback: int = 2**63 - 1) -> int:
    if isinstance(value, bool):
        return fallback
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number >= 0 else fallback


def _locator_number(locator: Any, *keys: str) -> int | None:
    if not isinstance(locator, dict):
        return None
    for key in keys:
        value = locator.get(key)
        if isinstance(value, bool):
            continue
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if number >= 0:
            return number
    return None


def _reading_order_key(annotation: dict[str, Any]) -> tuple[Any, ...]:
    locator = annotation.get("locator_v2")
    kind = locator.get("kind") if isinstance(locator, dict) else None
    if kind == "epub" or annotation.get("chapter_index") is not None:
        chapter = _locator_number(locator, "chapterIndex")
        text_offset = _locator_number(locator, "textOffset")
        page = _locator_number(locator, "chapterPage", "fallbackPage", "page")
        return (
            0,
            chapter if chapter is not None else _optional_number(annotation.get("chapter_index")),
            text_offset if text_offset is not None else _optional_number(annotation.get("start_offset")),
            page if page is not None else _optional_number(annotation.get("page")),
            str(annotation.get("created_at") or ""),
            str(annotation.get("id") or ""),
        )
    if kind == "txt" or annotation.get("start_offset") is not None or annotation.get("segment_id") is not None:
        start = _locator_number(locator, "sourceOffset", "startOffset", "sourceStartOffset", "offset")
        if start is None:
            start = _optional_number(annotation.get("start_offset"))
        return (
            1,
            start,
            _optional_number(annotation.get("segment_id")),
            _optional_number(annotation.get("page")),
            str(annotation.get("created_at") or ""),
            str(annotation.get("id") or ""),
        )
    if kind == "zip":
        page = _locator_number(locator, "page", "fallbackPage")
        member = str(locator.get("memberName") or "") if isinstance(locator, dict) else ""
        return (
            2,
            page if page is not None else _optional_number(annotation.get("page")),
            member.casefold(),
            str(annotation.get("created_at") or ""),
            str(annotation.get("id") or ""),
        )
    return (
        3,
        _optional_number(annotation.get("page")),
        str(annotation.get("created_at") or ""),
        str(annotation.get("id") or ""),
    )


def _portable_annotation(annotation: dict[str, Any]) -> dict[str, Any]:
    locator_v2 = annotation.get("locator_v2")
    try:
        locator_v2 = json.loads(json.dumps(locator_v2, ensure_ascii=False)) if locator_v2 is not None else None
    except (TypeError, ValueError):
        locator_v2 = None
    legacy = {
        field: annotation.get(field)
        for field in _LOCATION_FIELDS
        if field != "locator_v2"
    }
    annotation_id = str(annotation.get("id") or "")
    book_id = str(annotation.get("book_id") or "")
    return {
        "export_id": f"bookreader:{book_id}:{annotation_id}",
        "id": annotation_id,
        "book_id": book_id,
        "kind": str(annotation.get("kind") or "highlight"),
        "selected_text": str(annotation.get("selected_text") or ""),
        "note_text": annotation.get("note_text"),
        "color": annotation.get("color"),
        "snippet": annotation.get("snippet"),
        "anchor": {
            "status": "unknown",
            "locator_v2": locator_v2,
            "legacy": legacy,
        },
        "created_at": str(annotation.get("created_at") or ""),
        "updated_at": str(annotation.get("updated_at") or ""),
    }


def build_annotation_export(
    book: dict[str, Any],
    annotations: Iterable[dict[str, Any]],
    *,
    exported_at: str | None = None,
) -> dict[str, Any]:
    """Build the stable, portable export model without filesystem-only metadata."""
    ordered = sorted((dict(item) for item in annotations), key=_reading_order_key)
    timestamp = exported_at or _utc_now_iso()
    return {
        "format": "bookreader-annotations",
        "schema": ANNOTATION_EXPORT_SCHEMA,
        "schema_version": ANNOTATION_EXPORT_SCHEMA_VERSION,
        "exported_at": timestamp,
        "generator": {"name": "BookReader", "version": APP_VERSION},
        "book": {
            "id": str(book.get("id") or ""),
            "title": str(book.get("title") or "Untitled"),
            "author": book.get("author"),
            "file_type": str(book.get("file_type") or ""),
            "filename": str(book.get("filename") or ""),
        },
        "annotation_count": len(ordered),
        "annotations": [_portable_annotation(item) for item in ordered],
    }


def render_annotation_json(export: dict[str, Any]) -> str:
    return json.dumps(export, ensure_ascii=False, indent=2) + "\n"


def _markdown_value(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("\x00", "�")


def _markdown_inline(value: Any) -> str:
    text = _markdown_value(value).replace("\n", " ")
    return re.sub(r"([\\`*_{}\[\]()#+.!|<>])", r"\\\1", text)


def _code_block(value: Any) -> list[str]:
    text = _markdown_value(value)
    longest_run = max((len(match.group(0)) for match in re.finditer(r"`+", text)), default=0)
    fence = "`" * max(3, longest_run + 1)
    return [fence, text, fence]


def _location_label(location: dict[str, Any]) -> str:
    chapter_title = location.get("chapter_title")
    chapter_index = location.get("chapter_index")
    page = location.get("page")
    segment_id = location.get("segment_id")
    start_offset = location.get("start_offset")
    locator_v2 = location.get("locator_v2")

    if isinstance(locator_v2, dict):
        if chapter_index is None:
            chapter_index = _locator_number(locator_v2, "chapterIndex")
        if page is None:
            page = _locator_number(locator_v2, "chapterPage", "page", "fallbackPage")
        if segment_id is None:
            segment_id = _locator_number(locator_v2, "segmentId")
        if start_offset is None:
            start_offset = _locator_number(locator_v2, "sourceOffset", "textOffset")

    parts: list[str] = []
    if chapter_title:
        parts.append(str(chapter_title))
    elif chapter_index is not None:
        parts.append(f"Chapter {_optional_number(chapter_index, 0) + 1}")
    if page is not None:
        parts.append(f"Page {_optional_number(page, 0) + 1}")
    if segment_id is not None:
        parts.append(f"Segment {segment_id}")
    if start_offset is not None:
        parts.append(f"Offset {start_offset}")
    if not parts and isinstance(locator_v2, dict) and locator_v2.get("memberName"):
        parts.append(str(locator_v2["memberName"]))
    if not parts and isinstance(locator_v2, dict):
        kind = locator_v2.get("kind")
        if kind:
            parts.append(f"{str(kind).upper()} locator")
    if not parts and location.get("locator"):
        parts.append(str(location["locator"]))
    return " · ".join(parts) or "Saved location"


def render_annotation_markdown(export: dict[str, Any]) -> str:
    book = export.get("book") or {}
    title = _markdown_inline(book.get("title") or "Untitled")
    lines = [
        f"# Notes & highlights — {title}",
        "",
        f"- Exported: {_markdown_inline(export.get('exported_at'))}",
        f"- Format: {_markdown_inline(book.get('file_type')).upper() or 'UNKNOWN'}",
        f"- File: {_markdown_inline(book.get('filename'))}",
        f"- Annotations: {int(export.get('annotation_count') or 0)}",
    ]
    if book.get("author"):
        lines.insert(3, f"- Author: {_markdown_inline(book.get('author'))}")

    annotations = export.get("annotations") or []
    if not annotations:
        lines.extend(["", "_No annotations._", ""])
        return "\n".join(lines)

    for index, annotation in enumerate(annotations, start=1):
        anchor = annotation.get("anchor") or {}
        location = {
            **(anchor.get("legacy") or {}),
            "locator_v2": anchor.get("locator_v2"),
        }
        kind = "Note" if annotation.get("kind") == "note" else "Highlight"
        lines.extend([
            "",
            "---",
            "",
            f"## {index}. {kind} — {_markdown_inline(_location_label(location))}",
            "",
            "**Selected text**",
            "",
            *_code_block(annotation.get("selected_text")),
        ])
        if annotation.get("note_text") is not None:
            lines.extend(["", "**Note**", "", *_code_block(annotation.get("note_text"))])
        if annotation.get("color"):
            lines.extend(["", f"- Color: {_markdown_inline(annotation.get('color'))}"])
        lines.extend([
            f"- Created: {_markdown_inline(annotation.get('created_at'))}",
            f"- Updated: {_markdown_inline(annotation.get('updated_at'))}",
        ])
    lines.append("")
    return "\n".join(lines)


def annotation_export_filename(book: dict[str, Any], export_format: str, exported_at: str | None = None) -> str:
    title = str(book.get("title") or "book").strip()
    safe_title = re.sub(r"[<>:\"/\\|?*\x00-\x1f]+", "-", title).strip(" .-") or "book"
    safe_title = safe_title[:80].rstrip(" .-") or "book"
    suffix = "json" if export_format == "json" else "md"
    date = (exported_at or _utc_now_iso())[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = "export"
    return f"{safe_title}-annotations-{date}.{suffix}"


def annotation_export_disposition(filename: str, book_id: str = "book") -> str:
    suffix = ".json" if filename.lower().endswith(".json") else ".md"
    date_match = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    date = date_match.group(1) if date_match else "export"
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "", str(book_id))[:8] or "book"
    ascii_name = f"BookReader-annotations-{safe_id}-{date}{suffix}"
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename, safe="")}'
