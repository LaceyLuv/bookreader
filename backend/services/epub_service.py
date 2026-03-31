import mimetypes
import posixpath
import re
from functools import lru_cache
from urllib.parse import quote, unquote, urlsplit

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


@lru_cache(maxsize=8)
def _read_epub_cached(file_path: str):
    """Cache parsed EPUB books to avoid re-parsing on repeated access."""
    return epub.read_epub(file_path)


def clear_epub_caches() -> None:
    """Drop cached EPUB parse/style entries after library mutations."""
    _read_epub_cached.cache_clear()
    _collect_rewritten_styles_cached.cache_clear()

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
        toc.append({"title": title, "index": i})

    return {"title": book_title, "toc": toc}


def get_epub_chapter(file_path: str, chapter_index: int, book_id: str, asset_base_url: str | None = None) -> dict:
    """Get a chapter with asset URLs rewritten through the EPUB asset endpoint."""
    book = _read_epub_cached(file_path)
    spine_items = _get_spine_items(book)

    if chapter_index < 0 or chapter_index >= len(spine_items):
        return {"title": "Not Found", "html": "<p>Chapter not found.</p>", "index": chapter_index, "total": len(spine_items)}

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

    suffix = posixpath.splitext(normalized)[1].lower()
    media_type = (
        FONT_MEDIA_TYPES.get(suffix)
        or getattr(item, "media_type", None)
        or mimetypes.guess_type(normalized)[0]
        or "application/octet-stream"
    )
    return item.get_content(), media_type


def _get_spine_items(book) -> list:
    """Get document items from the book spine in reading order."""
    spine_ids = [item_id for item_id, _ in book.spine]
    items = []
    for item_id in spine_ids:
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
    raw = unquote(str(path)).replace("\\", "/").strip()
    parsed = urlsplit(raw)
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
    suffix = f"/{target}"
    for item in book.get_items():
        for candidate in _item_paths(item):
            normalized = _normalize_path(candidate)
            if not normalized:
                continue
            if normalized == target or normalized.endswith(suffix):
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
def _collect_rewritten_styles_cached(file_path: str, book_id: str, asset_base_url: str = '') -> tuple:
    """Cache collected styles per book to avoid re-processing for every chapter."""
    book = _read_epub_cached(file_path)
    return tuple(_collect_rewritten_styles(book, book_id, asset_base_url or None))


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
        toc.append({"title": title, "index": idx})

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
