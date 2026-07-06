import io
import json
import zipfile
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main


def test_book_upload_rejects_files_over_configured_limit(tmp_path, monkeypatch):
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
    monkeypatch.setattr(library_store, "uuid4", lambda: SimpleNamespace(hex="large-upload"))
    monkeypatch.setattr(books_router, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(books_router, "MAX_BOOK_UPLOAD_BYTES", 5, raising=False)

    client = TestClient(main.app)
    response = client.post("/api/books", files={"file": ("large.txt", b"123456", "text/plain")})

    assert response.status_code == 413
    assert list(books_dir.iterdir()) == []


def test_book_upload_rejects_oversized_content_length_before_copy(monkeypatch):
    from routers import books as books_router

    async def _fail_if_called(*args, **kwargs):
        raise AssertionError("_save_upload_file should not be called")

    monkeypatch.setattr(books_router, "MAX_BOOK_UPLOAD_BYTES", 5, raising=False)
    monkeypatch.setattr(books_router, "MAX_BOOK_UPLOAD_REQUEST_BYTES", 5, raising=False)
    monkeypatch.setattr(books_router, "_save_upload_file", _fail_if_called)

    client = TestClient(main.app)
    response = client.post(
        "/api/books",
        files={"file": ("large.txt", b"123456", "text/plain")},
        headers={"content-length": "6"},
    )

    assert response.status_code == 413


def test_book_upload_rejects_oversized_content_length_in_middleware(monkeypatch):
    from routers import books as books_router

    async def _fail_if_called(*args, **kwargs):
        raise AssertionError("endpoint should not copy oversized request")

    monkeypatch.setattr(books_router, "MAX_BOOK_UPLOAD_REQUEST_BYTES", 5, raising=False)
    monkeypatch.setattr(books_router, "_reject_oversized_content_length", lambda request: None)
    monkeypatch.setattr(books_router, "_save_upload_file", _fail_if_called)

    client = TestClient(main.app)
    response = client.post(
        "/api/books",
        files={"file": ("large.txt", b"123456", "text/plain")},
        headers={"content-length": "6"},
    )

    assert response.status_code == 413


def test_book_upload_accepts_file_at_configured_limit(tmp_path, monkeypatch):
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
    monkeypatch.setattr(library_store, "uuid4", lambda: SimpleNamespace(hex="limit-upload"))
    monkeypatch.setattr(books_router, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(books_router, "MAX_BOOK_UPLOAD_BYTES", 5, raising=False)

    client = TestClient(main.app)
    response = client.post("/api/books", files={"file": ("limit.txt", b"12345", "text/plain")})

    assert response.status_code == 200
    assert response.json()["id"] == "limit-upload"


def test_zip_image_rejects_entries_over_configured_limit(tmp_path, monkeypatch):
    from services import zip_service

    archive_path = tmp_path / "images.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("page.png", b"123456")
    monkeypatch.setattr(zip_service, "MAX_ZIP_IMAGE_BYTES", 5, raising=False)

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.get_zip_image(str(archive_path), "page.png")


def test_zip_image_rejects_non_image_member(tmp_path):
    from services import zip_service

    archive_path = tmp_path / "mixed.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("notes.txt", b"not an image")

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.get_zip_image(str(archive_path), "notes.txt")


def test_zip_image_rejects_image_extension_with_non_image_content(tmp_path):
    from services import zip_service

    archive_path = tmp_path / "spoofed.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("page.png", b"not really an image")

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.get_zip_image(str(archive_path), "page.png")


@pytest.mark.parametrize(
    "member_name",
    [
        "../evil.png",
        "%2e%2e/evil.png",
        "..\\evil.png",
        "/absolute/evil.png",
        "C:\\temp\\evil.png",
        "__MACOSX/evil.png",
        ".hidden.png",
        "folder/.hidden.png",
    ],
)
def test_zip_rejects_unsafe_image_member_paths(tmp_path, member_name):
    from services import zip_service

    archive_path = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr(member_name, b"image")

    assert zip_service.list_zip_images(str(archive_path)) == {"images": [], "total": 0}
    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.get_zip_image(str(archive_path), member_name)


def test_zip_listing_rejects_excessive_total_uncompressed_size(tmp_path, monkeypatch):
    from services import zip_service

    archive_path = tmp_path / "large-total.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("one.png", b"1234")
        zf.writestr("two.png", b"5678")
    monkeypatch.setattr(zip_service, "MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES", 7, raising=False)

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.list_zip_images(str(archive_path))


def test_zip_listing_rejects_excessive_compression_ratio(tmp_path, monkeypatch):
    from services import zip_service

    archive_path = tmp_path / "ratio.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("page.png", b"0" * 4096)
    monkeypatch.setattr(zip_service, "MAX_ZIP_COMPRESSION_RATIO", 2, raising=False)

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.list_zip_images(str(archive_path))


def test_zip_listing_rejects_archives_with_too_many_entries(tmp_path, monkeypatch):
    from services import zip_service

    archive_path = tmp_path / "many.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("one.png", b"1")
        zf.writestr("two.png", b"2")
        zf.writestr("three.png", b"3")
    monkeypatch.setattr(zip_service, "MAX_ZIP_ENTRIES", 2, raising=False)

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.list_zip_images(str(archive_path))


def test_zip_listing_rejects_corrupt_archives(tmp_path):
    from services import zip_service

    archive_path = tmp_path / "corrupt.zip"
    archive_path.write_bytes(b"not a zip")

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.list_zip_images(str(archive_path))


def test_zip_image_rejects_corrupt_archives(tmp_path):
    from services import zip_service

    archive_path = tmp_path / "corrupt.zip"
    archive_path.write_bytes(b"not a zip")

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.get_zip_image(str(archive_path), "page.png")


def test_zip_listing_rejects_too_many_images(tmp_path, monkeypatch):
    from services import zip_service

    archive_path = tmp_path / "many-images.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("one.png", b"1")
        zf.writestr("two.png", b"2")
    monkeypatch.setattr(zip_service, "MAX_ZIP_IMAGE_COUNT", 1, raising=False)

    with pytest.raises(zip_service.ZipSafetyError):
        zip_service.list_zip_images(str(archive_path))


def test_zip_listing_uses_natural_sort(tmp_path):
    from services import zip_service

    archive_path = tmp_path / "sorted.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("page10.png", b"10")
        zf.writestr("page2.png", b"2")
        zf.writestr("page1.png", b"1")

    assert zip_service.list_zip_images(str(archive_path))["images"] == [
        "page1.png",
        "page2.png",
        "page10.png",
    ]


def test_zip_images_endpoint_returns_400_for_invalid_archives(tmp_path, monkeypatch):
    from routers import books as books_router

    archive_path = tmp_path / "corrupt.zip"
    archive_path.write_bytes(b"not a zip")
    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "zip"}, archive_path),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)

    client = TestClient(main.app)
    response = client.get("/api/books/book-1/images")

    assert response.status_code == 400
