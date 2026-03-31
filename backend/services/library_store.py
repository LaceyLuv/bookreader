from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from paths import BOOKS_DIR, LIBRARY_DATA_PATH

LIBRARY_VERSION = 4
ALLOWED_BOOK_EXTENSIONS = {'txt', 'epub', 'zip'}
READING_STATUSES = {'unread', 'reading', 'completed', 'paused'}
SAFE_STORAGE_RE = re.compile(r'[^A-Za-z0-9._-]+')
STORE_WRITE_ENCODING = 'utf-8'
STORE_DATE_FORMAT_SECONDS = 'seconds'
TIMESTAMP_WRITE_THROTTLE_SECONDS = 15
FINGERPRINT_CHUNK_SIZE = 1024 * 1024
_STORE_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now().isoformat(timespec=STORE_DATE_FORMAT_SECONDS)


def _normalize_optional_text(value: Any, *, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if max_length is not None:
        text = text[:max_length]
    return text or None


def _normalize_nonnegative_int(value: Any) -> int | None:
    if value is None or value == '':
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _normalize_fingerprint(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text or None


def _normalize_name_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    seen = set()
    names = []
    for item in value:
        text = _normalize_optional_text(item, max_length=80)
        if not text:
            continue
        lowered = text.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        names.append(text)
    return names


def _normalize_folder_name(value: Any) -> str | None:
    return _normalize_optional_text(value, max_length=120)


def _safe_display_name(filename: str | None) -> str:
    cleaned = Path(filename or '').name.strip()
    return cleaned or 'book'


def detect_book_file_type(filename: str | None) -> str:
    name = _safe_display_name(filename)
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    return ext if ext in ALLOWED_BOOK_EXTENSIONS else ''


def make_legacy_id(filename: str | None) -> str:
    return hashlib.md5(_safe_display_name(filename).encode('utf-8')).hexdigest()[:12]


def _sanitize_storage_stem(filename: str | None) -> str:
    stem = SAFE_STORAGE_RE.sub('-', Path(_safe_display_name(filename)).stem).strip('-.')
    return stem or 'book'


def build_storage_name(book_id: str, filename: str | None) -> str:
    display_name = _safe_display_name(filename)
    suffix = Path(display_name).suffix.lower()
    safe_stem = _sanitize_storage_stem(display_name)
    return f'{book_id}-{safe_stem}{suffix}'


def _hash_file_sha1(file_path: Path) -> str:
    hasher = hashlib.sha1()
    with file_path.open('rb') as f:
        while True:
            chunk = f.read(FINGERPRINT_CHUNK_SIZE)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def _fingerprint_for_file(file_path: Path, raw: dict[str, Any] | None = None, *, stat_result=None) -> tuple[str | None, int, int]:
    stat = stat_result or file_path.stat()
    current_size = int(getattr(stat, 'st_size', 0) or 0)
    current_mtime_ns = int(getattr(stat, 'st_mtime_ns', 0) or 0)
    raw_fingerprint = _normalize_fingerprint((raw or {}).get('content_fingerprint'))
    raw_size = _normalize_nonnegative_int((raw or {}).get('content_fingerprint_size'))
    raw_mtime_ns = _normalize_nonnegative_int((raw or {}).get('content_fingerprint_mtime_ns'))
    if raw_fingerprint and raw_size == current_size and raw_mtime_ns == current_mtime_ns:
        return raw_fingerprint, current_size, current_mtime_ns
    try:
        fingerprint = _hash_file_sha1(file_path)
    except OSError:
        fingerprint = raw_fingerprint
    return fingerprint, current_size, current_mtime_ns


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def _should_refresh_timestamp(value: str | None) -> bool:
    parsed = _parse_iso(value)
    if parsed is None:
        return True
    return datetime.now() - parsed >= timedelta(seconds=TIMESTAMP_WRITE_THROTTLE_SECONDS)


def _empty_store() -> dict[str, Any]:
    return {'version': LIBRARY_VERSION, 'books': [], 'folders': []}


def _read_store_unlocked() -> dict[str, Any]:
    if not LIBRARY_DATA_PATH.exists():
        return _empty_store()
    try:
        with LIBRARY_DATA_PATH.open('r', encoding=STORE_WRITE_ENCODING) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return _empty_store()
    if not isinstance(data, dict):
        return _empty_store()
    books = data.get('books')
    folders = data.get('folders')
    if not isinstance(books, list):
        books = []
    if not isinstance(folders, list):
        folders = []
    return {
        'version': LIBRARY_VERSION,
        'books': books,
        'folders': folders,
    }


def _write_store_unlocked(data: dict[str, Any]) -> None:
    payload = {
        'version': LIBRARY_VERSION,
        'books': data.get('books', []),
        'folders': data.get('folders', []),
    }
    tmp_path = LIBRARY_DATA_PATH.with_suffix('.tmp')
    with tmp_path.open('w', encoding=STORE_WRITE_ENCODING) as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp_path.replace(LIBRARY_DATA_PATH)


def _normalize_folder_record(raw: dict[str, Any]) -> dict[str, Any] | None:
    name = _normalize_folder_name(raw.get('name'))
    if not name:
        return None
    created_at = _normalize_optional_text(raw.get('created_at')) or _now_iso()
    updated_at = _normalize_optional_text(raw.get('updated_at')) or created_at
    return {
        'id': str(raw.get('id') or uuid4().hex[:16]),
        'name': name,
        'created_at': created_at,
        'updated_at': updated_at,
    }


def _new_record(display_name: str, stored_filename: str, file_path: Path, *, book_id: str | None = None, upload_date: str | None = None) -> dict[str, Any]:
    stat_result = file_path.stat()
    fingerprint, fingerprint_size, fingerprint_mtime_ns = _fingerprint_for_file(file_path, stat_result=stat_result)
    normalized_display = _safe_display_name(display_name)
    file_type = detect_book_file_type(normalized_display) or detect_book_file_type(stored_filename)
    return {
        'id': book_id or uuid4().hex[:16],
        'legacy_id': make_legacy_id(normalized_display),
        'title': Path(normalized_display).stem,
        'author': None,
        'file_type': file_type,
        'filename': normalized_display,
        'stored_filename': _safe_display_name(stored_filename),
        'size': int(getattr(stat_result, 'st_size', 0) or 0),
        'upload_date': upload_date or datetime.fromtimestamp(getattr(stat_result, 'st_mtime', datetime.now().timestamp())).isoformat(),
        'last_opened_at': None,
        'last_read_at': None,
        'reading_status': 'unread',
        'favorite': False,
        'pinned': False,
        'tags': [],
        'collections': [],
        'library_folder_id': None,
        'library_folder_name': None,
        'series_name': None,
        'series_index': None,
        'duplicate_group': None,
        'version_label': None,
        'duplicate_lead': False,
        'content_fingerprint': fingerprint,
        'content_fingerprint_size': fingerprint_size,
        'content_fingerprint_mtime_ns': fingerprint_mtime_ns,
    }


def _normalize_record(raw: dict[str, Any], file_path: Path, folder_name_by_id: dict[str, str]) -> dict[str, Any]:
    stat = file_path.stat()
    fingerprint, fingerprint_size, fingerprint_mtime_ns = _fingerprint_for_file(file_path, raw, stat_result=stat)
    display_name = _safe_display_name(raw.get('filename') or file_path.name)
    stored_filename = _safe_display_name(raw.get('stored_filename') or file_path.name)
    file_type = detect_book_file_type(raw.get('file_type')) or detect_book_file_type(display_name) or detect_book_file_type(stored_filename)
    reading_status = str(raw.get('reading_status') or 'unread')
    if reading_status not in READING_STATUSES:
        reading_status = 'unread'
    folder_id = _normalize_optional_text(raw.get('library_folder_id'))
    if folder_id and folder_id not in folder_name_by_id:
        folder_id = None
    return {
        'id': str(raw.get('id') or uuid4().hex[:16]),
        'legacy_id': str(raw.get('legacy_id') or make_legacy_id(display_name)),
        'title': str(raw.get('title') or Path(display_name).stem),
        'author': _normalize_optional_text(raw.get('author')),
        'file_type': file_type,
        'filename': display_name,
        'stored_filename': stored_filename,
        'size': stat.st_size,
        'upload_date': _normalize_optional_text(raw.get('upload_date')) or datetime.fromtimestamp(stat.st_mtime).isoformat(),
        'last_opened_at': _normalize_optional_text(raw.get('last_opened_at')),
        'last_read_at': _normalize_optional_text(raw.get('last_read_at')),
        'reading_status': reading_status,
        'favorite': bool(raw.get('favorite', False)),
        'pinned': bool(raw.get('pinned', False)),
        'tags': _normalize_name_list(raw.get('tags')),
        'collections': _normalize_name_list(raw.get('collections')),
        'library_folder_id': folder_id,
        'library_folder_name': folder_name_by_id.get(folder_id) if folder_id else None,
        'series_name': _normalize_optional_text(raw.get('series_name')),
        'series_index': _normalize_nonnegative_int(raw.get('series_index')),
        'duplicate_group': _normalize_optional_text(raw.get('duplicate_group')),
        'version_label': _normalize_optional_text(raw.get('version_label')),
        'duplicate_lead': bool(raw.get('duplicate_lead', False)),
        'content_fingerprint': fingerprint,
        'content_fingerprint_size': fingerprint_size,
        'content_fingerprint_mtime_ns': fingerprint_mtime_ns,
    }


def _sync_store_unlocked() -> dict[str, Any]:
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    data = _read_store_unlocked()

    changed = not LIBRARY_DATA_PATH.exists()
    normalized_folders: list[dict[str, Any]] = []
    folder_name_by_id: dict[str, str] = {}
    used_folder_names: set[str] = set()

    for raw_folder in data.get('folders', []):
        if not isinstance(raw_folder, dict):
            changed = True
            continue
        normalized_folder = _normalize_folder_record(raw_folder)
        if normalized_folder is None:
            changed = True
            continue
        folder_name_key = normalized_folder['name'].casefold()
        if folder_name_key in used_folder_names:
            changed = True
            continue
        used_folder_names.add(folder_name_key)
        if normalized_folder != raw_folder:
            changed = True
        normalized_folders.append(normalized_folder)
        folder_name_by_id[normalized_folder['id']] = normalized_folder['name']

    existing_files = {
        file_path.name: file_path
        for file_path in BOOKS_DIR.iterdir()
        if file_path.is_file() and detect_book_file_type(file_path.name)
    }

    normalized_books: list[dict[str, Any]] = []
    seen_stored_names: set[str] = set()

    for raw_book in data.get('books', []):
        if not isinstance(raw_book, dict):
            changed = True
            continue
        if str(raw_book.get('source_kind') or '').strip().lower() == 'folder':
            changed = True
            continue

        stored_name = _safe_display_name(raw_book.get('stored_filename') or raw_book.get('filename'))
        file_path = existing_files.get(stored_name)
        if file_path is None:
            changed = True
            continue
        normalized = _normalize_record(raw_book, file_path, folder_name_by_id)
        if normalized != raw_book:
            changed = True
        normalized_books.append(normalized)
        seen_stored_names.add(stored_name)

    orphan_files = [
        file_path
        for name, file_path in existing_files.items()
        if name not in seen_stored_names
    ]
    for file_path in sorted(orphan_files, key=lambda item: item.name.lower()):
        normalized_books.append(_new_record(file_path.name, file_path.name, file_path))
        changed = True

    data = {'version': LIBRARY_VERSION, 'books': normalized_books, 'folders': normalized_folders}
    if changed:
        _write_store_unlocked(data)
    return data


def ensure_library_store() -> dict[str, Any]:
    with _STORE_LOCK:
        return _sync_store_unlocked()


def _folder_counts(books: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in books:
        folder_id = _normalize_optional_text(record.get('library_folder_id'))
        if not folder_id:
            continue
        counts[folder_id] = counts.get(folder_id, 0) + 1
    return counts


def list_book_records() -> list[dict[str, Any]]:
    with _STORE_LOCK:
        return list(_sync_store_unlocked().get('books', []))


def list_folder_records() -> list[dict[str, Any]]:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        counts = _folder_counts(data.get('books', []))
        return [
            {**record, 'book_count': counts.get(record['id'], 0)}
            for record in data.get('folders', [])
        ]


def get_book_record(book_id: str) -> dict[str, Any] | None:
    with _STORE_LOCK:
        books = _sync_store_unlocked().get('books', [])
        for record in books:
            if record.get('id') == book_id or record.get('legacy_id') == book_id:
                return dict(record)
    return None


def get_folder_record(folder_id: str) -> dict[str, Any] | None:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        counts = _folder_counts(data.get('books', []))
        for record in data.get('folders', []):
            if record.get('id') == folder_id:
                return {**dict(record), 'book_count': counts.get(record['id'], 0)}
    return None


def get_book_path(record: dict[str, Any]) -> Path:
    return (BOOKS_DIR / _safe_display_name(record.get('stored_filename'))).resolve()


def prepare_upload(display_name: str | None) -> dict[str, str]:
    normalized = _safe_display_name(display_name)
    file_type = detect_book_file_type(normalized)
    if not file_type:
        raise ValueError('Unsupported file type')

    while True:
        book_id = uuid4().hex[:16]
        stored_filename = build_storage_name(book_id, normalized)
        if not (BOOKS_DIR / stored_filename).exists():
            return {
                'id': book_id,
                'filename': normalized,
                'stored_filename': stored_filename,
                'file_type': file_type,
            }


def add_book_record(*, book_id: str, filename: str, stored_filename: str) -> dict[str, Any]:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        file_path = BOOKS_DIR / _safe_display_name(stored_filename)
        if not file_path.exists():
            raise FileNotFoundError(str(file_path))
        record = _new_record(filename, stored_filename, file_path, book_id=book_id)
        books = data.get('books', [])
        books.append(record)
        data['books'] = books
        _write_store_unlocked(data)
        return dict(record)


def _folder_lookup(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {record['id']: dict(record) for record in data.get('folders', []) if isinstance(record, dict) and record.get('id')}


def add_folder_record(name: str) -> dict[str, Any]:
    normalized_name = _normalize_folder_name(name)
    if not normalized_name:
        raise ValueError('Folder name is required')

    with _STORE_LOCK:
        data = _sync_store_unlocked()
        folders = data.get('folders', [])
        for record in folders:
            if str(record.get('name', '')).casefold() == normalized_name.casefold():
                raise FileExistsError(normalized_name)
        now_value = _now_iso()
        folder_record = {
            'id': uuid4().hex[:16],
            'name': normalized_name,
            'created_at': now_value,
            'updated_at': now_value,
        }
        folders.append(folder_record)
        data['folders'] = folders
        _write_store_unlocked(data)
        return {**folder_record, 'book_count': 0}


def update_folder_record(folder_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    if 'name' not in updates:
        return get_folder_record(folder_id)

    next_name = _normalize_folder_name(updates.get('name'))
    if not next_name:
        raise ValueError('Folder name is required')

    with _STORE_LOCK:
        data = _sync_store_unlocked()
        folders = data.get('folders', [])
        folder_index = next((index for index, record in enumerate(folders) if record.get('id') == folder_id), None)
        if folder_index is None:
            return None
        for record in folders:
            if record.get('id') == folder_id:
                continue
            if str(record.get('name', '')).casefold() == next_name.casefold():
                raise FileExistsError(next_name)

        folder_record = dict(folders[folder_index])
        folder_record['name'] = next_name
        folder_record['updated_at'] = _now_iso()
        folders[folder_index] = folder_record

        books = data.get('books', [])
        for index, record in enumerate(books):
            if record.get('library_folder_id') != folder_id:
                continue
            next_record = dict(record)
            next_record['library_folder_name'] = next_name
            books[index] = next_record

        data['folders'] = folders
        data['books'] = books
        _write_store_unlocked(data)
        count = sum(1 for record in books if record.get('library_folder_id') == folder_id)
        return {**folder_record, 'book_count': count}


def delete_book_record(book_id: str) -> dict[str, Any] | None:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        books = data.get('books', [])
        for index, record in enumerate(books):
            if record.get('id') == book_id or record.get('legacy_id') == book_id:
                removed = books.pop(index)
                data['books'] = books
                _write_store_unlocked(data)
                return dict(removed)
    return None


def delete_folder_record(folder_id: str) -> dict[str, Any] | None:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        folders = data.get('folders', [])
        folder_index = next((index for index, record in enumerate(folders) if record.get('id') == folder_id), None)
        if folder_index is None:
            return None
        removed_folder = dict(folders.pop(folder_index))
        books = data.get('books', [])
        cleared_books = 0
        for index, record in enumerate(books):
            if record.get('library_folder_id') != folder_id:
                continue
            next_record = dict(record)
            next_record['library_folder_id'] = None
            next_record['library_folder_name'] = None
            books[index] = next_record
            cleared_books += 1
        data['folders'] = folders
        data['books'] = books
        _write_store_unlocked(data)
        return {
            'folder': removed_folder,
            'cleared_books': cleared_books,
        }


def assign_books_to_folder(book_ids: list[str], folder_id: str | None) -> dict[str, Any]:
    normalized_ids = []
    seen_ids = set()
    for book_id in book_ids:
        text = _normalize_optional_text(book_id)
        if not text or text in seen_ids:
            continue
        seen_ids.add(text)
        normalized_ids.append(text)
    if not normalized_ids:
        return {'updated_count': 0, 'books': []}

    requested_folder_id = _normalize_optional_text(folder_id)
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        folder_lookup = _folder_lookup(data)
        if requested_folder_id and requested_folder_id not in folder_lookup:
            raise ValueError('Library folder not found')

        folder_name = folder_lookup.get(requested_folder_id, {}).get('name') if requested_folder_id else None
        books = data.get('books', [])
        updated_records = []
        for index, record in enumerate(books):
            if record.get('id') not in normalized_ids and record.get('legacy_id') not in normalized_ids:
                continue
            next_record = dict(record)
            next_record['library_folder_id'] = requested_folder_id
            next_record['library_folder_name'] = folder_name
            if next_record == record:
                continue
            books[index] = next_record
            updated_records.append(dict(next_record))
        if updated_records:
            data['books'] = books
            _write_store_unlocked(data)
        return {'updated_count': len(updated_records), 'books': updated_records}


def update_book_record(book_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    allowed_keys = {
        'title',
        'author',
        'reading_status',
        'favorite',
        'pinned',
        'tags',
        'collections',
        'library_folder_id',
        'series_name',
        'series_index',
        'duplicate_group',
        'version_label',
        'duplicate_lead',
        'last_opened_at',
        'last_read_at',
    }
    filtered = {key: value for key, value in updates.items() if key in allowed_keys}
    if not filtered:
        return get_book_record(book_id)

    with _STORE_LOCK:
        data = _sync_store_unlocked()
        folder_lookup = _folder_lookup(data)
        books = data.get('books', [])
        for index, record in enumerate(books):
            if record.get('id') != book_id and record.get('legacy_id') != book_id:
                continue
            next_record = dict(record)
            if 'title' in filtered:
                next_record['title'] = str(filtered['title']).strip() or record.get('title') or Path(record.get('filename', '')).stem
            if 'author' in filtered:
                next_record['author'] = _normalize_optional_text(filtered['author'])
            if 'reading_status' in filtered:
                status = str(filtered['reading_status']).strip()
                if status in READING_STATUSES:
                    next_record['reading_status'] = status
            if 'favorite' in filtered:
                next_record['favorite'] = bool(filtered['favorite'])
            if 'pinned' in filtered:
                next_record['pinned'] = bool(filtered['pinned'])
            if 'tags' in filtered:
                next_record['tags'] = _normalize_name_list(filtered['tags'])
            if 'collections' in filtered:
                next_record['collections'] = _normalize_name_list(filtered['collections'])
            if 'library_folder_id' in filtered:
                requested_folder_id = _normalize_optional_text(filtered['library_folder_id'])
                if requested_folder_id and requested_folder_id not in folder_lookup:
                    raise ValueError('Library folder not found')
                next_record['library_folder_id'] = requested_folder_id
                next_record['library_folder_name'] = folder_lookup.get(requested_folder_id, {}).get('name') if requested_folder_id else None
            if 'series_name' in filtered:
                next_record['series_name'] = _normalize_optional_text(filtered['series_name'])
            if 'series_index' in filtered:
                next_record['series_index'] = _normalize_nonnegative_int(filtered['series_index'])
            if 'duplicate_group' in filtered:
                next_record['duplicate_group'] = _normalize_optional_text(filtered['duplicate_group'])
            if 'version_label' in filtered:
                next_record['version_label'] = _normalize_optional_text(filtered['version_label'])
            if 'duplicate_lead' in filtered:
                next_record['duplicate_lead'] = bool(filtered['duplicate_lead'])
            if 'last_opened_at' in filtered:
                next_record['last_opened_at'] = _normalize_optional_text(filtered['last_opened_at'])
            if 'last_read_at' in filtered:
                next_record['last_read_at'] = _normalize_optional_text(filtered['last_read_at'])
            books[index] = next_record
            data['books'] = books
            _write_store_unlocked(data)
            return dict(next_record)
    return None


def touch_book(book_id: str, *, opened: bool = False, read: bool = False) -> dict[str, Any] | None:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        books = data.get('books', [])
        now_value = _now_iso()
        for index, record in enumerate(books):
            if record.get('id') != book_id and record.get('legacy_id') != book_id:
                continue
            next_record = dict(record)
            changed = False
            if opened and _should_refresh_timestamp(next_record.get('last_opened_at')):
                next_record['last_opened_at'] = now_value
                changed = True
            if read and _should_refresh_timestamp(next_record.get('last_read_at')):
                next_record['last_read_at'] = now_value
                changed = True
            if read and next_record.get('reading_status') in {'unread', 'paused'}:
                next_record['reading_status'] = 'reading'
                changed = True
            if changed:
                books[index] = next_record
                data['books'] = books
                _write_store_unlocked(data)
            return dict(next_record)
    return None
