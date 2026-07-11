from fastapi import APIRouter, HTTPException, Response

from models import ReadingProgressUpdate
from services.library_store import get_book_record
from services.reading_progress_store import delete_reading_progress, get_reading_progress, save_reading_progress

router = APIRouter(prefix="/api/books", tags=["reading-progress"])


@router.get("/{book_id}/progress")
async def read_progress(book_id: str):
    if not get_book_record(book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    record = get_reading_progress(book_id)
    if record is None:
        return Response(status_code=204)
    return record


@router.put("/{book_id}/progress")
async def write_progress(book_id: str, payload: ReadingProgressUpdate):
    if not get_book_record(book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    return save_reading_progress(book_id, payload.model_dump())


@router.delete("/{book_id}/progress", status_code=204)
async def remove_progress(book_id: str):
    delete_reading_progress(book_id)
    return Response(status_code=204)
