from typing import List

from fastapi import APIRouter, HTTPException

from models import Annotation, AnnotationCreate, AnnotationUpdate
from services.annotation_store import create_annotation, delete_annotation, list_book_annotations, update_annotation
from services.library_store import get_book_record

router = APIRouter(prefix="/api", tags=["annotations"])


def _ensure_book_exists(book_id: str) -> None:
    if not get_book_record(book_id):
        raise HTTPException(status_code=404, detail="Book not found")


@router.get("/books/{book_id}/annotations", response_model=List[Annotation])
async def get_book_annotations(book_id: str):
    _ensure_book_exists(book_id)
    return [Annotation(**record) for record in list_book_annotations(book_id)]


@router.post("/books/{book_id}/annotations", response_model=Annotation)
async def create_book_annotation(book_id: str, payload: AnnotationCreate):
    _ensure_book_exists(book_id)
    try:
        record = create_annotation(book_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return Annotation(**record)


@router.patch("/annotations/{annotation_id}", response_model=Annotation)
async def patch_book_annotation(annotation_id: str, payload: AnnotationUpdate):
    try:
        record = update_annotation(annotation_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if not record:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return Annotation(**record)


@router.delete("/annotations/{annotation_id}")
async def delete_book_annotation(annotation_id: str):
    removed = delete_annotation(annotation_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return {"detail": "Annotation deleted"}
