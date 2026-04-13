import re
from functools import lru_cache
from pathlib import Path
from threading import Lock

from bs4 import BeautifulSoup

from services.epub_service import _decode_text_bytes, _get_spine_items, _read_epub_cached
from services.txt_service import read_txt_file, read_txt_manifest

RESULT_LIMIT = 100
SNIPPET_RADIUS = 72
WHITESPACE_RE = re.compile(r'\s+')
HEADING_TAGS = ["h1", "h2", "h3", "h4", "title"]
_PREWARM_LOCK = Lock()
_INFLIGHT_PREWARMS: set[tuple[str, str, int, int]] = set()


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


def _iter_match_spans(lower_text: str, lower_query: str):
    start = 0
    query_length = len(lower_query)
    while True:
        match_at = lower_text.find(lower_query, start)
        if match_at < 0:
            break
        end = match_at + query_length
        yield match_at, end
        start = end


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
def _get_txt_search_source(file_path: str, size: int, mtime_ns: int) -> tuple[str, str]:
    payload = read_txt_file(file_path)
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


def prewarm_search_cache(file_path: str, file_type: str) -> None:
    if file_type not in {'txt', 'epub'}:
        return

    try:
        cache_key = _resolve_cache_key(file_path)
    except OSError:
        return

    inflight_key = (file_type, *cache_key)
    with _PREWARM_LOCK:
        if inflight_key in _INFLIGHT_PREWARMS:
            return
        _INFLIGHT_PREWARMS.add(inflight_key)

    try:
        if file_type == 'txt':
            _get_txt_search_source(*cache_key)
        else:
            _get_epub_search_source(*cache_key)
    finally:
        with _PREWARM_LOCK:
            _INFLIGHT_PREWARMS.discard(inflight_key)


def search_txt_file(file_path: str, query: str, limit: int = RESULT_LIMIT, transform_options: dict | None = None) -> dict:
    trimmed_query = (query or '').strip()
    if not trimmed_query:
        return {'query': '', 'total': 0, 'results': []}

    manifest = read_txt_manifest(file_path, transform_options=transform_options)
    lower_query = trimmed_query.lower()
    search_fragments = manifest.get('display_fragments') or manifest.get('segments') or []
    segment_start_offsets = _get_segment_start_offsets(manifest, search_fragments)

    results = []
    total = 0
    for fragment in search_fragments:
        text = _get_fragment_text(fragment)
        if not text:
            continue

        lower_text = text.lower()
        segment_id = fragment.get('segment_id')
        absolute_segment_start = segment_start_offsets.get(segment_id) if isinstance(segment_id, int) else None

        for start, end in _iter_match_spans(lower_text, lower_query):
            absolute_start = _get_source_offset_for_display_index(fragment, start)
            absolute_end_char = _get_source_offset_for_display_index(fragment, end - 1)

            total += 1
            if len(results) >= limit:
                continue

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

            results.append({
                'index': total - 1,
                'snippet': _build_snippet(text, start, end),
                'position': absolute_start,
                'locator': f"segment:{segment_id}:offset:{segment_local_start}" if isinstance(segment_id, int) and isinstance(segment_local_start, int) else None,
                'segment_id': segment_id,
                'segment_local_start': segment_local_start,
                'segment_local_end': segment_local_end,
                'chapter_match_index': total - 1,
            })

    return {
        'query': trimmed_query,
        'total': total,
        'results': results,
    }


def search_epub_file(file_path: str, query: str, limit: int = RESULT_LIMIT) -> dict:
    trimmed_query = (query or '').strip()
    if not trimmed_query:
        return {'query': '', 'total': 0, 'results': []}

    cache_key = _resolve_cache_key(file_path)
    chapters = _get_epub_search_source(*cache_key)
    lower_query = trimmed_query.lower()

    results = []
    total = 0

    for chapter_index, (chapter_title, chapter_text, lower_text) in enumerate(chapters):
        chapter_match_index = 0
        for start, end in _iter_match_spans(lower_text, lower_query):
            total += 1
            if len(results) < limit:
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

    return {
        'query': trimmed_query,
        'total': total,
        'results': results,
    }
