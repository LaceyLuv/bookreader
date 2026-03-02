import os
import hashlib
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response

from models import BookMeta, BookListResponse, TxtContent, EpubToc, EpubChapter, ZipImageList
from services.txt_service import read_txt_file
from services.epub_service import get_epub_toc, get_epub_chapter
from services.zip_service import list_zip_images, get_zip_image

router = APIRouter(prefix="/api/books", tags=["books"])

BOOKS_DIR = Path(__file__).resolve().parent.parent / "books"
ALLOWED_EXTENSIONS = {"txt", "epub", "zip"}


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
    for f in BOOKS_DIR.iterdir():
        if f.is_file() and _make_id(f.name) == book_id:
            return f
    raise HTTPException(status_code=404, detail="Book not found")


# ─── Library CRUD ───────────────────────────────────────────────

@router.get("", response_model=BookListResponse)
async def list_books():
    """List all books in the library."""
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    books = []
    for f in sorted(BOOKS_DIR.iterdir()):
        if f.is_file() and _get_file_type(f.name):
            books.append(_get_book_meta(f))
    return BookListResponse(books=books)


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

    return _get_book_meta(dest)


@router.delete("/{book_id}")
async def delete_book(book_id: str):
    """Delete a book from the library."""
    path = _find_book_path(book_id)
    path.unlink()
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
async def get_chapter(book_id: str, chapter_index: int):
    """Get the HTML content of a specific EPUB chapter."""
    path = _find_book_path(book_id)
    if _get_file_type(path.name) != "epub":
        raise HTTPException(status_code=400, detail="Not an EPUB file")
    result = get_epub_chapter(str(path), chapter_index)
    return EpubChapter(**result)


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
