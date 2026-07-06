import pytest


class _FakeEpubItem:
    def __init__(self, name: str, content: bytes = b"image"):
        self.file_name = name
        self.media_type = "image/png"
        self._content = content

    def get_name(self):
        return self.file_name

    def get_content(self):
        return self._content


class _FakeEpubBook:
    def __init__(self, names):
        self._items = [_FakeEpubItem(name) for name in names]

    def get_items(self):
        return self._items


@pytest.mark.parametrize(
    "asset_path,stored_name",
    [
        ("../image.png", "image.png"),
        ("%2e%2e/image.png", "image.png"),
        ("..\\image.png", "image.png"),
        ("/absolute/image.png", "absolute/image.png"),
        ("C:\\temp\\image.png", "temp/image.png"),
        ("OPS/../image.png", "image.png"),
    ],
)
def test_epub_asset_rejects_traversal_and_absolute_paths(monkeypatch, asset_path, stored_name):
    from services import epub_service

    monkeypatch.setattr(
        epub_service,
        "_read_epub_cached",
        lambda file_path: _FakeEpubBook([stored_name]),
    )

    with pytest.raises(FileNotFoundError):
        epub_service.get_epub_asset("book.epub", asset_path)


def test_epub_asset_allows_normal_nested_asset_path(monkeypatch):
    from services import epub_service

    monkeypatch.setattr(
        epub_service,
        "_read_epub_cached",
        lambda file_path: _FakeEpubBook(["OPS/images/cover.png"]),
    )

    data, media_type = epub_service.get_epub_asset("book.epub", "OPS/images/cover.png")

    assert data == b"image"
    assert media_type == "image/png"
