import json

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
