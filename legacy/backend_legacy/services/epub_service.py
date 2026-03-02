import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import base64
from typing import List


def get_epub_toc(file_path: str) -> dict:
    """Extract table of contents from an EPUB file."""
    book = epub.read_epub(file_path)
    spine_items = _get_spine_items(book)

    toc = []
    for i, item in enumerate(spine_items):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        # Try to find a heading for the title
        heading = soup.find(["h1", "h2", "h3", "h4", "title"])
        title = heading.get_text(strip=True) if heading else f"Chapter {i + 1}"
        if not title:
            title = f"Chapter {i + 1}"
        toc.append({"title": title, "index": i})

    book_title = book.get_metadata("DC", "title")
    book_title = book_title[0][0] if book_title else "Untitled"

    return {"title": book_title, "toc": toc}


def get_epub_chapter(file_path: str, chapter_index: int) -> dict:
    """Get the HTML content of a specific EPUB chapter."""
    book = epub.read_epub(file_path)
    spine_items = _get_spine_items(book)

    if chapter_index < 0 or chapter_index >= len(spine_items):
        return {"title": "Not Found", "html": "<p>Chapter not found.</p>", "index": chapter_index, "total": len(spine_items)}

    item = spine_items[chapter_index]
    html_content = item.get_content().decode("utf-8", errors="replace")

    # Inline images as base64
    soup = BeautifulSoup(html_content, "html.parser")
    for img_tag in soup.find_all("img"):
        src = img_tag.get("src", "")
        image_item = _find_image_item(book, src)
        if image_item:
            content = image_item.get_content()
            media_type = image_item.media_type
            b64 = base64.b64encode(content).decode("utf-8")
            img_tag["src"] = f"data:{media_type};base64,{b64}"

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


def _get_spine_items(book) -> list:
    """Get document items from the book spine in reading order."""
    spine_ids = [item_id for item_id, _ in book.spine]
    items = []
    for item_id in spine_ids:
        item = book.get_item_with_id(item_id)
        if item and item.get_type() == ebooklib.ITEM_DOCUMENT:
            items.append(item)
    return items


def _find_image_item(book, src: str):
    """Find an image item in the EPUB book by its src path."""
    for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
        if item.get_name().endswith(src) or src.endswith(item.get_name()):
            return item
        # Handle relative paths
        src_clean = src.lstrip("./")
        name_clean = item.get_name().lstrip("./")
        if src_clean == name_clean or name_clean.endswith(src_clean) or src_clean.endswith(name_clean):
            return item
    return None
