import json
import asyncio
import os
import re
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import List
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from models import BookDiagnostics, BookInfo, BookMeta, BookMetaUpdate, BookSearchResponse, EpubChapter, EpubToc, TxtContent, TxtEncodingPreview, TxtManifest, TxtSegmentWindow, ZipImageList
from paths import BOOKS_DIR
from services.annotation_store import delete_book_annotations, get_annotation_counts_by_book
from services.epub_service import EpubSafetyError, clear_epub_caches, diagnose_epub, get_epub_asset, get_epub_chapter, get_epub_toc
from services.library_store import add_book_record, delete_book_record, get_book_path, get_book_record, list_book_records, prepare_upload, touch_book, update_book_record
from services.search_service import clear_search_caches, prewarm_search_cache, search_epub_file, search_txt_file
from services.txt_service import TXT_WINDOW_MAX_CHARS, clear_txt_caches, prepare_txt_index, read_txt_encoding_preview, read_txt_file, read_txt_manifest, read_txt_segment_window, should_prewarm_txt_search
from services.zip_service import ZipSafetyError, clear_zip_caches, diagnose_zip, get_zip_image, list_zip_images
from services.delete_recovery import begin_delete, finish_delete, mark_delete_phase
from services.reading_progress_store import delete_reading_progress

router = APIRouter(prefix='/api/books', tags=['books'])
_DELETE_LOCK = threading.Lock()

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
    elif file_type == 'zip':
        clear_zip_caches()


def _format_code_status(code: str) -> int:
    if 'resource_limit' in code or 'too_large' in code or 'too_many' in code or 'compression_ratio' in code:
        return 413
    if 'drm' in code or 'encrypted' in code or 'unsupported_compression' in code:
        return 415
    if 'not_found' in code or 'missing_asset' in code:
        return 404
    return 422


def _format_error_status(exc) -> int:
    return _format_code_status(getattr(exc, 'code', ''))


def _format_error_detail(exc) -> dict:
    converter = getattr(exc, 'to_problem', None)
    if callable(converter):
        return converter()
    return {
        'code': 'format_invalid',
        'message': str(exc),
        'severity': 'error',
        'stage': 'format',
        'retryable': False,
        'recovery': 'choose_another_file',
        'context': {},
    }


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


def _schedule_search_prewarm(background_tasks: BackgroundTasks | None, path: Path, file_type: str, encoding_override: str | None = None) -> None:
    if background_tasks is None or file_type not in {'txt', 'epub'}:
        return
    if file_type == 'txt' and not should_prewarm_txt_search(str(path)):
        return
    if encoding_override is None:
        background_tasks.add_task(prewarm_search_cache, str(path), file_type)
    else:
        background_tasks.add_task(prewarm_search_cache, str(path), file_type, encoding_override)


@router.get('', response_model=List[BookMeta])
async def list_books():
    counts = get_annotation_counts_by_book()
    return [_book_meta_from_record(record, counts.get(record['id'], 0)) for record in list_book_records()]


@router.post('', response_model=BookMeta)
async def upload_book(request: Request, background_tasks: BackgroundTasks, file: UploadFile = File(...)):
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
        if upload_plan['file_type'] == 'epub':
            diagnosis = await run_in_threadpool(diagnose_epub, str(destination))
            if diagnosis.get('status') == 'unsupported_or_corrupt':
                issue = (diagnosis.get('issues') or [{}])[0]
                raise HTTPException(
                    status_code=_format_code_status(str(issue.get('code') or 'epub_invalid_archive')),
                    detail=issue,
                )
        elif upload_plan['file_type'] == 'zip':
            await run_in_threadpool(list_zip_images, str(destination))
    except HTTPException:
        _cleanup_failed_upload(destination)
        _clear_related_caches(upload_plan['file_type'])
        raise
    except ZipSafetyError as exc:
        _cleanup_failed_upload(destination)
        _clear_related_caches(upload_plan['file_type'])
        raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc

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
    if upload_plan['file_type'] == 'txt':
        background_tasks.add_task(prepare_txt_index, str(destination))
    return _book_meta_from_record(record, 0)


@router.get('/{book_id}', response_model=BookInfo)
async def get_book_info(book_id: str):
    record = _get_record_or_404(book_id)
    counts = get_annotation_counts_by_book()
    return _book_info_from_record(record, counts.get(record['id'], 0))


