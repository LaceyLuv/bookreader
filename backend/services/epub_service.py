import mimetypes
import os
import posixpath
import re
import stat
import unicodedata
import zipfile
from functools import lru_cache
from pathlib import Path
from threading import RLock
from urllib.parse import quote, unquote, urlsplit
from xml.etree import ElementTree

import chardet
import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

CSS_URL_RE = re.compile(r"url\(\s*([\"']?)(.*?)\1\s*\)", re.IGNORECASE)
ASSET_SCHEMES = ("http://", "https://", "data:", "mailto:", "javascript:")
DECLARED_XML_ENCODING_RE = re.compile(br"encoding=['\"]([A-Za-z0-9._-]+)['\"]", re.IGNORECASE)
DECLARED_META_CHARSET_RE = re.compile(br"charset=['\"]?\s*([A-Za-z0-9._-]+)", re.IGNORECASE)
TEXT_SAMPLE_SIZE = 64 * 1024
FONT_MEDIA_TYPES = {
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}
MAX_EPUB_ENTRIES = int(os.getenv("BOOKREADER_MAX_EPUB_ENTRIES", "10000"))
MAX_EPUB_NAME_LENGTH = int(os.getenv("BOOKREADER_MAX_EPUB_NAME_LENGTH", "512"))
MAX_EPUB_MEMBER_BYTES = int(os.getenv("BOOKREADER_MAX_EPUB_MEMBER_BYTES", str(64 * 1024 * 1024)))
MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES = int(os.getenv("BOOKREADER_MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES", str(512 * 1024 * 1024)))
MAX_EPUB_COMPRESSION_RATIO = int(os.getenv("BOOKREADER_MAX_EPUB_COMPRESSION_RATIO", "100"))
MAX_EPUB_CHAPTERS = int(os.getenv("BOOKREADER_MAX_EPUB_CHAPTERS", "5000"))
MAX_EPUB_CHAPTER_BYTES = int(os.getenv("BOOKREADER_MAX_EPUB_CHAPTER_BYTES", str(16 * 1024 * 1024)))
MAX_EPUB_CSS_BYTES = int(os.getenv("BOOKREADER_MAX_EPUB_CSS_BYTES", str(8 * 1024 * 1024)))
MAX_EPUB_TOTAL_CSS_BYTES = int(os.getenv("BOOKREADER_MAX_EPUB_TOTAL_CSS_BYTES", str(32 * 1024 * 1024)))
SUPPORTED_ZIP_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA}
FONT_OBFUSCATION_ALGORITHMS = {
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
}
_EPUB_PARSE_LOCK = RLock()


