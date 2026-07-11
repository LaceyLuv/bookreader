import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from models import BookInfo, BookMeta, BookMetaUpdate, BookSearchResponse, EpubChapter, EpubToc, TxtContent, TxtManifest, TxtSegmentWindow, ZipImageList
from paths import BOOKS_DIR
from services.annotation_store import delete_book_annotations, get_annotation_counts_by_book
from services.epub_service import EpubSafetyError, clear_epub_caches, get_epub_asset, get_epub_chapter, get_epub_toc
from services.library_store import add_book_record, delete_book_record, get_book_path, get_book_record, list_book_records, prepare_upload, restore_book_record, touch_book, update_book_record
from services.search_service import clear_search_caches, prewarm_search_cache, search_epub_file, search_txt_file
from services.txt_service import clear_txt_caches, read_txt_file, read_txt_manifest, read_txt_segment_window
from services.zip_service import ZipSafetyError, get_zip_image, list_zip_images
from services.delete_recovery import begin_delete, finish_delete, mark_delete_phase

router = APIRouter(prefix='/api/books', tags=['books'])

ALLOWED_EXTENSIONS = {'txt', 'epub', 'zip'}
EPUB_DEBUG_ENABLED = os.getenv('BOOKREADER_EPUB_DEBUG') == '1'
UPLOAD_CHUNK_SIZE = 1024 * 1024
MAX_BOOK_UPLOAD_BYTES = int(os.getenv('BOOKREADER_MAX_BOOK_UPLOAD_BYTES', str(512 * 1024 * 1024)))
MAX_BOOK_UPLOAD_REQUEST_BYTES = int(os.getenv('BOOKREADER_MAX_BOOK_UPLOAD_REQUEST_BYTES', str(MAX_BOOK_UPLOAD_BYTES + UPLOAD_CHUNK_SIZE)))

EPUB_DEBUG_LOG_PATH = Path(tempfile.gettempdir()) / 'bookreader_epub_debug.log'
HTML_IMG_SRC_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
HTML_FONT_URL_RE = re.compile(r'url\((?:["\']?)([^)"\']+)(?:["\']?)\)', re.IGNORECASE)


def _delete_journal_path() -> Path:
    return BOOKS_DIR.parent / 'delete-journal.json'


def _append_epub_debug(event: str, **fields):
    if not EPUB_DEBUG_ENABLED:
        return
    payload = {
        'ts': datetime.now().isoformat(timespec='seconds'),
        'event': event,
        **fields,
    }
    try:
        with EPUB_DEBUG_LOG_PATH.open('a', encoding='utf-8') as f:
            f.write(json.dumps(payload, ensure_ascii=False) + '\n')
    except OSError:
        pass


def _first_html_match(pattern, html: str | None) -> str:
    if not html:
        return ''
    match = pattern.search(html)
    return match.group(1) if match else ''


def _book_meta_from_record(record: dict, annotation_count: int = 0) -> BookMeta:
    return BookMeta(**record, annotation_count=annotation_count)


def _book_info_from_record(record: dict, annotation_count: int = 0) -> BookInfo:
    payload = dict(record)
    payload['path'] = str(get_book_path(record))
    payload['annotation_count'] = annotation_count
    return BookInfo(**payload)


def _clear_related_caches(file_type: str) -> None:
    if file_type == 'txt':
        clear_txt_caches()
        clear_search_caches()
    elif file_type == 'epub':
        clear_epub_caches()
        clear_search_caches()


async def _save_upload_file(file: UploadFile, destination: Path) -> None:
    total_bytes = 0
    temp_path = destination.with_name(f'.{destination.name}.{uuid4().hex}.uploading')
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with temp_path.open('wb') as f:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_BOOK_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail='Book file is too large')
                f.write(chunk)
            f.flush()
            os.fsync(f.fileno())
        temp_path.replace(destination)
        _fsync_directory(destination.parent)
    except Exception:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        raise
    finally:
        await file.close()


def _fsync_directory(path: Path) -> None:
    try:
        directory_fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    except OSError:
        pass
    finally:
        os.close(directory_fd)


