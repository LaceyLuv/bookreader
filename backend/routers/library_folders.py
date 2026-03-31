from typing import List

from fastapi import APIRouter, HTTPException

from models import LibraryFolder, LibraryFolderAssign, LibraryFolderAssignResult, LibraryFolderCreate, LibraryFolderUpdate
from services.library_store import add_folder_record, assign_books_to_folder, delete_folder_record, list_folder_records, update_folder_record

router = APIRouter(prefix='/api/library/folders', tags=['library'])


@router.get('', response_model=List[LibraryFolder])
async def list_library_folders():
    return list_folder_records()


@router.post('', response_model=LibraryFolder)
async def create_library_folder(payload: LibraryFolderCreate):
    try:
        return add_folder_record(payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail='Folder name already exists') from exc


@router.patch('/{folder_id}', response_model=LibraryFolder)
async def patch_library_folder(folder_id: str, payload: LibraryFolderUpdate):
    try:
        record = update_folder_record(folder_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail='Folder name already exists') from exc
    if not record:
        raise HTTPException(status_code=404, detail='Library folder not found')
    return record


@router.post('/assign', response_model=LibraryFolderAssignResult)
async def assign_library_folder(payload: LibraryFolderAssign):
    try:
        result = assign_books_to_folder(payload.book_ids, payload.folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {'updated_count': result.get('updated_count', 0)}


@router.delete('/{folder_id}')
async def remove_library_folder(folder_id: str):
    result = delete_folder_record(folder_id)
    if not result:
        raise HTTPException(status_code=404, detail='Library folder not found')
    return {
        'detail': 'Library folder removed',
        'cleared_books': result.get('cleared_books', 0),
    }
