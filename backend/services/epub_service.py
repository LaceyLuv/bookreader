import mimetypes
import posixpath
import re
from urllib.parse import unquote, urlsplit

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

CSS_URL_RE = re.compile(r"url\(\s*([\"']?)(.*?)\1\s*\)", re.IGNORECASE)
ASSET_SCHEMES = ("http://", "https://", "data:", "mailto:", "javascript:")


def get_epub_toc(file_path: str) -> dict:
    """Extract table of contents from an EPUB file."""
    book = epub.read_epub(file_path)
    spine_items = _get_spine_items(book)

    toc = []
    for i, item in enumerate(spine_items):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        heading = soup.find(["h1", "h2", "h3", "h4", "title"])
        title = heading.get_text(strip=True) if heading else f"Chapter {i + 1}"
        if not title:
            title = f"Chapter {i + 1}"
        toc.append({"title": title, "index": i})

    book_title = book.get_metadata("DC", "title")
    book_title = book_title[0][0] if book_title else "Untitled"

    return {"title": book_title, "toc": toc}


def get_epub_chapter(file_path: str, chapter_index: int, book_id: str) -> dict:
    """Get a chapter with asset URLs rewritten through /api/books/{book_id}/asset/..."""
    book = epub.read_epub(file_path)
    spine_items = _get_spine_items(book)

    if chapter_index < 0 or chapter_index >= len(spine_items):
        return {"title": "Not Found", "html": "<p>Chapter not found.</p>", "index": chapter_index, "total": len(spine_items)}

    chapter_item = spine_items[chapter_index]
    chapter_path = _normalize_item_path(chapter_item)
    chapter_dir = posixpath.dirname(chapter_path) if chapter_path else ""

    html_content = chapter_item.get_content().decode("utf-8", errors="replace")
    soup = BeautifulSoup(html_content, "html.parser")

    _rewrite_html_asset_attrs(soup, book_id, chapter_dir)
    _rewrite_inline_style_tags(soup, book_id, chapter_dir)

    style_blocks = _collect_rewritten_styles(book, book_id)
    style_blocks.append(_reader_safe_css())
    _inject_style_block(soup, "\n\n".join(block for block in style_blocks if block))

    heading = soup.find(["h1", "h2", "h3", "h4", "title"])
    title = heading.get_text(strip=True) if heading else f"Chapter {chapter_index + 1}"
    if not title:
        title = f"Chapter {chapter_index + 1}"

    return {
        "title": title,
        "html": str(soup),
        "index": chapter_index,
        "total": len(spine_items),
    }


def get_epub_asset(file_path: str, asset_path: str) -> tuple[bytes, str]:
    """Read a referenced EPUB asset file."""
    book = epub.read_epub(file_path)
    normalized = _normalize_path(asset_path)
    if not normalized:
        raise FileNotFoundError("Invalid asset path")

    item = _find_item_by_path(book, normalized)
    if not item:
        raise FileNotFoundError("Asset not found")

    media_type = getattr(item, "media_type", None) or mimetypes.guess_type(normalized)[0] or "application/octet-stream"
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


def _asset_url(book_id: str, asset_path: str) -> str:
    return f"/api/books/{book_id}/asset/{asset_path}"


def _rewrite_url(book_id: str, base_dir: str, raw_url: str) -> str | None:
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
    return _asset_url(book_id, resolved)


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


def _rewrite_html_asset_attrs(soup: BeautifulSoup, book_id: str, chapter_dir: str) -> None:
    for tag in soup.find_all(["img", "image", "link", "source"]):
        for attr in ("src", "href", "xlink:href"):
            raw = tag.get(attr)
            rewritten = _rewrite_url(book_id, chapter_dir, raw)
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
                rewritten = _rewrite_url(book_id, chapter_dir, pieces[0])
                if rewritten:
                    pieces[0] = rewritten
                    changed = True
                parts.append(" ".join(pieces))
            if changed:
                tag["srcset"] = ", ".join(parts)


def _rewrite_css_urls(css_text: str, book_id: str, base_dir: str) -> str:
    if not css_text:
        return css_text

    def repl(match):
        quote = match.group(1) or ""
        raw_url = (match.group(2) or "").strip()
        rewritten = _rewrite_url(book_id, base_dir, raw_url)
        if not rewritten:
            return match.group(0)
        wrapped = f"{quote}{rewritten}{quote}" if quote else rewritten
        return f"url({wrapped})"

    return CSS_URL_RE.sub(repl, css_text)


def _rewrite_inline_style_tags(soup: BeautifulSoup, book_id: str, chapter_dir: str) -> None:
    for style_tag in soup.find_all("style"):
        css_text = style_tag.string if style_tag.string is not None else style_tag.get_text()
        if not css_text:
            continue
        style_tag.string = _rewrite_css_urls(css_text, book_id, chapter_dir)


def _collect_rewritten_styles(book, book_id: str) -> list[str]:
    blocks = []
    for style_item in book.get_items_of_type(ebooklib.ITEM_STYLE):
        try:
            css_text = style_item.get_content().decode("utf-8", errors="replace")
        except Exception:
            continue
        style_dir = posixpath.dirname(_normalize_item_path(style_item))
        blocks.append(_rewrite_css_urls(css_text, book_id, style_dir))
    return blocks


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


def _reader_safe_css() -> str:
    return (
        "img, svg { max-width: 100%; height: auto; }\n"
        "img, figure, table { break-inside: avoid; page-break-inside: avoid; }\n"
        "figure, blockquote, table { max-width: 100%; overflow: auto; }\n"
    )
