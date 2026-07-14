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


CONTAINER_XML = b'''<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''
PACKAGE_XML = b'''<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"></package>'''


def _minimal_package_members(extra=()):
    return [
        ("mimetype", b"application/epub+zip"),
        ("META-INF/container.xml", CONTAINER_XML),
        ("OPS/package.opf", PACKAGE_XML),
        *extra,
    ]


def test_epub_preflight_reports_missing_container_separately(tmp_path):
    from services import epub_service

    path = tmp_path / "missing-container.epub"
    _write_zip(path, [("mimetype", b"application/epub+zip")])

    with pytest.raises(epub_service.EpubSafetyError) as captured:
        epub_service._preflight_epub(str(path))

    assert captured.value.code == "epub_missing_container"
    assert captured.value.stage == "container"


def test_epub_preflight_rejects_drm_encryption_with_stable_code(tmp_path):
    from services import epub_service

    path = tmp_path / "drm.epub"
    encryption = b'''<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
        xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></enc:EncryptedData>
    </encryption>'''
    _write_zip(path, _minimal_package_members([("META-INF/encryption.xml", encryption)]))

    with pytest.raises(epub_service.EpubSafetyError) as captured:
        epub_service._preflight_epub(str(path))

    assert captured.value.code == "epub_drm_unsupported"
    assert captured.value.to_problem()["recovery"] == "choose_another_file"


def test_epub_preflight_allows_font_obfuscation_but_reports_it(tmp_path):
    from services import epub_service

    path = tmp_path / "font-obfuscation.epub"
    encryption = b'''<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
        xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></enc:EncryptedData>
    </encryption>'''
    _write_zip(path, _minimal_package_members([("META-INF/encryption.xml", encryption)]))

    stats = epub_service._preflight_epub(str(path))

    assert stats["font_obfuscation_algorithms"] == ["http://www.idpf.org/2008/embedding"]


def test_epub_preflight_rejects_casefold_member_collision(tmp_path):
    from services import epub_service

    path = tmp_path / "collision.epub"
    _write_zip(path, _minimal_package_members([("OPS/Image.PNG", b"a"), ("ops/image.png", b"b")]))

    with pytest.raises(epub_service.EpubSafetyError) as captured:
        epub_service._preflight_epub(str(path))

    assert captured.value.code == "epub_duplicate_member"


def test_epub_preflight_rejects_symlink_member(tmp_path):
    from services import epub_service

    path = tmp_path / "symlink.epub"
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in _minimal_package_members():
            archive.writestr(name, content)
        link = zipfile.ZipInfo("OPS/link.xhtml")
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        archive.writestr(link, "target.xhtml")

    with pytest.raises(epub_service.EpubSafetyError) as captured:
        epub_service._preflight_epub(str(path))

    assert captured.value.code == "epub_unsafe_member"
