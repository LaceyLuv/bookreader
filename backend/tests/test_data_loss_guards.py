import json
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main


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


def test_failed_upload_does_not_leave_final_file_record_or_temp_file(tmp_path, monkeypatch):
    from routers import books as books_router
    from services import library_store

    books_dir = tmp_path / "books"
    fonts_dir = tmp_path / "fonts"
    books_dir.mkdir()
    fonts_dir.mkdir()
    library_path = tmp_path / "library.json"
    library_path.write_text(json.dumps({"version": 4, "books": [], "folders": []}), encoding="utf-8")

    monkeypatch.setattr(main, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(main, "FONTS_DIR", fonts_dir)
    monkeypatch.setattr(main, "ensure_annotation_store", lambda: None)
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)
    monkeypatch.setattr(library_store, "uuid4", lambda: SimpleNamespace(hex="failed-upload"))
    monkeypatch.setattr(books_router, "BOOKS_DIR", books_dir)

    async def _fail_after_partial_write(file, destination):
        destination.write_bytes(b"partial")
        destination.with_name(destination.name + ".uploading").write_bytes(b"temp")
        raise OSError("disk full")

    monkeypatch.setattr(books_router, "_save_upload_file", _fail_after_partial_write)

    client = TestClient(main.app, raise_server_exceptions=False)
    response = client.post("/api/books", files={"file": ("broken.txt", b"content", "text/plain")})

    assert response.status_code == 500
    assert list(books_dir.iterdir()) == []
    assert json.loads(library_path.read_text(encoding="utf-8"))["books"] == []


def test_save_upload_file_cleans_temp_file_when_stream_fails(tmp_path):
    from routers import books as books_router

    class FailingUpload:
        filename = "broken.txt"

        def __init__(self):
            self.read_count = 0
            self.closed = False

        async def read(self, size):
            self.read_count += 1
            if self.read_count == 1:
                return b"partial"
            raise OSError("stream interrupted")

        async def close(self):
            self.closed = True

    destination = tmp_path / "book.txt"
    upload = FailingUpload()

    with pytest.raises(OSError):
        asyncio.run(books_router._save_upload_file(upload, destination))

    assert not destination.exists()
    assert list(tmp_path.iterdir()) == []
    assert upload.closed is True


