import json

from fastapi.testclient import TestClient

import main
import routers.reading_progress as progress_router
import services.reading_progress_store as progress_store


def _configure_store(monkeypatch, tmp_path):
    path = tmp_path / "reading-progress.json"
    monkeypatch.setattr(progress_store, "READING_PROGRESS_DATA_PATH", path)
    return path


def test_progress_store_writes_atomically_and_recovers_backup(monkeypatch, tmp_path):
    path = _configure_store(monkeypatch, tmp_path)
    first = {"position": 2, "totalPages": 10, "type": "txt", "percent": 30, "bookmarks": []}
    second = {**first, "position": 5, "locator": {"version": 1, "kind": "txt", "segmentId": 7, "sourceOffset": 200}}

    progress_store.save_reading_progress("book-1", first)
    progress_store.save_reading_progress("book-1", second)

    assert progress_store.get_reading_progress("book-1")["locator"]["segmentId"] == 7
    assert not path.with_name(path.name + ".tmp").exists()
    path.write_text("{broken", encoding="utf-8")
    assert progress_store.get_reading_progress("book-1")["position"] == 2


def test_progress_api_round_trip_and_delete(monkeypatch, tmp_path):
    _configure_store(monkeypatch, tmp_path)
    monkeypatch.setattr(progress_router, "get_book_record", lambda book_id: {"id": book_id})
    with TestClient(main.app) as client:
        payload = {
            "version": 1,
            "position": 4,
            "totalPages": 12,
            "type": "zip",
            "percent": 42,
            "bookmarks": [{"position": 4, "locator": {"version": 1, "kind": "zip", "memberName": "004.jpg"}}],
            "locator": {"version": 1, "kind": "zip", "memberName": "004.jpg", "page": 4},
            "updatedAt": "2026-07-11T06:00:00.000Z",
        }
        assert client.get("/api/books/book-1/progress").status_code == 204
        response = client.put("/api/books/book-1/progress", json=payload)
        assert response.status_code == 200
        assert response.json()["locator"]["memberName"] == "004.jpg"
        assert client.get("/api/books/book-1/progress").json()["position"] == 4
        assert client.delete("/api/books/book-1/progress").status_code == 204
        assert client.get("/api/books/book-1/progress").status_code == 204


def test_progress_api_rejects_invalid_positions(monkeypatch, tmp_path):
    _configure_store(monkeypatch, tmp_path)
    monkeypatch.setattr(progress_router, "get_book_record", lambda book_id: {"id": book_id})
    with TestClient(main.app) as client:
        response = client.put("/api/books/book-1/progress", json={
            "position": -1, "totalPages": 0, "type": "txt", "bookmarks": [],
        })
        assert response.status_code == 422
