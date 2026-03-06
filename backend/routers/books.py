import hashlib
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException, Request
from fastapi.responses import Response

from models import BookMeta, TxtContent, EpubToc, EpubChapter, ZipImageList
from paths import BOOKS_DIR
from services.txt_service import read_txt_file
from services.epub_service import get_epub_toc, get_epub_chapter, get_epub_asset
from services.zip_service import list_zip_images, get_zip_image

router = APIRouter(prefix="/api/books", tags=["books"])

ALLOWED_EXTENSIONS = {"txt", "epub", "zip"}

EPUB_DEBUG_LOG_PATH = Path(tempfile.gettempdir()) / "bookreader_epub_debug.log"
HTML_IMG_SRC_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)
HTML_FONT_URL_RE = re.compile(r"url\((?:[\"']?)([^)\"']+)(?:[\"']?)\)", re.IGNORECASE)


def _append_epub_debug(event: str, **fields):
    payload = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "event": event,
        **fields,
    }
    try:
        with EPUB_DEBUG_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _first_html_match(pattern, html: str | None) -> str:
    if not html:
        return ""
    match = pattern.search(html)
    return match.group(1) if match else ""


def _get_file_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ALLOWED_EXTENSIONS:
        return ext
    return ""


def _make_id(filename: str) -> str:
    return hashlib.md5(filename.encode()).hexdigest()[:12]


def _get_book_meta(filepath: Path) -> BookMeta:
    stat = filepath.stat()
    filename = filepath.name
    return BookMeta(
        id=_make_id(filename),
        title=filepath.stem,
        file_type=_get_file_type(filename),
        filename=filename,
        size=stat.st_size,
        upload_date=datetime.fromtimestamp(stat.st_mtime).isoformat(),
    )


def _find_book_path(book_id: str) -> Path:
    """Look up a book by ID using a cached directory index (O(1) after first scan)."""
    idx = _get_book_index()
    path = idx.get(book_id)
    if not path or not path.exists():
        _invalidate_book_index()
        idx = _get_book_index()
        path = idx.get(book_id)
    if not path:
        raise HTTPException(status_code=404, detail="Book not found")
    return path


# ─── In-memory book index ───────────────────────────────────────

_book_index: dict[str, Path] = {}
_book_index_mtime: float = 0.0


def _get_book_index() -> dict[str, Path]:
    global _book_index, _book_index_mtime
    try:
        current_mtime = BOOKS_DIR.stat().st_mtime
    except FileNotFoundError:
        return {}
    if current_mtime != _book_index_mtime:
        _book_index = {}
        for f in BOOKS_DIR.iterdir():
            if f.is_file() and _get_file_type(f.name):
                _book_index[_make_id(f.name)] = f
        _book_index_mtime = current_mtime
    return _book_index


def _invalidate_book_index():
    global _book_index_mtime
    _book_index_mtime = 0.0


# ─── Library CRUD ───────────────────────────────────────────────

@router.get("", response_model=List[BookMeta])
async def list_books():
    """List all books in the library."""
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    books = []
    for f in sorted(BOOKS_DIR.iterdir()):
        if f.is_file() and _get_file_type(f.name):
            books.append(_get_book_meta(f))
    return books


@router.post("", response_model=BookMeta)
async def upload_book(file: UploadFile = File(...)):
    """Upload a new book file."""
    file_type = _get_file_type(file.filename)
    if not file_type:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    dest = BOOKS_DIR / file.filename

    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    _invalidate_book_index()
    return _get_book_meta(dest)


@router.delete("/{book_id}")
async def delete_book(book_id: str):
    """Delete a book from the library."""
    path = _find_book_path(book_id)
    path.unlink()
    _invalidate_book_index()
    return {"detail": "Book deleted"}


# ─── TXT Reader ─────────────────────────────────────────────────

@router.get("/{book_id}/content", response_model=TxtContent)
async def get_txt_content(book_id: str):
    """Get the text content of a TXT file with auto-detected encoding."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "txt":
        raise HTTPException(status_code=400, detail="Not a TXT file")
    result = read_txt_file(str(path))
    return TxtContent(**result)


# ─── EPUB Reader ────────────────────────────────────────────────

@router.get("/{book_id}/toc", response_model=EpubToc)
async def get_toc(book_id: str):
    """Get the table of contents of an EPUB file."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "epub":
        raise HTTPException(status_code=400, detail="Not an EPUB file")
    result = get_epub_toc(str(path))
    return EpubToc(**result)


@router.get("/{book_id}/chapter/{chapter_index}", response_model=EpubChapter)
async def get_chapter(book_id: str, chapter_index: int, request: Request):
    """Get the HTML content of a specific EPUB chapter."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "epub":
        raise HTTPException(status_code=400, detail="Not an EPUB file")
    asset_base_url = f"{str(request.base_url).rstrip('/')}/api/books/{book_id}/asset"
    _append_epub_debug(
        "chapter_request",
        book_id=book_id,
        chapter_index=chapter_index,
        asset_base_url=asset_base_url,
        origin=request.headers.get("origin"),
        referer=request.headers.get("referer"),
    )
    result = get_epub_chapter(str(path), chapter_index, book_id, asset_base_url=asset_base_url)
    _append_epub_debug(
        "chapter_response",
        book_id=book_id,
        chapter_index=chapter_index,
        title=result.get("title"),
        html_len=len(result.get("html", "")),
        first_img_src=_first_html_match(HTML_IMG_SRC_RE, result.get("html")),
        first_font_url=_first_html_match(HTML_FONT_URL_RE, result.get("html")),
    )
    return EpubChapter(**result)


@router.get("/{book_id}/asset/{asset_path:path}")
async def get_epub_asset_file(book_id: str, asset_path: str, request: Request):
    """Serve a single asset from an EPUB archive (image/font/css/etc)."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "epub":
        raise HTTPException(status_code=400, detail="Not an EPUB file")

    try:
        data, media_type = get_epub_asset(str(path), asset_path)
    except FileNotFoundError:
        _append_epub_debug(
            "asset_missing",
            book_id=book_id,
            asset_path=asset_path,
            origin=request.headers.get("origin"),
            referer=request.headers.get("referer"),
        )
        raise HTTPException(status_code=404, detail="Asset not found") from None

    _append_epub_debug(
        "asset_response",
        book_id=book_id,
        asset_path=asset_path,
        media_type=media_type,
        size=len(data),
        origin=request.headers.get("origin"),
        referer=request.headers.get("referer"),
    )
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ─── ZIP/Comic Reader ──────────────────────────────────────────

@router.get("/{book_id}/images", response_model=ZipImageList)
async def get_images(book_id: str):
    """List all images in a ZIP archive."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "zip":
        raise HTTPException(status_code=400, detail="Not a ZIP file")
    result = list_zip_images(str(path))
    return ZipImageList(**result)


@router.get("/{book_id}/image/{image_name:path}")
async def get_image(book_id: str, image_name: str):
    """Serve a single image from a ZIP archive."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "zip":
        raise HTTPException(status_code=400, detail="Not a ZIP file")
    data, media_type = get_zip_image(str(path), image_name)
    return Response(content=data, media_type=media_type)