class EpubSafetyError(ValueError):
    """Raised when an EPUB is invalid or exceeds safe resource limits."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "epub_invalid_archive",
        stage: str = "archive",
        retryable: bool = False,
        member_path: str | None = None,
        chapter_index: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.retryable = retryable
        self.member_path = member_path
        self.chapter_index = chapter_index

    def to_problem(self) -> dict:
        return {
            "code": self.code,
            "message": str(self),
            "severity": "error",
            "stage": self.stage,
            "retryable": self.retryable,
            "recovery": "choose_another_file" if not self.retryable else "retry",
            "context": {
                "member_path": self.member_path,
                "chapter_index": self.chapter_index,
            },
        }


def _raise_epub(message: str, code: str, stage: str, **context) -> None:
    raise EpubSafetyError(message, code=code, stage=stage, **context)


def _member_collision_key(name: str) -> str:
    return unicodedata.normalize("NFC", name).casefold()


def _is_regular_zip_member(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    kind = stat.S_IFMT(mode)
    return kind in {0, stat.S_IFREG, stat.S_IFDIR}


def _read_package_location(archive: zipfile.ZipFile, names: dict[str, zipfile.ZipInfo]) -> str:
    container_info = names.get("META-INF/container.xml")
    if container_info is None:
        _raise_epub("EPUB container.xml is missing", "epub_missing_container", "container")
    try:
        root = ElementTree.fromstring(archive.read(container_info))
    except (ElementTree.ParseError, KeyError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
        raise EpubSafetyError(
            "EPUB container.xml is invalid",
            code="epub_invalid_container",
            stage="container",
            member_path="META-INF/container.xml",
        ) from exc
    package_path = next((element.attrib.get("full-path") for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "rootfile"), None)
    normalized = _normalize_path(package_path)
    if not normalized:
        _raise_epub("EPUB package path is missing", "epub_missing_package", "package")
    if normalized not in names:
        _raise_epub("EPUB package document is missing", "epub_missing_package", "package", member_path=normalized)
    return normalized


def _validate_epub_encryption(archive: zipfile.ZipFile, names: dict[str, zipfile.ZipInfo]) -> list[str]:
    encryption_info = names.get("META-INF/encryption.xml")
    if encryption_info is None:
        return []
    try:
        root = ElementTree.fromstring(archive.read(encryption_info))
    except (ElementTree.ParseError, KeyError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
        raise EpubSafetyError(
            "EPUB encryption metadata is invalid",
            code="epub_invalid_encryption_metadata",
            stage="encryption",
            member_path="META-INF/encryption.xml",
        ) from exc
    algorithms = [
        value
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "EncryptionMethod"
        for value in [element.attrib.get("Algorithm")]
        if value
    ]
    unsupported = [algorithm for algorithm in algorithms if algorithm not in FONT_OBFUSCATION_ALGORITHMS]
    if unsupported:
        _raise_epub("DRM or encrypted EPUB content is not supported", "epub_drm_unsupported", "encryption")
    return algorithms


def _preflight_epub(file_path: str) -> dict:
    """Validate ZIP metadata without decompressing members for ebooklib."""
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            infos = archive.infolist()
    except (OSError, zipfile.BadZipFile) as exc:
        raise EpubSafetyError("Invalid or unsupported EPUB file", code="epub_invalid_archive", stage="archive") from exc

    if len(infos) > MAX_EPUB_ENTRIES:
        _raise_epub("EPUB file has too many entries", "epub_resource_limit", "archive")

    total_size = 0
    normalized_names: dict[str, zipfile.ZipInfo] = {}
    collision_keys: set[str] = set()
    for info in infos:
        if len(info.filename) > MAX_EPUB_NAME_LENGTH:
            _raise_epub("EPUB entry name is too long", "epub_resource_limit", "archive", member_path=info.filename)
        if info.is_dir():
            continue
        normalized_name = _normalize_path(info.filename)
        if not normalized_name:
            _raise_epub("EPUB contains an unsafe member path", "epub_unsafe_member", "archive", member_path=info.filename)
        collision_key = _member_collision_key(normalized_name)
        if collision_key in collision_keys:
            _raise_epub("EPUB contains duplicate member names", "epub_duplicate_member", "archive", member_path=normalized_name)
        collision_keys.add(collision_key)
        normalized_names[normalized_name] = info
        if not _is_regular_zip_member(info):
            _raise_epub("EPUB contains a special archive member", "epub_unsafe_member", "archive", member_path=normalized_name)
        if info.flag_bits & 0x1:
            _raise_epub("Encrypted EPUB archive members are not supported", "epub_encrypted_zip", "encryption", member_path=normalized_name)
        if info.compress_type not in SUPPORTED_ZIP_COMPRESSION:
            _raise_epub("EPUB uses an unsupported compression method", "epub_unsupported_compression", "archive", member_path=normalized_name)
        if info.file_size > MAX_EPUB_MEMBER_BYTES:
            _raise_epub("EPUB entry is too large", "epub_resource_limit", "archive", member_path=normalized_name)
        total_size += info.file_size
        if total_size > MAX_EPUB_TOTAL_UNCOMPRESSED_BYTES:
            _raise_epub("EPUB file is too large when decompressed", "epub_resource_limit", "archive")
        compressed_size = max(info.compress_size, 1)
        if info.file_size and info.file_size / compressed_size > MAX_EPUB_COMPRESSION_RATIO:
            _raise_epub("EPUB compression ratio is too high", "epub_resource_limit", "archive", member_path=normalized_name)

    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            package_path = _read_package_location(archive, normalized_names)
            obfuscation_algorithms = _validate_epub_encryption(archive, normalized_names)
            mimetype_info = normalized_names.get("mimetype")
            mimetype_valid = bool(
                mimetype_info
                and infos
                and infos[0].filename == mimetype_info.filename
                and mimetype_info.compress_type == zipfile.ZIP_STORED
                and archive.read(mimetype_info) == b"application/epub+zip"
            )
    except EpubSafetyError:
        raise
    except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
        raise EpubSafetyError("Invalid or unsupported EPUB file", code="epub_invalid_archive", stage="archive") from exc
    return {
        "entries_total": len(infos),
        "uncompressed_bytes": total_size,
        "package_path": package_path,
        "mimetype_valid": mimetype_valid,
        "font_obfuscation_algorithms": obfuscation_algorithms,
    }


def _epub_revision_key(file_path: str) -> tuple[str, int, int]:
    path = Path(file_path).resolve()
    stat_result = path.stat()
    return str(path), stat_result.st_size, stat_result.st_mtime_ns


@lru_cache(maxsize=8)
def _parse_epub_revision_cached(file_path: str, size: int, mtime_ns: int):
    """Cache parsed EPUB books by immutable file revision."""
    _preflight_epub(file_path)
    try:
        book = epub.read_epub(file_path)
    except EpubSafetyError:
        raise
    except Exception as exc:
        raise EpubSafetyError("EPUB package could not be parsed", code="epub_invalid_package", stage="package") from exc
    _validate_parsed_epub(book)
    return book


def _read_epub_revision_cached(file_path: str, size: int, mtime_ns: int):
    # lru_cache alone can execute the same miss concurrently. Serialize only
    # cache-miss entry so a TOC/chapter pair shares one ebooklib parse.
    with _EPUB_PARSE_LOCK:
        return _parse_epub_revision_cached(file_path, size, mtime_ns)


def _read_epub_cached(file_path: str):
    return _read_epub_revision_cached(*_epub_revision_key(file_path))


def _validate_parsed_epub(book) -> None:
    spine_items = _get_spine_items(book)
    if len(spine_items) > MAX_EPUB_CHAPTERS:
        _raise_epub("EPUB file has too many chapters", "epub_resource_limit", "spine")
    if not spine_items:
        _raise_epub("EPUB has no readable spine chapters", "epub_empty_spine", "spine")

    for item in spine_items:
        if len(item.get_content()) > MAX_EPUB_CHAPTER_BYTES:
            _raise_epub("EPUB chapter is too large", "epub_resource_limit", "content")

    total_css_size = 0
    for item in book.get_items_of_type(ebooklib.ITEM_STYLE):
        size = len(item.get_content())
        if size > MAX_EPUB_CSS_BYTES:
            _raise_epub("EPUB stylesheet is too large", "epub_resource_limit", "content")
        total_css_size += size
        if total_css_size > MAX_EPUB_TOTAL_CSS_BYTES:
            _raise_epub("EPUB stylesheets are too large", "epub_resource_limit", "content")


def clear_epub_caches() -> None:
    """Drop cached EPUB parse/style entries after library mutations."""
    _parse_epub_revision_cached.cache_clear()
    _collect_rewritten_styles_revision_cached.cache_clear()


def _diagnostic_issue(
    code: str,
    message: str,
    *,
    severity: str = "warning",
    stage: str = "content",
    retryable: bool = False,
    context: dict | None = None,
) -> dict:
    return {
        "code": code,
        "message": message,
        "severity": severity,
        "stage": stage,
        "retryable": retryable,
        "recovery": "retry" if retryable else "none",
        "context": context or {},
    }


def diagnose_epub(file_path: str) -> dict:
    """Return a bounded, user-safe compatibility report for one EPUB revision."""
    try:
        archive_stats = _preflight_epub(file_path)
        book = _read_epub_cached(file_path)
        spine_items = _get_spine_items(book)
    except EpubSafetyError as exc:
        return {
            "format": "epub",
            "status": "unsupported_or_corrupt",
            "issues": [exc.to_problem()],
            "stats": {},
        }

    issues: list[dict] = []
    if not archive_stats.get("mimetype_valid"):
        issues.append(_diagnostic_issue(
            "epub_nonstandard_mimetype",
            "EPUB mimetype entry is missing or non-standard",
            stage="container",
        ))
    if archive_stats.get("font_obfuscation_algorithms"):
        issues.append(_diagnostic_issue(
            "epub_obfuscated_fonts",
            "Embedded font obfuscation may have limited support",
            stage="encryption",
        ))

    feature_counts = {"svg": 0, "mathml": 0, "script": 0, "vertical_writing": 0}
    for item in spine_items:
        content = item.get_content().lower()
        feature_counts["svg"] += int(b"<svg" in content)
        feature_counts["mathml"] += int(b"<math" in content)
        feature_counts["script"] += int(b"<script" in content)
        feature_counts["vertical_writing"] += int(b"writing-mode" in content and b"vertical" in content)
    feature_messages = {
        "svg": ("epub_svg_limited", "SVG content is removed by the safe reader mode"),
        "mathml": ("epub_mathml_limited", "MathML content is removed by the safe reader mode"),
        "script": ("epub_scripted_content_blocked", "Scripted EPUB content is blocked"),
        "vertical_writing": ("epub_vertical_writing_limited", "Vertical writing is not fully supported"),
    }
    for feature, count in feature_counts.items():
        if not count:
            continue
        code, message = feature_messages[feature]
        issues.append(_diagnostic_issue(code, message, context={"chapter_count": count}))

    return {
        "format": "epub",
        "status": "degraded" if issues else "supported",
        "issues": issues,
        "stats": {
            **archive_stats,
            "chapter_count": len(spine_items),
            "feature_counts": feature_counts,
        },
    }

def get_epub_toc(file_path: str) -> dict:
    """Extract table of contents from an EPUB file.

    Tries the EPUB built-in navigation (nav/ncx) first to avoid expensive
    BeautifulSoup parsing of every spine item. Falls back to heading scan.
    """
    book = _read_epub_cached(file_path)
    spine_items = _get_spine_items(book)

    book_title = book.get_metadata("DC", "title")
    book_title = book_title[0][0] if book_title else "Untitled"

    # Fast path: extract from EPUB built-in TOC (nav/ncx)
    toc = _toc_from_nav(book, spine_items)
    if toc:
        return {"title": book_title, "toc": toc}

    # Slow fallback: parse each spine item for headings
    toc = []
    for i, item in enumerate(spine_items):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        heading = soup.find(["h1", "h2", "h3", "h4", "title"])
        title = heading.get_text(strip=True) if heading else f"Chapter {i + 1}"
        if not title:
            title = f"Chapter {i + 1}"
        toc.append({"title": title, "index": i, "href": _normalize_item_path(item)})

    return {"title": book_title, "toc": toc}


def get_epub_chapter(file_path: str, chapter_index: int, book_id: str, asset_base_url: str | None = None) -> dict:
    """Get a chapter with asset URLs rewritten through the EPUB asset endpoint."""
    book = _read_epub_cached(file_path)
    spine_items = _get_spine_items(book)

    if chapter_index < 0 or chapter_index >= len(spine_items):
        _raise_epub(
            "EPUB chapter was not found",
            "epub_chapter_not_found",
            "content",
            chapter_index=chapter_index,
        )

    chapter_item = spine_items[chapter_index]
    chapter_path = _normalize_item_path(chapter_item)
    chapter_dir = posixpath.dirname(chapter_path) if chapter_path else ""

    html_content = _decode_text_bytes(chapter_item.get_content())
    soup = BeautifulSoup(html_content, "html.parser")

    _rewrite_html_asset_attrs(soup, book_id, chapter_dir, asset_base_url)
    _rewrite_inline_style_tags(soup, book_id, chapter_dir, asset_base_url)

    style_blocks = list(_collect_rewritten_styles_cached(file_path, book_id, asset_base_url or ''))
    style_blocks.append(_reader_safe_css())
    _inject_style_block(soup, "\n\n".join(block for block in style_blocks if block))

    heading = soup.find(["h1", "h2", "h3", "h4", "title"])
    title = heading.get_text(strip=True) if heading else f"Chapter {chapter_index + 1}"
    if not title:
        title = f"Chapter {chapter_index + 1}"

    return {
        "title": title,
        "html": _render_chapter_fragment(soup),
        "index": chapter_index,
        "total": len(spine_items),
    }


def get_epub_asset(file_path: str, asset_path: str) -> tuple[bytes, str]:
    """Read a referenced EPUB asset file."""
    book = _read_epub_cached(file_path)
    normalized = _normalize_path(asset_path)
    if not normalized:
        raise FileNotFoundError("Invalid asset path")

    item = _find_item_by_path(book, normalized)
    if not item:
        raise FileNotFoundError("Asset not found")

    content = item.get_content()
    if len(content) > MAX_EPUB_MEMBER_BYTES:
        _raise_epub("EPUB asset is too large", "epub_resource_limit", "asset", member_path=normalized)

    suffix = posixpath.splitext(normalized)[1].lower()
    media_type = (
        FONT_MEDIA_TYPES.get(suffix)
        or getattr(item, "media_type", None)
        or mimetypes.guess_type(normalized)[0]
        or "application/octet-stream"
    )
    return content, media_type


def _get_spine_items(book) -> list:
    """Get document items from the book spine in reading order."""
    spine_ids = [item_id for item_id, _ in book.spine]
    items = []
    for item_id in spine_ids:
        if item_id == "nav":
            continue
        item = book.get_item_with_id(item_id)
        if item and item.get_type() == ebooklib.ITEM_DOCUMENT:
            items.append(item)
    return items


def _item_paths(item) -> list[str]:
    paths = []
    getter = getattr(item, "get_name", None)
    if callable(getter):
        name = getter()
        if name:
            paths.append(name)
    file_name = getattr(item, "file_name", None)
    if file_name:
        paths.append(file_name)
    href = getattr(item, "href", None)
    if href:
        paths.append(href)
    return [p for p in paths if p]


def _normalize_path(path: str | None, allow_parent: bool = False) -> str:
    if not path:
        return ""
    raw = unquote(str(path)).strip()
    if not raw:
        return ""
    if not allow_parent:
        raw_for_checks = raw.replace("\\", "/")
        if raw.startswith(("/", "\\")):
            return ""
        if re.match(r"^[A-Za-z]:[\\/]", raw):
            return ""
        if "\\" in raw:
            return ""
        if any(part == ".." for part in raw_for_checks.split("/")):
            return ""
    raw = raw.replace("\\", "/")
    parsed = urlsplit(raw)
    if parsed.scheme:
        return ""
    candidate = parsed.path.lstrip("/")
    if not candidate:
        return ""
    normalized = posixpath.normpath(candidate)
    if normalized in ("", "."):
        return ""
    if not allow_parent and (normalized == ".." or normalized.startswith("../")):
        return ""
    return normalized


def _normalize_item_path(item) -> str:
    for p in _item_paths(item):
        normalized = _normalize_path(p)
        if normalized:
            return normalized
    return ""


def _resolve_relative_path(base_dir: str, raw_path: str) -> str:
    stripped = (raw_path or "").strip()
    if stripped.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", stripped):
        return ""
    cleaned = _normalize_path(raw_path, allow_parent=True)
    if not cleaned:
        return ""
    if raw_path.strip().startswith("/"):
        combined = posixpath.normpath(cleaned.lstrip("/"))
    else:
        combined = posixpath.normpath(posixpath.join(base_dir or "", cleaned))
    if combined in ("", ".", "..") or combined.startswith("../"):
        return ""
    return combined.lstrip("/")


def _asset_url(book_id: str, asset_path: str, asset_base_url: str | None = None) -> str:
    encoded_path = quote(asset_path, safe='/')
    if asset_base_url:
        return f"{asset_base_url.rstrip('/')}/{encoded_path}"
    return f"/api/books/{book_id}/asset/{encoded_path}"


def _rewrite_url(book_id: str, base_dir: str, raw_url: str, asset_base_url: str | None = None) -> str | None:
    if not raw_url:
        return None
    stripped = raw_url.strip()
    lowered = stripped.lower()
    if not stripped or stripped.startswith("#") or lowered.startswith(ASSET_SCHEMES) or lowered.startswith("//"):
        return None
    parsed = urlsplit(stripped)
    if parsed.scheme:
        return None
    resolved = _resolve_relative_path(base_dir, parsed.path)
    if not resolved:
        return None
    rewritten = _asset_url(book_id, resolved, asset_base_url)
    if parsed.query:
        rewritten = f"{rewritten}?{parsed.query}"
    if parsed.fragment:
        rewritten = f"{rewritten}#{parsed.fragment}"
    return rewritten


def _find_item_by_path(book, asset_path: str):
    target = _normalize_path(asset_path)
    if not target:
        return None
    for item in book.get_items():
        for candidate in _item_paths(item):
            normalized = _normalize_path(candidate)
            if not normalized:
                continue
            if normalized == target:
                return item
    return None


def _rewrite_html_asset_attrs(soup: BeautifulSoup, book_id: str, chapter_dir: str, asset_base_url: str | None = None) -> None:
    for tag in soup.find_all(["img", "image", "link", "source"]):
        for attr in ("src", "href", "xlink:href"):
            raw = tag.get(attr)
            rewritten = _rewrite_url(book_id, chapter_dir, raw, asset_base_url)
            if rewritten:
                tag[attr] = rewritten

        srcset = tag.get("srcset")
        if srcset:
            parts = []
            changed = False
            for entry in srcset.split(","):
                token = entry.strip()
                if not token:
                    continue
                pieces = token.split()
                rewritten = _rewrite_url(book_id, chapter_dir, pieces[0], asset_base_url)
                if rewritten:
                    pieces[0] = rewritten
                    changed = True
                parts.append(" ".join(pieces))
            if changed:
                tag["srcset"] = ", ".join(parts)


def _rewrite_css_urls(css_text: str, book_id: str, base_dir: str, asset_base_url: str | None = None) -> str:
    if not css_text:
        return css_text

    def repl(match):
        quote_char = match.group(1) or ""
        raw_url = (match.group(2) or "").strip()
        rewritten = _rewrite_url(book_id, base_dir, raw_url, asset_base_url)
        if not rewritten:
            return match.group(0)
        wrapped = f"{quote_char}{rewritten}{quote_char}" if quote_char else rewritten
        return f"url({wrapped})"

    return CSS_URL_RE.sub(repl, css_text)


def _rewrite_inline_style_tags(soup: BeautifulSoup, book_id: str, chapter_dir: str, asset_base_url: str | None = None) -> None:
    for style_tag in soup.find_all("style"):
        css_text = style_tag.string if style_tag.string is not None else style_tag.get_text()
        if not css_text:
            continue
        style_tag.string = _rewrite_css_urls(css_text, book_id, chapter_dir, asset_base_url)


def _collect_rewritten_styles(book, book_id: str, asset_base_url: str | None = None) -> list[str]:
    blocks = []
    for style_item in book.get_items_of_type(ebooklib.ITEM_STYLE):
        try:
            css_text = _decode_text_bytes(style_item.get_content())
        except Exception:
            continue
        style_dir = posixpath.dirname(_normalize_item_path(style_item))
        blocks.append(_rewrite_css_urls(css_text, book_id, style_dir, asset_base_url))
    return blocks


@lru_cache(maxsize=16)
def _collect_rewritten_styles_revision_cached(
    file_path: str,
    size: int,
    mtime_ns: int,
    book_id: str,
    asset_base_url: str = '',
) -> tuple:
    book = _read_epub_revision_cached(file_path, size, mtime_ns)
    return tuple(_collect_rewritten_styles(book, book_id, asset_base_url or None))


def _collect_rewritten_styles_cached(file_path: str, book_id: str, asset_base_url: str = '') -> tuple:
    """Cache collected styles per book and source revision."""
    return _collect_rewritten_styles_revision_cached(*_epub_revision_key(file_path), book_id, asset_base_url)


def _iter_toc_entries(entries):
    """Yield TOC entries recursively (supports nested tuple/list structures)."""
    if not entries:
        return
    if not isinstance(entries, (list, tuple)):
        entries = [entries]

    for entry in entries:
        if isinstance(entry, tuple):
            if not entry:
                continue
            head = entry[0]
            tail = entry[1] if len(entry) > 1 else None
            if head is not None:
                yield from _iter_toc_entries([head])
            if tail is not None:
                yield from _iter_toc_entries(tail)
            continue

        if isinstance(entry, list):
            yield from _iter_toc_entries(entry)
            continue

        yield entry

        # Some ebooklib TOC nodes expose nested children as subitems.
        subitems = getattr(entry, "subitems", None)
        if subitems:
            yield from _iter_toc_entries(subitems)


def _toc_from_nav(book, spine_items: list) -> list[dict] | None:
    """Try to build TOC from EPUB built-in navigation (much faster than parsing HTML)."""
    raw_toc = book.toc
    if not raw_toc:
        return None

    spine_map = {}
    for i, item in enumerate(spine_items):
        for p in _item_paths(item):
            normalized = _normalize_path(p)
            if normalized:
                spine_map[normalized] = i

    toc = []
    seen_indices = set()
    for entry in _iter_toc_entries(raw_toc):
        if not hasattr(entry, "href"):
            continue
        href = (entry.href or "").split('#')[0]
        path = _normalize_path(href)
        idx = spine_map.get(path)
        if idx is None:
            continue
        if idx in seen_indices:
            continue
        seen_indices.add(idx)
        title = getattr(entry, "title", None) or f"Chapter {idx + 1}"
        toc.append({"title": title, "index": idx, "href": entry.href or path})

    return toc if toc else None


def _inject_style_block(soup: BeautifulSoup, css_text: str) -> None:
    if not css_text:
        return
    style_tag = soup.new_tag("style")
    style_tag.string = css_text
    if soup.head:
        soup.head.insert(0, style_tag)
    elif soup.body:
        soup.body.insert(0, style_tag)
    else:
        soup.insert(0, style_tag)


def _render_chapter_fragment(soup: BeautifulSoup) -> str:
    if soup.head and soup.body:
        head_styles = list(soup.head.find_all("style"))
        for style_tag in reversed(head_styles):
            style_tag.extract()
            soup.body.insert(0, style_tag)
        return "".join(str(node) for node in soup.body.contents)
    if soup.body:
        return "".join(str(node) for node in soup.body.contents)
    return str(soup)


def _reader_safe_css() -> str:
    return (
        "img, svg { max-width: 100%; height: auto; }\n"
        "img, figure, table { break-inside: avoid; page-break-inside: avoid; }\n"
        "figure, blockquote, table { max-width: 100%; overflow: auto; }\n"
    )


def _decode_text_bytes(raw_bytes: bytes) -> str:
    if not raw_bytes:
        return ""

    candidates = []
    header = raw_bytes[:2048]
    for pattern in (DECLARED_XML_ENCODING_RE, DECLARED_META_CHARSET_RE):
        match = pattern.search(header)
        if not match:
            continue
        declared = match.group(1).decode("ascii", errors="ignore").strip()
        if declared:
            candidates.append(declared)

    detected = chardet.detect(raw_bytes[:TEXT_SAMPLE_SIZE]).get("encoding")
    if detected:
        candidates.append(detected)

    candidates.extend(["utf-8", "utf-8-sig", "cp949", "euc-kr", "utf-16", "latin-1"])
    tried = set()
    for encoding in candidates:
        normalized = (encoding or "").strip().lower()
        if not normalized or normalized in tried:
            continue
        tried.add(normalized)
        try:
            return raw_bytes.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue

    return raw_bytes.decode("utf-8", errors="replace")