def _cleanup_failed_upload(destination: Path) -> None:
    candidates = [destination]
    try:
        candidates.extend(destination.parent.glob(f'{destination.name}.*'))
        candidates.extend(destination.parent.glob(f'.{destination.name}.*'))
    except OSError:
        pass
    for path in candidates:
        if path.is_file() and (path == destination or path.suffix.lower() in {'.uploading', '.tmp', '.partial'}):
            path.unlink(missing_ok=True)


def _trash_path_for(path: Path) -> Path:
    trash_dir = BOOKS_DIR / '.trash'
    trash_dir.mkdir(parents=True, exist_ok=True)
    return trash_dir / f'{path.name}.{uuid4().hex}.trash'


def _get_record_or_404(book_id: str) -> dict:
    record = get_book_record(book_id)
    if not record:
        raise HTTPException(status_code=404, detail='Book not found')
    return record


def _reject_oversized_content_length(request: Request) -> None:
    raw_value = request.headers.get('content-length')
    if raw_value is None:
        return
    try:
        content_length = int(raw_value)
    except ValueError:
        return
    if content_length > MAX_BOOK_UPLOAD_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail='Book file is too large')


def _resolve_book_file(book_id: str) -> tuple[dict, Path]:
    record = _get_record_or_404(book_id)
    path = get_book_path(record)
    if not path.exists():
        _clear_related_caches(record['file_type'])
        raise HTTPException(status_code=404, detail='Book file not found')
    return record, path


def _touch_book_open(record: dict) -> dict:
    return touch_book(record['id'], opened=True, read=True) or record


def _schedule_search_prewarm(background_tasks: BackgroundTasks | None, path: Path, file_type: str) -> None:
    if background_tasks is None or file_type not in {'txt', 'epub'}:
        return
    background_tasks.add_task(prewarm_search_cache, str(path), file_type)


@router.get('', response_model=List[BookMeta])
async def list_books():
    counts = get_annotation_counts_by_book()
    return [_book_meta_from_record(record, counts.get(record['id'], 0)) for record in list_book_records()]


@router.post('', response_model=BookMeta)
async def upload_book(request: Request, file: UploadFile = File(...)):
    _reject_oversized_content_length(request)
    try:
        upload_plan = prepare_upload(file.filename)
    except ValueError:
        allowed = ', '.join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f'Unsupported file type. Allowed: {allowed}') from None

    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    destination = BOOKS_DIR / upload_plan['stored_filename']

    try:
        await _save_upload_file(file, destination)
    except HTTPException:
        _cleanup_failed_upload(destination)
        raise
    except Exception as exc:
        _cleanup_failed_upload(destination)
        raise HTTPException(status_code=500, detail='Failed to save uploaded book') from exc
    try:
        record = add_book_record(
            book_id=upload_plan['id'],
            filename=upload_plan['filename'],
            stored_filename=upload_plan['stored_filename'],
        )
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    _clear_related_caches(upload_plan['file_type'])
    return _book_meta_from_record(record, 0)


@router.get('/{book_id}', response_model=BookInfo)
async def get_book_info(book_id: str):
    record = _get_record_or_404(book_id)
    counts = get_annotation_counts_by_book()
    return _book_info_from_record(record, counts.get(record['id'], 0))


