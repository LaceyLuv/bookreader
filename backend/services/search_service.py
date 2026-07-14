import re
import time
from functools import lru_cache
from pathlib import Path
from threading import Lock

from bs4 import BeautifulSoup

from services.epub_service import _decode_text_bytes, _get_spine_items, _read_epub_cached
from services.txt_service import TXT_WINDOW_MAX_CHARS, read_txt_file, read_txt_segment_window

RESULT_LIMIT = 100
SNIPPET_RADIUS = 72
WHITESPACE_RE = re.compile(r'\s+')
HEADING_TAGS = ["h1", "h2", "h3", "h4", "title"]
_PREWARM_LOCK = Lock()
_INFLIGHT_PREWARMS: set[tuple[str, str, int, int, str]] = set()


def clear_search_caches() -> None:
    _get_txt_search_source.cache_clear()
    _get_epub_search_source.cache_clear()


def _compact_text(value: str) -> str:
    return WHITESPACE_RE.sub(' ', value or '').strip()


def _build_snippet(text: str, start: int, end: int, *, radius: int = SNIPPET_RADIUS) -> str:
    snippet_start = max(0, start - radius)
    snippet_end = min(len(text), end + radius)
    snippet = _compact_text(text[snippet_start:snippet_end])
    if snippet_start > 0:
        snippet = f"... {snippet}"
    if snippet_end < len(text):
        snippet = f"{snippet} ..."
    return snippet


def _resolve_cache_key(file_path: str) -> tuple[str, int, int]:
    resolved = Path(file_path).resolve()
    stat = resolved.stat()
    return str(resolved), stat.st_size, stat.st_mtime_ns


def _iter_match_spans(text: str, query: str):
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    for match in pattern.finditer(text):
        yield match.span()


def _stop_reason(cancel_event, deadline: float | None) -> str | None:
    if cancel_event is not None and cancel_event.is_set():
        return 'cancelled'
    if deadline is not None and time.monotonic() >= deadline:
        return 'timeout'
    return None


def _search_response(
    query: str,
    total: int,
    results: list[dict],
    *,
    complete: bool = True,
    partial_reason: str | None = None,
    results_truncated: bool = False,
    scanned_units: int = 0,
    total_units: int | None = None,
) -> dict:
    return {
        'query': query,
        'total': total,
        'results': results,
        'complete': complete,
        'partial_reason': partial_reason,
        'results_truncated': results_truncated,
        'scanned_units': scanned_units,
        'total_units': total_units,
    }


def _get_fragment_text(fragment: dict) -> str:
    return fragment.get('display_text') or fragment.get('text') or ''


def _get_fragment_source_start(fragment: dict) -> int | None:
    start = fragment.get('source_start_offset')
    if isinstance(start, int):
        return start
    start = fragment.get('start_offset')
    return start if isinstance(start, int) else None


def _get_fragment_source_end(fragment: dict) -> int | None:
    end = fragment.get('source_end_offset')
    if isinstance(end, int):
        return end
    end = fragment.get('end_offset')
    return end if isinstance(end, int) else None


def _get_source_offset_for_display_index(fragment: dict, display_index: int) -> int | None:
    if not isinstance(display_index, int) or display_index < 0:
        return None

    mapping = fragment.get('display_to_source')
    if isinstance(mapping, list) and display_index < len(mapping):
        value = mapping[display_index]
        return value if isinstance(value, int) else None

    runs = fragment.get('display_to_source_runs')
    if isinstance(runs, list):
        for run in runs:
            if not isinstance(run, list) or len(run) != 3:
                continue
            display_start, source_start, length = run
            if all(isinstance(value, int) for value in run) and display_start <= display_index < display_start + length:
                return source_start + display_index - display_start

    source_start = _get_fragment_source_start(fragment)
    source_end = _get_fragment_source_end(fragment)
    if source_start is None or source_end is None or source_end <= source_start:
        return None

    return min(source_end - 1, source_start + display_index)


def _get_segment_start_offsets(manifest: dict, search_fragments: list[dict]) -> dict[int, int]:
    segment_starts = {}

    for segment in manifest.get('segments') or []:
        segment_id = segment.get('segment_id')
        start_offset = segment.get('start_offset')
        if isinstance(segment_id, int) and isinstance(start_offset, int):
            segment_starts[segment_id] = start_offset

    for fragment in search_fragments:
        segment_id = fragment.get('segment_id')
        source_start = _get_fragment_source_start(fragment)
        if not isinstance(segment_id, int) or source_start is None:
            continue
        current = segment_starts.get(segment_id)
        segment_starts[segment_id] = source_start if current is None else min(current, source_start)

    return segment_starts