@router.patch('/{book_id}', response_model=BookMeta)
async def patch_book(book_id: str, payload: BookMetaUpdate):
    previous = get_book_record(book_id)
    updates = payload.model_dump(exclude_unset=True)
    try:
        record = update_book_record(book_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not record:
        raise HTTPException(status_code=404, detail='Book not found')
    if 'txt_encoding_override' in updates and previous and previous.get('txt_encoding_override') != record.get('txt_encoding_override'):
        _clear_related_caches(record['file_type'])
    counts = get_annotation_counts_by_book()
    return _book_meta_from_record(record, counts.get(record['id'], 0))


@router.post('/{book_id}/open', response_model=BookMeta)
async def mark_book_open(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    record = touch_book(record['id'], opened=True, read=True)
    if not record:
        raise HTTPException(status_code=404, detail='Book not found')
    _schedule_search_prewarm(background_tasks, path, record['file_type'], record.get('txt_encoding_override'))
    counts = get_annotation_counts_by_book()
    return _book_meta_from_record(record, counts.get(record['id'], 0))


@router.delete('/{book_id}')
async def delete_book(book_id: str):
    with _DELETE_LOCK:
        record = _get_record_or_404(book_id)
        path = get_book_path(record)
        file_type = record['file_type']
        proposed_trash_path = _trash_path_for(path)
        journal_path = _delete_journal_path()
        try:
            operation = begin_delete(
                record,
                proposed_trash_path.relative_to(BOOKS_DIR).as_posix(),
                journal_path=journal_path,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail='Failed to journal book deletion') from exc
        trash_path = BOOKS_DIR / Path(operation['trash_name'])
        try:
            if path.exists():
                trash_path.parent.mkdir(parents=True, exist_ok=True)
                if trash_path.exists():
                    raise RuntimeError('Both source and staged delete file exist')
                path.replace(trash_path)
                _fsync_directory(path.parent)
                _fsync_directory(trash_path.parent)
            mark_delete_phase(record['id'], 'file_staged', journal_path=journal_path)
            delete_book_record(record['id'])
            mark_delete_phase(record['id'], 'metadata_deleted', journal_path=journal_path)
            delete_book_annotations(record['id'])
            mark_delete_phase(record['id'], 'annotations_deleted', journal_path=journal_path)
            delete_reading_progress(record['id'])
            mark_delete_phase(record['id'], 'progress_deleted', journal_path=journal_path)
            trash_path.unlink(missing_ok=True)
            _fsync_directory(trash_path.parent)
            mark_delete_phase(record['id'], 'trash_deleted', journal_path=journal_path)
            finish_delete(record['id'], journal_path=journal_path)
        except Exception as exc:
            # The durable intent is the commit decision. Keep the journal and staged
            # file so startup recovery can safely repeat every idempotent step.
            raise HTTPException(status_code=500, detail='Book deletion is pending recovery') from exc

        _clear_related_caches(file_type)
        return {'detail': 'Book deleted'}


@router.get('/{book_id}/content', response_model=TxtContent)
async def get_txt_content(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')
    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'], record.get('txt_encoding_override'))
    encoding_override = record.get('txt_encoding_override')
    if encoding_override is None:
        result = await run_in_threadpool(read_txt_file, str(path))
    else:
        result = await run_in_threadpool(read_txt_file, str(path), encoding_override)
    return TxtContent(**result)


@router.get('/{book_id}/txt-encoding-preview', response_model=TxtEncodingPreview)
async def get_txt_encoding_preview(book_id: str):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')
    result = await run_in_threadpool(
        read_txt_encoding_preview,
        str(path),
        record.get('txt_encoding_override'),
    )
    return TxtEncodingPreview(**result)


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
    _schedule_search_prewarm(background_tasks, path, record['file_type'], record.get('txt_encoding_override'))
    manifest_kwargs = {
        'transform_options': {
            'trim_spaces': trim_spaces,
            'remove_empty_lines': remove_empty_lines,
            'split_paragraphs': split_paragraphs,
        },
        'include_fragments': False,
        'include_segments': False,
    }
    if record.get('txt_encoding_override') is not None:
        manifest_kwargs['encoding_override'] = record['txt_encoding_override']
    manifest = await run_in_threadpool(read_txt_manifest, str(path), **manifest_kwargs)
    return TxtManifest(title=record.get('title') or Path(record.get('filename', '')).stem or None, **manifest)


@router.get('/{book_id}/txt-segments', response_model=TxtSegmentWindow)
async def get_txt_segments(
    book_id: str,
    start: int = 0,
    limit: int = 40,
    cursor: str | None = Query(default=None, max_length=64),
    max_chars: int = Query(default=128 * 1024, ge=1, le=TXT_WINDOW_MAX_CHARS),
    trim_spaces: bool = False,
    remove_empty_lines: bool = False,
    split_paragraphs: bool = False,
):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')

    try:
        window_kwargs = {
            'start': start,
            'limit': limit,
            'cursor': cursor,
            'max_chars': max_chars,
            'transform_options': {
                'trim_spaces': trim_spaces,
                'remove_empty_lines': remove_empty_lines,
                'split_paragraphs': split_paragraphs,
            },
        }
        if record.get('txt_encoding_override') is not None:
            window_kwargs['encoding_override'] = record['txt_encoding_override']
        window = await run_in_threadpool(read_txt_segment_window, str(path), **window_kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return TxtSegmentWindow(**window)


@router.get('/{book_id}/toc', response_model=EpubToc)
async def get_toc(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'epub':
        raise HTTPException(status_code=400, detail='Not an EPUB file')
    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    try:
        result = await run_in_threadpool(get_epub_toc, str(path))
    except EpubSafetyError as exc:
        raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc
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
        result = await run_in_threadpool(
            get_epub_chapter,
            str(path),
            chapter_index,
            record['id'],
            asset_base_url=asset_base_url,
        )
    except EpubSafetyError as exc:
        raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc
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
        data, media_type = await run_in_threadpool(get_epub_asset, str(path), asset_path)
    except FileNotFoundError:
        if EPUB_DEBUG_ENABLED:
            _append_epub_debug(
                'asset_missing',
                book_id=record['id'],
                asset_path=asset_path,
                origin=request.headers.get('origin'),
                referer=request.headers.get('referer'),
            )
        exc = EpubSafetyError(
            'EPUB asset was not found',
            code='epub_asset_not_found',
            stage='asset',
            member_path=asset_path,
        )
        raise HTTPException(status_code=404, detail=_format_error_detail(exc)) from None
    except EpubSafetyError as exc:
        raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc

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
    request: Request,
    book_id: str,
    q: str = Query('', min_length=0, max_length=120),
    timeout_ms: int = Query(8000, ge=250, le=15000),
    trim_spaces: bool = False,
    remove_empty_lines: bool = False,
    split_paragraphs: bool = False,
):
    record, path = _resolve_book_file(book_id)
    query = q.strip()
    if not query:
        return BookSearchResponse(query='', total=0, results=[])

    _touch_book_open(record)
    cancel_event = threading.Event()

    async def watch_disconnect():
        while not cancel_event.is_set():
            if await request.is_disconnected():
                cancel_event.set()
                return
            await asyncio.sleep(0.05)

    disconnect_task = asyncio.create_task(watch_disconnect())
    try:
        if record['file_type'] == 'txt':
            txt_search_kwargs = {
                'transform_options': {
                    'trim_spaces': trim_spaces,
                    'remove_empty_lines': remove_empty_lines,
                    'split_paragraphs': split_paragraphs,
                },
                'cancel_event': cancel_event,
                'timeout_seconds': timeout_ms / 1000,
            }
            if record.get('txt_encoding_override') is not None:
                txt_search_kwargs['encoding_override'] = record['txt_encoding_override']
            result = await run_in_threadpool(
                search_txt_file,
                str(path),
                query,
                **txt_search_kwargs,
            )
        elif record['file_type'] == 'epub':
            try:
                result = await run_in_threadpool(
                    search_epub_file,
                    str(path),
                    query,
                    cancel_event=cancel_event,
                    timeout_seconds=timeout_ms / 1000,
                )
            except EpubSafetyError as exc:
                raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc
        else:
            raise HTTPException(status_code=400, detail='Search is only supported for TXT and EPUB')
    finally:
        cancel_event.set()
        disconnect_task.cancel()
    return BookSearchResponse(**result)


@router.get('/{book_id}/diagnostics', response_model=BookDiagnostics)
async def get_book_diagnostics(
    book_id: str,
    member_name: str | None = Query(default=None, max_length=512),
):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] == 'epub':
        result = await run_in_threadpool(diagnose_epub, str(path))
    elif record['file_type'] == 'zip':
        result = await run_in_threadpool(diagnose_zip, str(path), member_name)
    else:
        raise HTTPException(status_code=400, detail='Diagnostics are only supported for EPUB and ZIP')
    return BookDiagnostics(**result)


@router.get('/{book_id}/images', response_model=ZipImageList)
async def get_images(book_id: str):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'zip':
        raise HTTPException(status_code=400, detail='Not a ZIP file')
    _touch_book_open(record)
    try:
        result = await run_in_threadpool(list_zip_images, str(path))
    except ZipSafetyError as exc:
        raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc
    return ZipImageList(**result)


@router.get('/{book_id}/image/{image_name:path}')
async def get_image(book_id: str, image_name: str):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'zip':
        raise HTTPException(status_code=400, detail='Not a ZIP file')
    try:
        data, media_type = await run_in_threadpool(get_zip_image, str(path), image_name)
    except FileNotFoundError:
        exc = ZipSafetyError(
            'ZIP image was not found',
            code='image_not_found',
            stage='member_read',
            member_name=image_name,
        )
        raise HTTPException(status_code=404, detail=_format_error_detail(exc)) from None
    except ZipSafetyError as exc:
        raise HTTPException(status_code=_format_error_status(exc), detail=_format_error_detail(exc)) from exc
    return Response(content=data, media_type=media_type)