def test_upload_temp_files_are_ignored_during_library_sync(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    library_path.write_text(json.dumps({"version": 4, "books": [], "folders": []}), encoding="utf-8")
    (books_dir / "partial.txt.uploading").write_text("partial", encoding="utf-8")
    (books_dir / "partial.tmp.txt").write_text("partial", encoding="utf-8")
    (books_dir / "partial.partial.txt").write_text("partial", encoding="utf-8")
    (books_dir / "complete.txt").write_text("complete", encoding="utf-8")

    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    store = library_store.ensure_library_store()

    assert [record["stored_filename"] for record in store["books"]] == ["complete.txt"]


def test_delete_book_keeps_forward_recovery_intent_when_annotation_delete_fails(tmp_path, monkeypatch):
    from routers import books as books_router

    book_path = tmp_path / "book.txt"
    book_path.write_text("content", encoding="utf-8")
    record = {
        "id": "book-1",
        "legacy_id": "legacy-1",
        "file_type": "txt",
        "stored_filename": "book.txt",
    }
    deleted_records = []

    monkeypatch.setattr(books_router, "BOOKS_DIR", tmp_path)
    monkeypatch.setattr(books_router, "_delete_journal_path", lambda: tmp_path / "delete-journal.json")
    monkeypatch.setattr(books_router, "get_book_record", lambda book_id: record)
    monkeypatch.setattr(books_router, "get_book_path", lambda item: book_path)
    monkeypatch.setattr(books_router, "delete_book_record", lambda book_id: deleted_records.append(book_id))

    def _fail_annotations(book_id):
        raise OSError("annotation write failed")

    monkeypatch.setattr(books_router, "delete_book_annotations", _fail_annotations)
    monkeypatch.setattr(books_router, "_clear_related_caches", lambda file_type: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(books_router.delete_book("book-1"))

    assert exc_info.value.status_code == 500
    assert not book_path.exists()
    assert list((tmp_path / ".trash").glob("*.trash"))
    assert (tmp_path / "delete-journal.json").exists()
    assert deleted_records == ["book-1"]


def test_delete_book_keeps_forward_recovery_intent_when_library_delete_fails(tmp_path, monkeypatch):
    from routers import books as books_router

    book_path = tmp_path / "book.txt"
    book_path.write_text("content", encoding="utf-8")
    record = {
        "id": "book-1",
        "legacy_id": "legacy-1",
        "file_type": "txt",
        "stored_filename": "book.txt",
    }
    deleted_annotations = []

    monkeypatch.setattr(books_router, "BOOKS_DIR", tmp_path)
    monkeypatch.setattr(books_router, "_delete_journal_path", lambda: tmp_path / "delete-journal.json")
    monkeypatch.setattr(books_router, "get_book_record", lambda book_id: record)
    monkeypatch.setattr(books_router, "get_book_path", lambda item: book_path)
    monkeypatch.setattr(books_router, "delete_book_annotations", lambda book_id: deleted_annotations.append(book_id))

    def _fail_record(book_id):
        raise OSError("library write failed")

    monkeypatch.setattr(books_router, "delete_book_record", _fail_record)
    monkeypatch.setattr(books_router, "_clear_related_caches", lambda file_type: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(books_router.delete_book("book-1"))

    assert exc_info.value.status_code == 500
    assert not book_path.exists()
    assert list((tmp_path / ".trash").glob("*.trash"))
    assert (tmp_path / "delete-journal.json").exists()
    assert deleted_annotations == []


def test_delete_book_does_not_resurrect_metadata_after_annotation_delete_fails(tmp_path, monkeypatch):
    from routers import books as books_router
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    book_path = books_dir / "book.txt"
    book_path.write_text("content", encoding="utf-8")
    original = {
        "version": 4,
        "folders": [],
        "books": [
            {
                "id": "book-1",
                "legacy_id": "legacy-1",
                "title": "Keep me",
                "file_type": "txt",
                "filename": "book.txt",
                "stored_filename": "book.txt",
                "size": 7,
                "upload_date": "2026-01-01T00:00:00",
            }
        ],
    }
    library_path.write_text(json.dumps(original), encoding="utf-8")

    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)
    monkeypatch.setattr(books_router, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(books_router, "_delete_journal_path", lambda: tmp_path / "delete-journal.json")

    def _fail_annotations(book_id):
        raise OSError("annotation write failed")

    monkeypatch.setattr(books_router, "delete_book_annotations", _fail_annotations)
    monkeypatch.setattr(books_router, "_clear_related_caches", lambda file_type: None)

    with pytest.raises(HTTPException):
        asyncio.run(books_router.delete_book("book-1"))

    records = library_store.list_book_records()
    assert records == []
    assert list((books_dir / ".trash").glob("*.trash"))
    assert (tmp_path / "delete-journal.json").exists()


def test_delete_book_commits_progress_and_removes_journal(tmp_path, monkeypatch):
    from routers import books as books_router

    book_path = tmp_path / "book.txt"
    book_path.write_text("content", encoding="utf-8")
    record = {
        "id": "book-1",
        "legacy_id": "legacy-1",
        "file_type": "txt",
        "stored_filename": "book.txt",
    }
    deleted = {"library": [], "annotations": [], "progress": []}

    monkeypatch.setattr(books_router, "BOOKS_DIR", tmp_path)
    monkeypatch.setattr(books_router, "_delete_journal_path", lambda: tmp_path / "delete-journal.json")
    monkeypatch.setattr(books_router, "get_book_record", lambda _book_id: record)
    monkeypatch.setattr(books_router, "get_book_path", lambda _record: book_path)
    monkeypatch.setattr(books_router, "delete_book_record", lambda book_id: deleted["library"].append(book_id))
    monkeypatch.setattr(books_router, "delete_book_annotations", lambda book_id: deleted["annotations"].append(book_id))
    monkeypatch.setattr(books_router, "delete_reading_progress", lambda book_id: deleted["progress"].append(book_id))
    monkeypatch.setattr(books_router, "_clear_related_caches", lambda _file_type: None)

    result = asyncio.run(books_router.delete_book("book-1"))

    assert result == {"detail": "Book deleted"}
    assert deleted == {"library": ["book-1"], "annotations": ["book-1"], "progress": ["book-1"]}
    assert not book_path.exists()
    assert not list((tmp_path / ".trash").glob("*.trash"))
    assert not (tmp_path / "delete-journal.json").exists()


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


def test_corrupt_library_store_recovers_from_valid_backup(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    book_path = books_dir / "book.txt"
    book_path.write_text("content", encoding="utf-8")
    library_path = tmp_path / "library.json"
    backup_payload = {
        "version": 4,
        "books": [
            {
                "id": "book-1",
                "legacy_id": "legacy-1",
                "title": "Recovered",
                "file_type": "txt",
                "filename": "book.txt",
                "stored_filename": "book.txt",
                "size": 7,
                "upload_date": "2026-01-01T00:00:00",
            }
        ],
        "folders": [],
    }
    library_path.write_text("{not json", encoding="utf-8")
    library_path.with_name("library.json.bak").write_text(json.dumps(backup_payload), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    store = library_store.ensure_library_store()

    assert store["books"][0]["id"] == "book-1"
    assert json.loads(library_path.read_text(encoding="utf-8"))["books"][0]["id"] == "book-1"


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


def test_corrupt_annotation_store_recovers_from_valid_backup(tmp_path, monkeypatch):
    from services import annotation_store

    annotations_path = tmp_path / "annotations.json"
    backup_payload = {
        "version": 1,
        "annotations": [
            {
                "id": "annotation-1",
                "book_id": "book-1",
                "kind": "highlight",
                "selected_text": "selected",
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            }
        ],
    }
    annotations_path.write_text("{not json", encoding="utf-8")
    annotations_path.with_name("annotations.json.bak").write_text(json.dumps(backup_payload), encoding="utf-8")
    monkeypatch.setattr(annotation_store, "ANNOTATIONS_DATA_PATH", annotations_path)

    records = annotation_store.list_book_annotations("book-1")

    assert records[0]["id"] == "annotation-1"
    assert json.loads(annotations_path.read_text(encoding="utf-8"))["annotations"][0]["id"] == "annotation-1"


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