@lru_cache(maxsize=24)
def _get_txt_search_source(file_path: str, size: int, mtime_ns: int, encoding_override: str | None = None) -> tuple[str, str]:
    payload = read_txt_file(file_path, encoding_override)
    text = payload.get('text', '')
    return text, text.lower()


@lru_cache(maxsize=8)
def _get_epub_search_source(file_path: str, size: int, mtime_ns: int) -> tuple[tuple[str, str, str], ...]:
    book = _read_epub_cached(file_path)
    chapters = []

    for chapter_index, item in enumerate(_get_spine_items(book)):
        html_content = _decode_text_bytes(item.get_content())
        soup = BeautifulSoup(html_content, 'html.parser')
        heading = soup.find(HEADING_TAGS)
        chapter_title = heading.get_text(strip=True) if heading else f'Chapter {chapter_index + 1}'
        chapter_text = _compact_text(soup.get_text(' ', strip=True))
        chapters.append((chapter_title, chapter_text, chapter_text.lower()))

    return tuple(chapters)


def prewarm_search_cache(file_path: str, file_type: str, encoding_override: str | None = None) -> None:
    if file_type not in {'txt', 'epub'}:
        return

    try:
        cache_key = _resolve_cache_key(file_path)
    except OSError:
        return

    encoding_key = encoding_override or "auto"
    inflight_key = (file_type, *cache_key, encoding_key)
    with _PREWARM_LOCK:
        if inflight_key in _INFLIGHT_PREWARMS:
            return
        _INFLIGHT_PREWARMS.add(inflight_key)

    try:
        if file_type == 'txt':
            _get_txt_search_source(*cache_key, encoding_override)
        else:
            _get_epub_search_source(*cache_key)
    finally:
        with _PREWARM_LOCK:
            _INFLIGHT_PREWARMS.discard(inflight_key)


def search_txt_file(
    file_path: str,
    query: str,
    limit: int = RESULT_LIMIT,
    transform_options: dict | None = None,
    *,
    cancel_event=None,
    timeout_seconds: float | None = None,
    encoding_override: str | None = None,
) -> dict:
    trimmed_query = (query or '').strip()
    if not trimmed_query:
        return _search_response('', 0, [])

    deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
    safe_limit = max(1, min(int(limit), RESULT_LIMIT))
    results: list[dict] = []
    total = 0
    total_units: int | None = None
    scanned_units = 0
    start_index = 0
    cursor = None
    segment_starts: dict[int, int] = {}
    tail_text = ''
    tail_offsets: list[int | None] = []
    tail_segment_id = None
    tail_source_end = None
    carry_length = max(0, len(trimmed_query) - 1)
    allow_cross_fragment_matches = not any((transform_options or {}).values())

    while True:
        reason = _stop_reason(cancel_event, deadline)
        if reason:
            return _search_response(
                trimmed_query, total, results, complete=False, partial_reason=reason,
                scanned_units=scanned_units, total_units=total_units,
            )
        window_kwargs = {
            'start': start_index,
            'limit': 120,
            'cursor': cursor,
            'max_chars': TXT_WINDOW_MAX_CHARS,
            'transform_options': transform_options,
        }
        if encoding_override is not None:
            window_kwargs['encoding_override'] = encoding_override
        window = read_txt_segment_window(file_path, **window_kwargs)
        total_units = window.get('total') if isinstance(window.get('total'), int) else total_units
        fragments = window.get('display_fragments') or []
        for fragment in fragments:
            reason = _stop_reason(cancel_event, deadline)
            if reason:
                return _search_response(
                    trimmed_query, total, results, complete=False, partial_reason=reason,
                    scanned_units=scanned_units, total_units=total_units,
                )
            text = _get_fragment_text(fragment)
            segment_id = fragment.get('segment_id')
            if not text or not isinstance(segment_id, int):
                continue
            source_start = _get_fragment_source_start(fragment)
            if source_start is not None:
                segment_starts.setdefault(segment_id, source_start)
            fragment_source_start = _get_fragment_source_start(fragment)
            is_contiguous_plain_text = (
                allow_cross_fragment_matches
                and isinstance(fragment_source_start, int)
                and isinstance(tail_source_end, int)
                and fragment_source_start == tail_source_end
            )
            if (tail_segment_id != segment_id and not is_contiguous_plain_text) or not allow_cross_fragment_matches:
                tail_text = ''
                tail_offsets = []
            combined = tail_text + text
            tail_length = len(tail_text)

            def source_offset(combined_index: int) -> int | None:
                if combined_index < tail_length:
                    return tail_offsets[combined_index]
                return _get_source_offset_for_display_index(fragment, combined_index - tail_length)

            for match_start, match_end in _iter_match_spans(combined, trimmed_query):
                if match_end <= tail_length:
                    continue
                reason = _stop_reason(cancel_event, deadline)
                if reason:
                    return _search_response(
                        trimmed_query, total, results, complete=False, partial_reason=reason,
                        scanned_units=scanned_units, total_units=total_units,
                    )
                absolute_start = source_offset(match_start)
                absolute_end_char = source_offset(match_end - 1)
                absolute_segment_start = segment_starts.get(segment_id)
                segment_local_start = (
                    absolute_start - absolute_segment_start
                    if absolute_start is not None and absolute_segment_start is not None
                    else None
                )
                segment_local_end = (
                    absolute_end_char + 1 - absolute_segment_start
                    if absolute_end_char is not None and absolute_segment_start is not None
                    else None
                )
                total += 1
                if len(results) >= safe_limit:
                    return _search_response(
                        trimmed_query, total, results, complete=False, results_truncated=True,
                        scanned_units=scanned_units, total_units=total_units,
                    )
                results.append({
                    'index': total - 1,
                    'snippet': _build_snippet(combined, match_start, match_end),
                    'position': absolute_start,
                    'locator': f"segment:{segment_id}:offset:{segment_local_start}" if isinstance(segment_local_start, int) else None,
                    'segment_id': segment_id,
                    'segment_local_start': segment_local_start,
                    'segment_local_end': segment_local_end,
                    'chapter_match_index': total - 1,
                })
            if carry_length:
                tail_start = max(0, len(combined) - carry_length)
                tail_text = combined[tail_start:]
                tail_offsets = [source_offset(index) for index in range(tail_start, len(combined))]
            else:
                tail_text = ''
                tail_offsets = []
            tail_segment_id = segment_id
            tail_source_end = _get_fragment_source_end(fragment)
            scanned_units = max(scanned_units, int(fragment.get('fragment_index') or segment_id) + 1)

        next_cursor = window.get('next_cursor')
        if not next_cursor:
            break
        next_fragment, next_offset = (int(value) for value in str(next_cursor).split(':', 1))
        start_index = next_fragment
        cursor = next_cursor if next_offset else None

    return _search_response(
        trimmed_query, total, results, scanned_units=scanned_units, total_units=total_units,
    )


