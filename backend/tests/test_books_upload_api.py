import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

import main


def test_clean_upload_uses_original_filename_and_lists_once(tmp_path, monkeypatch):
    from routers import books as books_router
    from services import library_store

    books_dir = tmp_path / "books"
    fonts_dir = tmp_path / "fonts"
    books_dir.mkdir()
    fonts_dir.mkdir()
    library_path = tmp_path / "library.json"
    original_filename = "Original Manuscript.txt"

    library_path.write_text(json.dumps({"version": 4, "books": [], "folders": []}, ensure_ascii=False, indent=2), encoding="utf-8")

    monkeypatch.setattr(main, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(main, "FONTS_DIR", fonts_dir)
    monkeypatch.setattr(main, "ensure_annotation_store", lambda: None)
    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)
    monkeypatch.setattr(library_store, "uuid4", lambda: SimpleNamespace(hex="real-upload-1"))
    monkeypatch.setattr(books_router, "BOOKS_DIR", books_dir)

    client = TestClient(main.app)
    response = client.post("/api/books", files={"file": (original_filename, b"uploaded body", "text/plain")})

    assert response.status_code == 200
    payload = response.json()
    assert payload["filename"] == original_filename
    assert payload["id"] == "real-upload-1"

    list_response = client.get("/api/books")

    assert list_response.status_code == 200
    books = list_response.json()
    assert len(books) == 1
    assert books[0]["filename"] == original_filename
    assert books[0]["id"] == "real-upload-1"
