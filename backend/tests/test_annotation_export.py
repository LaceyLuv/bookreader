from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import annotations as annotations_router
from services.annotation_export_service import build_annotation_export, render_annotation_markdown


BOOK = {
    "id": "book-1",
    "title": "한국어: Book / One",
    "author": "Author",
    "file_type": "txt",
    "filename": "original-display.txt",
    "stored_filename": "book-1-private.txt",
    "path": "C:/Users/private/book-1-private.txt",
}

ANNOTATIONS = [
    {
        "id": "later",
        "book_id": "book-1",
        "kind": "note",
        "selected_text": "두 번째\n문장",
        "note_text": "메모 내용",
        "color": "rgba(1, 2, 3, 0.4)",
        "snippet": "두 번째 문장",
        "locator": "segment:4:offset:20",
        "locator_v2": {"version": 2, "kind": "txt", "sourceOffset": 200, "sourceEndOffset": 207},
        "page": 3,
        "chapter_index": None,
        "chapter_title": None,
        "segment_id": 4,
        "segment_local_start": 20,
        "segment_local_end": 27,
        "start_offset": 200,
        "end_offset": 207,
        "offset_unit": "unicode-code-point-v1",
        "created_at": "2026-07-13T12:00:00",
        "updated_at": "2026-07-13T12:01:00",
    },
    {
        "id": "earlier",
        "book_id": "book-1",
        "kind": "highlight",
        "selected_text": "first quote",
        "note_text": None,
        "color": "#ffee00",
        "snippet": "first quote",
        "locator": "segment:1:offset:2",
        "locator_v2": {"version": 2, "kind": "txt", "sourceOffset": 20, "sourceEndOffset": 31},
        "page": 0,
        "chapter_index": None,
        "chapter_title": None,
        "segment_id": 1,
        "segment_local_start": 2,
        "segment_local_end": 13,
        "start_offset": 20,
        "end_offset": 31,
        "offset_unit": "unicode-code-point-v1",
        "created_at": "2026-07-13T11:00:00",
        "updated_at": "2026-07-13T11:00:00",
    },
]


def test_json_export_is_versioned_lossless_ordered_and_excludes_private_paths():
    payload = build_annotation_export(BOOK, ANNOTATIONS, exported_at="2026-07-13T00:00:00+00:00")

    assert payload["schema"] == "bookreader.annotation-export"
    assert payload["schema_version"] == 1
    assert [item["id"] for item in payload["annotations"]] == ["earlier", "later"]
    assert payload["annotations"][1]["selected_text"] == "두 번째\n문장"
    assert payload["annotations"][1]["note_text"] == "메모 내용"
    assert payload["format"] == "bookreader-annotations"
    assert payload["generator"] == {"name": "Gyeol Reader", "version": "0.1.1"}
    assert payload["annotations"][1]["anchor"]["status"] == "unknown"
    assert payload["annotations"][1]["anchor"]["locator_v2"]["sourceOffset"] == 200
    assert payload["annotations"][1]["anchor"]["legacy"]["start_offset"] == 200
    assert payload["annotations"][1]["export_id"] == "bookreader:book-1:later"
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "stored_filename" not in serialized
    assert "C:/Users/private" not in serialized
    assert payload["book"]["filename"] == "original-display.txt"


def test_markdown_export_contains_quotes_notes_location_color_and_timestamps():
    payload = build_annotation_export(BOOK, ANNOTATIONS, exported_at="2026-07-13T00:00:00+00:00")
    markdown = render_annotation_markdown(payload)

    assert "# Notes & highlights — 한국어: Book / One" in markdown
    assert "```\n두 번째\n문장\n```" in markdown
    assert "```\n메모 내용\n```" in markdown
    assert "rgba\\(1, 2, 3, 0\\.4\\)" in markdown
    assert "2026-07-13T12:01:00" in markdown
    assert "sourceOffset" not in markdown
    assert "Annotation ID" not in markdown
    assert "book-1-private.txt" not in markdown
    assert "C:/Users/private" not in markdown


def test_export_api_sets_safe_download_headers_and_supports_empty_exports(monkeypatch):
    monkeypatch.setattr(annotations_router, "get_book_record", lambda _book_id: BOOK)
    monkeypatch.setattr(annotations_router, "list_book_annotations", lambda _book_id: [])
    app = FastAPI()
    app.include_router(annotations_router.router)

    with TestClient(app) as client:
        json_response = client.get("/api/books/book-1/annotations/export?format=json")
        markdown_response = client.get("/api/books/book-1/annotations/export?format=markdown")

    assert json_response.status_code == 200
    assert json_response.json()["annotations"] == []
    assert json_response.headers["cache-control"] == "no-store, max-age=0"
    assert 'filename="Gyeol-annotations-book-1-2026-07-13.json"' in json_response.headers["content-disposition"]
    assert "filename*=UTF-8''" in json_response.headers["content-disposition"]
    assert json_response.headers["content-type"].startswith("application/json")
    assert markdown_response.status_code == 200
    assert "_No annotations._" in markdown_response.text
    assert markdown_response.headers["content-type"].startswith("text/markdown")


def test_export_api_rejects_unknown_format_and_missing_book(monkeypatch):
    monkeypatch.setattr(annotations_router, "get_book_record", lambda _book_id: None)
    app = FastAPI()
    app.include_router(annotations_router.router)

    with TestClient(app) as client:
        missing = client.get("/api/books/missing/annotations/export?format=json")
        invalid = client.get("/api/books/missing/annotations/export?format=csv")

    assert missing.status_code == 404
    assert invalid.status_code == 422


def test_markdown_escapes_structure_and_uses_a_fence_longer_than_user_backticks():
    payload = build_annotation_export(
        {**BOOK, "title": "# [Unsafe](javascript:alert(1))"},
        [{**ANNOTATIONS[0], "selected_text": "```\n<img src=x onerror=alert(1)>"}],
        exported_at="2026-07-13T00:00:00+00:00",
    )

    markdown = render_annotation_markdown(payload)

    assert "# Notes & highlights — \\# \\[Unsafe\\]\\(javascript:alert\\(1\\)\\)" in markdown
    assert "````\n```\n<img src=x onerror=alert(1)>\n````" in markdown
    assert "Chapter" not in markdown
    assert "Offset 200" in markdown