def search_epub_file(
    file_path: str,
    query: str,
    limit: int = RESULT_LIMIT,
    *,
    cancel_event=None,
    timeout_seconds: float | None = None,
) -> dict:
    trimmed_query = (query or '').strip()
    if not trimmed_query:
        return _search_response('', 0, [])

    deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
    book = _read_epub_cached(file_path)
    chapters = _get_spine_items(book)
    safe_limit = max(1, min(int(limit), RESULT_LIMIT))
    results: list[dict] = []
    total = 0
    scanned_units = 0

    for chapter_index, item in enumerate(chapters):
        reason = _stop_reason(cancel_event, deadline)
        if reason:
            return _search_response(
                trimmed_query, total, results, complete=False, partial_reason=reason,
                scanned_units=scanned_units, total_units=len(chapters),
            )
        html_content = _decode_text_bytes(item.get_content())
        soup = BeautifulSoup(html_content, 'html.parser')
        heading = soup.find(HEADING_TAGS)
        chapter_title = heading.get_text(strip=True) if heading else f'Chapter {chapter_index + 1}'
        chapter_text = _compact_text(soup.get_text(' ', strip=True))
        chapter_match_index = 0
        for start, end in _iter_match_spans(chapter_text, trimmed_query):
            reason = _stop_reason(cancel_event, deadline)
            if reason:
                return _search_response(
                    trimmed_query, total, results, complete=False, partial_reason=reason,
                    scanned_units=scanned_units, total_units=len(chapters),
                )
            total += 1
            if len(results) >= safe_limit:
                return _search_response(
                    trimmed_query, total, results, complete=False, results_truncated=True,
                    scanned_units=scanned_units, total_units=len(chapters),
                )
            results.append({
                'index': total - 1,
                'snippet': _build_snippet(chapter_text, start, end),
                'position': start,
                'locator': f'chapter:{chapter_index}:offset:{start}',
                'chapter_index': chapter_index,
                'chapter_title': chapter_title,
                'chapter_match_index': chapter_match_index,
            })
            chapter_match_index += 1
        scanned_units = chapter_index + 1

    return _search_response(
        trimmed_query, total, results, scanned_units=scanned_units, total_units=len(chapters),
    )
