import json

import pytest


def _book_record(book_id: str, filename: str, folder_id=None, folder_name=None):
    return {
        "id": book_id,
        "legacy_id": f"legacy-{book_id}",
        "title": book_id,
        "file_type": "txt",
        "filename": filename,
        "stored_filename": filename,
        "size": 4,
        "upload_date": "2026-01-01T00:00:00",
        "library_folder_id": folder_id,
        "library_folder_name": folder_name,
    }


def _prepare_store(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    (books_dir / "one.txt").write_text("one", encoding="utf-8")
    (books_dir / "two.txt").write_text("two", encoding="utf-8")
    library_path = tmp_path / "library.json"
    payload = {
        "version": 4,
        "folders": [
            {
                "id": "folder-1",
                "name": "Shelf",
                "created_at": "2026-01-01T00:00:00",
                "updated_at": "2026-01-01T00:00:00",
            }
        ],
        "books": [
            _book_record("book-1", "one.txt"),
            _book_record("book-2", "two.txt", "folder-1", "Shelf"),
        ],
    }
    library_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)
    return library_store, library_path


def test_delete_folder_clears_book_references(tmp_path, monkeypatch):
    library_store, library_path = _prepare_store(tmp_path, monkeypatch)

    result = library_store.delete_folder_record("folder-1")

    assert result["cleared_books"] == 1
    persisted = json.loads(library_path.read_text(encoding="utf-8"))
    assert persisted["folders"] == []
    book_two = next(record for record in persisted["books"] if record["id"] == "book-2")
    assert book_two["library_folder_id"] is None
    assert book_two["library_folder_name"] is None


def test_assign_books_to_folder_rejects_unknown_folder_id(tmp_path, monkeypatch):
    library_store, _ = _prepare_store(tmp_path, monkeypatch)

    with pytest.raises(ValueError, match="Library folder not found"):
        library_store.assign_books_to_folder(["book-1"], "missing-folder")


def test_assign_books_to_folder_rejects_unknown_book_id_without_partial_update(tmp_path, monkeypatch):
    library_store, library_path = _prepare_store(tmp_path, monkeypatch)

    with pytest.raises(ValueError, match="Book not found"):
        library_store.assign_books_to_folder(["book-1", "missing-book"], "folder-1")

    persisted = json.loads(library_path.read_text(encoding="utf-8"))
    book_one = next(record for record in persisted["books"] if record["id"] == "book-1")
    assert book_one["library_folder_id"] is None
    assert book_one["library_folder_name"] is None
