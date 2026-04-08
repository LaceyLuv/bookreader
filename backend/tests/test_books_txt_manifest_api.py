from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_txt_manifest_endpoint_returns_summary_fields(monkeypatch):
    from routers import books as books_router

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        books_router,
        "read_txt_manifest",
        lambda file_path: {
            "encoding": "utf-8",
            "total_chars": 120,
            "segment_count": 8,
            "segments": [
                {"segment_id": 0, "text": "alpha", "start_offset": 0, "end_offset": 5},
            ],
        },
    )

    response = client.get("/api/books/txt-1/txt-manifest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["segment_count"] == 8
    assert "segments" not in payload


def test_txt_segments_endpoint_returns_requested_window(monkeypatch):
    from routers import books as books_router

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )
    monkeypatch.setattr(
        books_router,
        "read_txt_manifest",
        lambda file_path: {
            "encoding": "utf-8",
            "total_chars": 120,
            "segment_count": 20,
            "segments": [
                {"segment_id": index, "text": f"segment {index}", "start_offset": index * 10, "end_offset": index * 10 + 9}
                for index in range(20)
            ],
        },
    )

    response = client.get("/api/books/txt-1/txt-segments?start=10&limit=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["start"] == 10
    assert payload["limit"] == 4
    assert len(payload["segments"]) == 4
    assert payload["segments"][0]["segment_id"] == 10