@router.patch('/{book_id}', response_model=BookMeta)
async def patch_book(book_id: str, payload: BookMetaUpdate):
    try:
        record = update_book_record(book_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not record:
        raise HTTPException(status_code=404, detail='Book not found')
    counts = get_annotation_counts_by_book()
    return _book_meta_from_record(record, counts.get(record['id'], 0))


@router.post('/{book_id}/open', response_model=BookMeta)
async def mark_book_open(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    record = touch_book(record['id'], opened=True, read=True)
    if not record:
        raise HTTPException(status_code=404, detail='Book not found')
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    counts = get_annotation_counts_by_book()
    return _book_meta_from_record(record, counts.get(record['id'], 0))


@router.delete('/{book_id}')
async def delete_book(book_id: str):
    record = _get_record_or_404(book_id)
    path = get_book_path(record)
    file_type = record['file_type']
    trash_path = None
    removed_record = None
    journal_started = False
    trash_path = _trash_path_for(path)
    journal_path = _delete_journal_path()
    try:
        begin_delete(record, trash_path.name, journal_path=journal_path)
        journal_started = True
    except Exception as exc:
        raise HTTPException(status_code=500, detail='Failed to journal book deletion') from exc
    if path.exists():
        try:
            path.replace(trash_path)
            _fsync_directory(path.parent)
            _fsync_directory(trash_path.parent)
            mark_delete_phase(record['id'], 'file_staged', journal_path=journal_path)
        except Exception as exc:
            restored = True
            if trash_path.exists() and not path.exists():
                try:
                    trash_path.replace(path)
                    _fsync_directory(path.parent)
                except OSError:
                    restored = False
            if journal_started and restored:
                finish_delete(record['id'], journal_path=journal_path)
            raise HTTPException(status_code=500, detail='Failed to stage book file for deletion') from exc
    try:
        removed_record = delete_book_record(record['id'])
        mark_delete_phase(record['id'], 'metadata_deleted', journal_path=journal_path)
        delete_book_annotations(record['id'])
        mark_delete_phase(record['id'], 'annotations_deleted', journal_path=journal_path)
    except Exception as exc:
        rollback_errors = []
        if trash_path is not None and trash_path.exists() and not path.exists():
            try:
                trash_path.replace(path)
                _fsync_directory(path.parent)
            except OSError as rollback_exc:
                rollback_errors.append(f'file rollback failed: {rollback_exc}')
        if removed_record is not None:
            try:
                restore_book_record(removed_record)
            except Exception as rollback_exc:
                rollback_errors.append(f'library rollback failed: {rollback_exc}')
        if not rollback_errors:
            try:
                finish_delete(record['id'], journal_path=journal_path)
            except Exception as rollback_exc:
                rollback_errors.append(f'journal cleanup failed: {rollback_exc}')
        detail = 'Failed to delete book'
        if rollback_errors:
            detail = f"{detail}; {'; '.join(rollback_errors)}"
        raise HTTPException(status_code=500, detail=detail) from exc
    if trash_path is not None:
        try:
            trash_path.unlink(missing_ok=True)
            _fsync_directory(trash_path.parent)
        except OSError as exc:
            raise HTTPException(status_code=500, detail='Book metadata deleted, but trash cleanup failed') from exc
    finish_delete(record['id'], journal_path=journal_path)
    _clear_related_caches(file_type)
    return {'detail': 'Book deleted'}


@router.get('/{book_id}/content', response_model=TxtContent)
async def get_txt_content(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')
    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    result = read_txt_file(str(path))
    return TxtContent(**result)


@router.get('/{book_id}/txt-manifest', response_model=TxtManifest)
async def get_txt_manifest(
    book_id: str,
    background_tasks: BackgroundTasks,
    trim_spaces: bool = False,
    remove_empty_lines: bool = False,
    split_paragraphs: bool = False,
):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')
    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    manifest = read_txt_manifest(
        str(path),
        transform_options={
            'trim_spaces': trim_spaces,
            'remove_empty_lines': remove_empty_lines,
            'split_paragraphs': split_paragraphs,
        },
        include_fragments=False,
        include_segments=False,
    )
    return TxtManifest(title=record.get('title') or Path(record.get('filename', '')).stem or None, **manifest)


@router.get('/{book_id}/txt-segments', response_model=TxtSegmentWindow)
async def get_txt_segments(
    book_id: str,
    start: int = 0,
    limit: int = 40,
    trim_spaces: bool = False,
    remove_empty_lines: bool = False,
    split_paragraphs: bool = False,
):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')

    window = read_txt_segment_window(
        str(path),
        start=start,
        limit=limit,
        transform_options={
            'trim_spaces': trim_spaces,
            'remove_empty_lines': remove_empty_lines,
            'split_paragraphs': split_paragraphs,
        },
    )
    return TxtSegmentWindow(**window)


@router.get('/{book_id}/toc', response_model=EpubToc)
async def get_toc(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'epub':
        raise HTTPException(status_code=400, detail='Not an EPUB file')
    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    try:
        result = get_epub_toc(str(path))
    except EpubSafetyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EpubToc(**result)


@router.get('/{book_id}/chapter/{chapter_index}', response_model=EpubChapter)
async def get_chapter(book_id: str, chapter_index: int, request: Request, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'epub':
        raise HTTPException(status_code=400, detail='Not an EPUB file')

    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    asset_base_url = f"/api/books/{record['id']}/asset"
    if EPUB_DEBUG_ENABLED:
        _append_epub_debug(
            'chapter_request',
            book_id=record['id'],
            chapter_index=chapter_index,
            asset_base_url=asset_base_url,
            origin=request.headers.get('origin'),
            referer=request.headers.get('referer'),
        )

    try:
        result = get_epub_chapter(str(path), chapter_index, record['id'], asset_base_url=asset_base_url)
    except EpubSafetyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if EPUB_DEBUG_ENABLED:
        _append_epub_debug(
            'chapter_response',
            book_id=record['id'],
            chapter_index=chapter_index,
            title=result.get('title'),
            html_len=len(result.get('html', '')),
            first_img_src=_first_html_match(HTML_IMG_SRC_RE, result.get('html')),
            first_font_url=_first_html_match(HTML_FONT_URL_RE, result.get('html')),
        )
    return EpubChapter(**result)


@router.get('/{book_id}/asset/{asset_path:path}')
async def get_epub_asset_file(book_id: str, asset_path: str, request: Request):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'epub':
        raise HTTPException(status_code=400, detail='Not an EPUB file')

    try:
        data, media_type = get_epub_asset(str(path), asset_path)
    except FileNotFoundError:
        if EPUB_DEBUG_ENABLED:
            _append_epub_debug(
                'asset_missing',
                book_id=record['id'],
                asset_path=asset_path,
                origin=request.headers.get('origin'),
                referer=request.headers.get('referer'),
            )
        raise HTTPException(status_code=404, detail='Asset not found') from None
    except EpubSafetyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if EPUB_DEBUG_ENABLED:
        _append_epub_debug(
            'asset_response',
            book_id=record['id'],
            asset_path=asset_path,
            media_type=media_type,
            size=len(data),
            origin=request.headers.get('origin'),
            referer=request.headers.get('referer'),
        )
    return Response(
        content=data,
        media_type=media_type,
        headers={
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        },
    )


@router.get('/{book_id}/search', response_model=BookSearchResponse)
async def search_book(
    book_id: str,
    q: str = Query('', min_length=0, max_length=120),
    trim_spaces: bool = False,
    remove_empty_lines: bool = False,
    split_paragraphs: bool = False,
):
    record, path = _resolve_book_file(book_id)
    query = q.strip()
    if not query:
        return BookSearchResponse(query='', total=0, results=[])

    _touch_book_open(record)
    if record['file_type'] == 'txt':
        result = search_txt_file(
            str(path),
            query,
            transform_options={
                'trim_spaces': trim_spaces,
                'remove_empty_lines': remove_empty_lines,
                'split_paragraphs': split_paragraphs,
            },
        )
    elif record['file_type'] == 'epub':
        try:
            result = search_epub_file(str(path), query)
        except EpubSafetyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        raise HTTPException(status_code=400, detail='Search is only supported for TXT and EPUB')
    return BookSearchResponse(**result)


@router.get('/{book_id}/images', response_model=ZipImageList)
async def get_images(book_id: str):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'zip':
        raise HTTPException(status_code=400, detail='Not a ZIP file')
    _touch_book_open(record)
    try:
        result = list_zip_images(str(path))
    except ZipSafetyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ZipImageList(**result)


@router.get('/{book_id}/image/{image_name:path}')
async def get_image(book_id: str, image_name: str):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'zip':
        raise HTTPException(status_code=400, detail='Not a ZIP file')
    try:
        data, media_type = get_zip_image(str(path), image_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Image not found') from None
    except ZipSafetyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=data, media_type=media_type)
