import pytest
import zipfile


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


def _write_zip(path, members, compression=zipfile.ZIP_STORED):
    with zipfile.ZipFile(path, "w", compression=compression) as archive:
        for name, content in members:
            archive.writestr(name, content)


def test_epub_preflight_rejects_too_many_entries(tmp_path, monkeypatch):
    from services import epub_service

    path = tmp_path / "many.epub"
    _write_zip(path, [(f"item-{index}.txt", b"x") for index in range(3)])
    monkeypatch.setattr(epub_service, "MAX_EPUB_ENTRIES", 2)

    with pytest.raises(epub_service.EpubSafetyError, match="too many entries"):
        epub_service._preflight_epub(str(path))


def test_epub_preflight_rejects_large_uncompressed_total(tmp_path, monkeypatch):
    from services import epub_service

    path = tmp_path / "large.epub"
    _write_zip(path, [("a.bin", b"a" * 8), ("b.bin", b"b" * 8)])
    monkeypatch.setattr(epub_service, "MAX_EPUB_MEMBER_BYTES", 100)
    monkeypatch.setattr(epub_service, "MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES", 12)

    with pytest.raises(epub_service.EpubSafetyError, match="decompressed"):
        epub_service._preflight_epub(str(path))


def test_epub_preflight_rejects_high_compression_ratio(tmp_path, monkeypatch):
    from services import epub_service

    path = tmp_path / "bomb.epub"
    _write_zip(path, [("bomb.txt", b"0" * 10000)], compression=zipfile.ZIP_DEFLATED)
    monkeypatch.setattr(epub_service, "MAX_EPUB_MEMBER_BYTES", 20000)
    monkeypatch.setattr(epub_service, "MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES", 20000)
    monkeypatch.setattr(epub_service, "MAX_EPUB_COMPRESSION_RATIO", 10)

    with pytest.raises(epub_service.EpubSafetyError, match="compression ratio"):
        epub_service._preflight_epub(str(path))


def test_epub_preflight_rejects_long_entry_name(tmp_path, monkeypatch):
    from services import epub_service

    path = tmp_path / "long-name.epub"
    _write_zip(path, [("long-entry-name.txt", b"x")])
    monkeypatch.setattr(epub_service, "MAX_EPUB_NAME_LENGTH", 8)

    with pytest.raises(epub_service.EpubSafetyError, match="name is too long"):
        epub_service._preflight_epub(str(path))


def test_epub_parsed_limits_reject_oversized_asset(monkeypatch):
    from services import epub_service

    monkeypatch.setattr(epub_service, "MAX_EPUB_MEMBER_BYTES", 4)
    monkeypatch.setattr(
        epub_service,
        "_read_epub_cached",
        lambda file_path: _FakeEpubBook(["OPS/images/cover.png"]),
    )

    with pytest.raises(epub_service.EpubSafetyError, match="asset is too large"):
        epub_service.get_epub_asset("book.epub", "OPS/images/cover.png")
