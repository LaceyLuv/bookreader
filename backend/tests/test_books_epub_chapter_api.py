from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_epub_chapter_endpoint_uses_relative_asset_base_url(monkeypatch):
    from routers import books as books_router

    captured = {}

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "epub"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)

    def _get_epub_chapter(file_path, chapter_index, book_id, asset_base_url=None):
        captured["asset_base_url"] = asset_base_url
        return {
            "title": "Chapter One",
            "html": f'<img src="{asset_base_url}/Images/cover.png">',
            "index": chapter_index,
            "total": 1,
        }

    monkeypatch.setattr(books_router, "get_epub_chapter", _get_epub_chapter)

    response = client.get("/api/books/epub-1/chapter/0")

    assert response.status_code == 200
    assert captured["asset_base_url"] == "/api/books/epub-1/asset"
    assert response.json()["html"] == '<img src="/api/books/epub-1/asset/Images/cover.png">'


def test_epub_asset_response_is_non_sniffable_and_sandboxed(monkeypatch):
    from routers import books as books_router

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "epub"}, "fake-path"),
    )
    monkeypatch.setattr(
        books_router,
        "get_epub_asset",
        lambda file_path, asset_path: (b"<svg></svg>", "image/svg+xml"),
    )

    response = client.get("/api/books/epub-1/asset/Images/cover.svg")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert response.headers["cache-control"] == "private, max-age=3600"


def test_epub_chapter_error_uses_stable_problem_and_http_status(monkeypatch):
    from routers import books as books_router
    from services.epub_service import EpubSafetyError

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "epub"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)

    def _missing(*args, **kwargs):
        raise EpubSafetyError(
            "EPUB chapter was not found",
            code="epub_chapter_not_found",
            stage="content",
            chapter_index=42,
        )

    monkeypatch.setattr(books_router, "get_epub_chapter", _missing)
    response = client.get("/api/books/epub-1/chapter/42")

    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "epub_chapter_not_found",
        "message": "EPUB chapter was not found",
        "severity": "error",
        "stage": "content",
        "retryable": False,
        "recovery": "choose_another_file",
        "context": {"member_path": None, "chapter_index": 42},
    }


def test_format_diagnostics_endpoint_forwards_zip_member(monkeypatch):
    from routers import books as books_router

    captured = {}
    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "zip"}, "fake-path"),
    )

    def _diagnose(file_path, member_name):
        captured["args"] = (file_path, member_name)
        return {"format": "zip", "status": "supported", "issues": [], "stats": {"images_total": 1}}

    monkeypatch.setattr(books_router, "diagnose_zip", _diagnose)
    response = client.get("/api/books/zip-1/diagnostics?member_name=page%201.png")

    assert response.status_code == 200
    assert captured["args"] == ("fake-path", "page 1.png")
    assert response.json()["format"] == "zip"
