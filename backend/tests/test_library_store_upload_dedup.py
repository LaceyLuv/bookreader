import json

import pytest

from services import library_store


def test_add_book_record_duplicates_new_upload_after_orphan_discovery_in_sync(tmp_path, monkeypatch):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    book_id = "real-upload-1"
    original_filename = "Original Manuscript.txt"
    stored_filename = library_store.build_storage_name(book_id, original_filename)

    (books_dir / stored_filename).write_text("shared body", encoding="utf-8")
    library_path.write_text(json.dumps({"version": 4, "books": [], "folders": []}, ensure_ascii=False, indent=2), encoding="utf-8")

    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    library_store.add_book_record(
        book_id=book_id,
        filename=original_filename,
        stored_filename=stored_filename,
    )

    records = library_store.list_book_records()

    assert len(records) == 1
    assert records[0]["filename"] == original_filename
    assert records[0]["stored_filename"] == stored_filename
    assert records[0]["id"] == book_id


def test_txt_encoding_override_survives_store_resync_and_auto_reset(tmp_path, monkeypatch):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    book_id = "encoding-book"
    stored_filename = library_store.build_storage_name(book_id, "legacy.txt")
    (books_dir / stored_filename).write_bytes("한글".encode("cp949"))
    library_path.write_text(json.dumps({"version": 4, "books": [], "folders": []}), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)
    library_store.add_book_record(book_id=book_id, filename="legacy.txt", stored_filename=stored_filename)

    updated = library_store.update_book_record(book_id, {"txt_encoding_override": "CP949"})
    reloaded = library_store.list_book_records()[0]

    assert updated["txt_encoding_override"] == "cp949"
    assert reloaded["txt_encoding_override"] == "cp949"
    assert json.loads(library_path.read_text(encoding="utf-8"))["books"][0]["txt_encoding_override"] == "cp949"

    reset = library_store.update_book_record(book_id, {"txt_encoding_override": None})
    assert reset["txt_encoding_override"] is None


def test_txt_encoding_override_rejects_unknown_codec(tmp_path, monkeypatch):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"
    book_id = "encoding-book"
    stored_filename = library_store.build_storage_name(book_id, "legacy.txt")
    (books_dir / stored_filename).write_text("text", encoding="utf-8")
    library_path.write_text(json.dumps({"version": 4, "books": [], "folders": []}), encoding="utf-8")
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)
    library_store.add_book_record(book_id=book_id, filename="legacy.txt", stored_filename=stored_filename)

    with pytest.raises(ValueError, match="Unsupported TXT encoding"):
        library_store.update_book_record(book_id, {"txt_encoding_override": "unicode_escape"})
