import json

import pytest
from fastapi import HTTPException


def test_library_store_preserves_missing_book_records(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    original = {
        "version": 4,
        "folders": [{"id": "folder-1", "name": "Favorites", "created_at": "2026-01-01T00:00:00", "updated_at": "2026-01-01T00:00:00"}],
        "books": [
            {
                "id": "book-1",
                "legacy_id": "legacy-1",
                "title": "User title",
                "author": "User author",
                "file_type": "txt",
                "filename": "missing.txt",
                "stored_filename": "missing.txt",
                "size": 123,
                "upload_date": "2026-01-01T00:00:00",
                "last_opened_at": "2026-01-02T00:00:00",
                "last_read_at": "2026-01-03T00:00:00",
                "reading_status": "reading",
                "favorite": True,
                "pinned": True,
                "tags": ["keep"],
                "collections": ["shelf"],
                "library_folder_id": "folder-1",
                "library_folder_name": "Favorites",
                "series_name": "Series",
                "series_index": 2,
                "duplicate_group": "group-1",
                "version_label": "v1",
                "duplicate_lead": True,
                "content_fingerprint": "abc",
                "content_fingerprint_size": 123,
                "content_fingerprint_mtime_ns": 456,
            }
        ],
    }
    library_path.write_text(json.dumps(original), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    store = library_store.ensure_library_store()

    assert len(store["books"]) == 1
    assert store["books"][0]["id"] == "book-1"
    assert store["books"][0]["title"] == "User title"
    assert store["books"][0]["file_missing"] is True
    persisted = json.loads(library_path.read_text(encoding="utf-8"))
    assert persisted["books"][0]["id"] == "book-1"


def test_library_store_preserves_duplicate_missing_book_records(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    original = {
        "version": 4,
        "folders": [],
        "books": [
            {
                "id": "book-1",
                "legacy_id": "legacy-1",
                "title": "First title",
                "file_type": "txt",
                "filename": "same.txt",
                "stored_filename": "same.txt",
                "size": 1,
                "upload_date": "2026-01-01T00:00:00",
            },
            {
                "id": "book-2",
                "legacy_id": "legacy-2",
                "title": "Second title",
                "file_type": "txt",
                "filename": "same.txt",
                "stored_filename": "same.txt",
                "size": 2,
                "upload_date": "2026-01-02T00:00:00",
            },
        ],
    }
    library_path.write_text(json.dumps(original), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    store = library_store.ensure_library_store()

    assert [record["id"] for record in store["books"]] == ["book-1", "book-2"]
    assert all(record["file_missing"] is True for record in store["books"])


def test_library_store_preserves_missing_book_records_with_unknown_type(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    original = {
        "version": 4,
        "folders": [],
        "books": [
            {
                "id": "book-1",
                "legacy_id": "legacy-1",
                "title": "Mystery",
                "file_type": "pdf",
                "filename": "missing.pdf",
                "stored_filename": "missing.pdf",
                "size": 10,
                "upload_date": "2026-01-01T00:00:00",
            }
        ],
    }
    library_path.write_text(json.dumps(original), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    store = library_store.ensure_library_store()

    assert len(store["books"]) == 1
    assert store["books"][0]["id"] == "book-1"
    assert store["books"][0]["file_type"] == "unknown"
    assert store["books"][0]["file_missing"] is True


def test_resolve_book_file_does_not_delete_missing_book_or_annotations(monkeypatch, tmp_path):
    from routers import books as books_router

    deleted_books = []
    deleted_annotations = []
    record = {
        "id": "book-1",
        "legacy_id": "legacy-1",
        "file_type": "txt",
        "stored_filename": "missing.txt",
    }
    monkeypatch.setattr(books_router, "get_book_record", lambda book_id: record)
    monkeypatch.setattr(books_router, "get_book_path", lambda item: tmp_path / item["stored_filename"])
    monkeypatch.setattr(books_router, "delete_book_record", lambda book_id: deleted_books.append(book_id))
    monkeypatch.setattr(books_router, "delete_book_annotations", lambda book_id: deleted_annotations.append(book_id))
    monkeypatch.setattr(books_router, "_clear_related_caches", lambda file_type: None)

    with pytest.raises(HTTPException) as exc_info:
        books_router._resolve_book_file("book-1")

    assert exc_info.value.status_code == 404
    assert deleted_books == []
    assert deleted_annotations == []


def test_corrupt_library_store_is_not_replaced_with_empty_store(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    book_path = books_dir / "book.txt"
    book_path.write_text("content", encoding="utf-8")
    library_path = tmp_path / "library.json"
    library_path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    with pytest.raises(library_store.StoreCorruptionError):
        library_store.ensure_library_store()

    assert library_path.read_text(encoding="utf-8") == "{not json"


@pytest.mark.parametrize(
    "payload",
    [
        {"version": 4, "books": {}, "folders": []},
        {"version": 4, "books": None, "folders": []},
        {"version": 4, "books": [], "folders": {}},
        {"version": 4, "books": [], "folders": None},
    ],
)
def test_structurally_corrupt_library_store_is_not_replaced(tmp_path, monkeypatch, payload):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    library_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    with pytest.raises(library_store.StoreCorruptionError):
        library_store.ensure_library_store()

    assert json.loads(library_path.read_text(encoding="utf-8")) == payload


def test_corrupt_annotation_store_is_not_replaced_with_empty_store(tmp_path, monkeypatch):
    from services import annotation_store

    annotations_path = tmp_path / "annotations.json"
    annotations_path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(annotation_store, "ANNOTATIONS_DATA_PATH", annotations_path)

    with pytest.raises(annotation_store.StoreCorruptionError):
        annotation_store.create_annotation(
            "book-1",
            {
                "kind": "highlight",
                "selected_text": "selected",
            },
        )

    assert annotations_path.read_text(encoding="utf-8") == "{not json"


@pytest.mark.parametrize(
    "payload",
    [
        {"version": 1, "annotations": {}},
        {"version": 1, "annotations": None},
    ],
)
def test_structurally_corrupt_annotation_store_is_not_replaced(tmp_path, monkeypatch, payload):
    from services import annotation_store

    annotations_path = tmp_path / "annotations.json"
    annotations_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(annotation_store, "ANNOTATIONS_DATA_PATH", annotations_path)

    with pytest.raises(annotation_store.StoreCorruptionError):
        annotation_store.create_annotation(
            "book-1",
            {
                "kind": "highlight",
                "selected_text": "selected",
            },
        )

    assert json.loads(annotations_path.read_text(encoding="utf-8")) == payload
