import re
from functools import lru_cache
from pathlib import Path
from threading import Lock

from bs4 import BeautifulSoup

from services.epub_service import _decode_text_bytes, _get_spine_items, _read_epub_cached
from services.txt_service import read_txt_file

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


def search_txt_file(file_path: str, query: str, limit: int = RESULT_LIMIT) -> dict:
    trimmed_query = (query or '').strip()
    if not trimmed_query:
        return {'query': '', 'total': 0, 'results': []}

    cache_key = _resolve_cache_key(file_path)
    text, lower_text = _get_txt_search_source(*cache_key)
    lower_query = trimmed_query.lower()

    results = []
    total = 0
    for start, end in _iter_match_spans(lower_text, lower_query):
        total += 1
        if len(results) >= limit:
            continue
        results.append({
            'index': total - 1,
            'snippet': _build_snippet(text, start, end),
            'position': start,
            'locator': f'offset:{start}',
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
