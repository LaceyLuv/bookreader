import os
from bisect import bisect_right
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Generic, TypeVar

import chardet

from services.txt_transform_service import transform_txt_segments


_SAMPLE_SIZE = 64 * 1024
_DEFAULT_TRANSFORM_OPTIONS = {
    "trim_spaces": False,
    "remove_empty_lines": False,
    "split_paragraphs": False,
}
_TXT_SOURCE_CACHE_MAX_BYTES = int(os.getenv("BOOKREADER_TXT_CACHE_MAX_BYTES", str(256 * 1024 * 1024)))
_TXT_SOURCE_CACHE_MAX_ENTRIES = int(os.getenv("BOOKREADER_TXT_CACHE_MAX_ENTRIES", "4"))
_TXT_INDEX_CACHE_MAX_BYTES = int(os.getenv("BOOKREADER_TXT_INDEX_CACHE_MAX_BYTES", str(32 * 1024 * 1024)))
_TXT_WINDOW_DEFAULT_CHARS = 128 * 1024
TXT_WINDOW_MAX_CHARS = 1024 * 1024

K = TypeVar("K")
V = TypeVar("V")


class _WeightedLruCache(Generic[K, V]):
    def __init__(self, max_entries: int, max_weight: int):
        self.max_entries = max(1, max_entries)
        self.max_weight = max(1, max_weight)
        self._items: OrderedDict[K, tuple[V, int]] = OrderedDict()
        self._weight = 0
        self._lock = RLock()

    def get(self, key: K) -> V | None:
        with self._lock:
            item = self._items.pop(key, None)
            if item is None:
                return None
            self._items[key] = item
            return item[0]

    def put(self, key: K, value: V, weight: int) -> V:
        safe_weight = max(1, weight)
        with self._lock:
            previous = self._items.pop(key, None)
            if previous is not None:
                self._weight -= previous[1]
            if safe_weight > self.max_weight:
                return value
            self._items[key] = (value, safe_weight)
            self._weight += safe_weight
            while len(self._items) > self.max_entries or self._weight > self.max_weight:
                _, (_, evicted_weight) = self._items.popitem(last=False)
                self._weight -= evicted_weight
        return value

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._weight = 0

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"entries": len(self._items), "weight": self._weight, "max_weight": self.max_weight}


@dataclass(frozen=True)
class _TxtSource:
    text: str
    encoding: str
    segment_ranges: tuple[tuple[int, int], ...]


_source_cache: _WeightedLruCache[tuple[str, int, int], _TxtSource] = _WeightedLruCache(
    _TXT_SOURCE_CACHE_MAX_ENTRIES,
    _TXT_SOURCE_CACHE_MAX_BYTES,
)
_transform_index_cache: _WeightedLruCache[tuple, tuple[int, ...]] = _WeightedLruCache(
    16,
    _TXT_INDEX_CACHE_MAX_BYTES,
)


def _decode_txt_bytes(raw_data: bytes, detected_encoding: str | None) -> dict:
    for encoding in [detected_encoding, "utf-8", "euc-kr", "latin-1"]:
        if encoding is None:
            continue
        try:
            return {"text": raw_data.decode(encoding), "encoding": encoding}
        except (UnicodeDecodeError, LookupError):
            continue
    return {"text": raw_data.decode("utf-8", errors="replace"), "encoding": "utf-8 (fallback)"}


def _build_segment_ranges(text: str) -> tuple[tuple[int, int], ...]:
    ranges: list[tuple[int, int]] = []
    cursor = 0
    length = len(text)
    while cursor < length:
        while cursor < length and text[cursor] == "\n":
            cursor += 1
        if cursor >= length:
            break
        next_break = text.find("\n\n", cursor)
        end_offset = length if next_break < 0 else next_break
        if end_offset > cursor:
            ranges.append((cursor, end_offset))
        cursor = end_offset + 2 if next_break >= 0 else length
    return tuple(ranges)


def _source_weight(source: _TxtSource) -> int:
    # Conservative UTF-16-like estimate plus two Python integers per range.
    return len(source.text) * 2 + len(source.segment_ranges) * 32


def _load_txt_source(file_path: str, size: int, mtime_ns: int) -> _TxtSource:
    key = (file_path, size, mtime_ns)
    cached = _source_cache.get(key)
    if cached is not None:
        return cached
    with open(file_path, "rb") as file:
        sample = file.read(_SAMPLE_SIZE)
        detected_encoding = chardet.detect(sample).get("encoding", "utf-8")
        file.seek(0)
        raw_data = file.read()
    decoded = _decode_txt_bytes(raw_data, detected_encoding)
    normalized = decoded["text"].replace("\r\n", "\n")
    source = _TxtSource(normalized, decoded["encoding"], _build_segment_ranges(normalized))
    return _source_cache.put(key, source, _source_weight(source))


def _source_for_path(file_path: str) -> tuple[_TxtSource, tuple[str, int, int]]:
    path = Path(file_path)
    stat = path.stat()
    key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
    return _load_txt_source(*key), key


def _segment(source: _TxtSource, segment_id: int) -> dict:
    start_offset, end_offset = source.segment_ranges[segment_id]
    return {
        "segment_id": segment_id,
        "text": source.text[start_offset:end_offset],
        "start_offset": start_offset,
        "end_offset": end_offset,
    }


def _segments(source: _TxtSource, start: int = 0, end: int | None = None) -> list[dict]:
    stop = len(source.segment_ranges) if end is None else min(end, len(source.segment_ranges))
    return [_segment(source, index) for index in range(max(0, start), stop)]


def _options(transform_options: dict | None) -> dict:
    return {**_DEFAULT_TRANSFORM_OPTIONS, **(transform_options or {})}


def _options_key(options: dict) -> tuple[bool, bool, bool]:
    return options["trim_spaces"], options["remove_empty_lines"], options["split_paragraphs"]


def _transform_segment(source: _TxtSource, segment_id: int, options: dict) -> list[dict]:
    return transform_txt_segments(
        [_segment(source, segment_id)],
        trim_spaces=options["trim_spaces"],
        remove_empty_lines=options["remove_empty_lines"],
        split_paragraphs=options["split_paragraphs"],
    )["fragments"]


def _transform_prefix(source: _TxtSource, source_key: tuple[str, int, int], options: dict) -> tuple[int, ...]:
    cache_key = (*source_key, *_options_key(options))
    cached = _transform_index_cache.get(cache_key)
    if cached is not None:
        return cached
    prefix = [0]
    for segment_id in range(len(source.segment_ranges)):
        prefix.append(prefix[-1] + len(_transform_segment(source, segment_id, options)))
    result = tuple(prefix)
    return _transform_index_cache.put(cache_key, result, len(result) * 8)


def _plain_fragment(source: _TxtSource, fragment_index: int) -> dict:
    segment = _segment(source, fragment_index)
    length = len(segment["text"])
    return {
        "segment_id": segment["segment_id"],
        "fragment_index": fragment_index,
        "display_text": segment["text"],
        "source_start_offset": segment["start_offset"],
        "source_end_offset": segment["end_offset"],
        "display_start_offset": 0,
        "display_to_source_runs": [[0, segment["start_offset"], length]],
    }


def _fragment_at(source: _TxtSource, fragment_index: int, options: dict, prefix: tuple[int, ...] | None) -> dict:
    if prefix is None:
        return _plain_fragment(source, fragment_index)
    segment_id = bisect_right(prefix, fragment_index) - 1
    fragments = _transform_segment(source, segment_id, options)
    fragment = dict(fragments[fragment_index - prefix[segment_id]])
    fragment["fragment_index"] = fragment_index
    fragment["display_start_offset"] = 0
    return fragment


def _slice_fragment(fragment: dict, start: int, end: int) -> dict:
    text = fragment["display_text"]
    safe_start = max(0, min(start, len(text)))
    safe_end = max(safe_start, min(end, len(text)))
    sliced_runs: list[list[int]] = []
    for display_start, source_start, length in fragment.get("display_to_source_runs", []):
        run_end = display_start + length
        overlap_start = max(display_start, safe_start)
        overlap_end = min(run_end, safe_end)
        if overlap_start >= overlap_end:
            continue
        sliced_runs.append([
            overlap_start - safe_start,
            source_start + overlap_start - display_start,
            overlap_end - overlap_start,
        ])
    result = dict(fragment)
    result["display_text"] = text[safe_start:safe_end]
    result["display_start_offset"] = fragment.get("display_start_offset", 0) + safe_start
    result["display_to_source_runs"] = sliced_runs
    if sliced_runs:
        result["source_start_offset"] = sliced_runs[0][1]
        last_run = sliced_runs[-1]
        result["source_end_offset"] = last_run[1] + last_run[2]
    return result


def _parse_cursor(cursor: str | None, fallback_start: int) -> tuple[int, int]:
    if not cursor:
        return fallback_start, 0
    try:
        fragment_index_text, display_offset_text = cursor.split(":", 1)
        fragment_index = int(fragment_index_text)
        display_offset = int(display_offset_text)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError("Invalid TXT window cursor") from exc
    if fragment_index < 0 or display_offset < 0:
        raise ValueError("Invalid TXT window cursor")
    return fragment_index, display_offset


def clear_txt_caches() -> None:
    _source_cache.clear()
    _transform_index_cache.clear()


def get_txt_cache_stats() -> dict[str, dict[str, int]]:
    return {"source": _source_cache.stats(), "transform_index": _transform_index_cache.stats()}


def read_txt_file(file_path: str) -> dict:
    source, _ = _source_for_path(file_path)
    return {"text": source.text, "encoding": source.encoding}


def read_txt_manifest(
    file_path: str,
    transform_options: dict | None = None,
    include_fragments: bool = True,
    include_segments: bool = True,
) -> dict:
    source, source_key = _source_for_path(file_path)
    options = _options(transform_options)
    active_transforms = any(options.values())
    prefix = _transform_prefix(source, source_key, options) if active_transforms else None
    segment_count = prefix[-1] if prefix is not None else len(source.segment_ranges)
    display_fragments: list[dict] = []
    if include_fragments:
        for fragment_index in range(segment_count):
            display_fragments.append(_fragment_at(source, fragment_index, options, prefix))
    response = {
        "encoding": source.encoding,
        "total_chars": len(source.text),
        "segment_count": segment_count,
        "transform_options": options,
        "display_fragments": display_fragments,
    }
    if include_segments:
        response["segments"] = _segments(source)
    return response


def read_txt_segment_window(
    file_path: str,
    start: int = 0,
    limit: int = 40,
    transform_options: dict | None = None,
    cursor: str | None = None,
    max_chars: int = _TXT_WINDOW_DEFAULT_CHARS,
) -> dict:
    source, source_key = _source_for_path(file_path)
    options = _options(transform_options)
    active_transforms = any(options.values())
    prefix = _transform_prefix(source, source_key, options) if active_transforms else None
    total = prefix[-1] if prefix is not None else len(source.segment_ranges)
    safe_start = max(0, start)
    safe_limit = max(1, min(limit, 120))
    char_budget = max(1, min(max_chars, TXT_WINDOW_MAX_CHARS))
    fragment_index, display_offset = _parse_cursor(cursor, safe_start)
    fragment_index = min(fragment_index, total)
    range_end = min(total, safe_start + safe_limit)
    initial_fragment_index = fragment_index
    fragments: list[dict] = []
    returned_chars = 0
    returned_fragment_count = 0

    while fragment_index < range_end and returned_fragment_count < safe_limit and returned_chars < char_budget:
        fragment = _fragment_at(source, fragment_index, options, prefix)
        text_length = len(fragment["display_text"])
        if display_offset >= text_length:
            fragment_index += 1
            display_offset = 0
            continue
        take = min(text_length - display_offset, char_budget - returned_chars)
        fragments.append(_slice_fragment(fragment, display_offset, display_offset + take))
        returned_chars += take
        if display_offset + take < text_length:
            display_offset += take
            break
        fragment_index += 1
        display_offset = 0
        returned_fragment_count += 1

    has_more = fragment_index < total
    next_cursor = f"{fragment_index}:{display_offset}" if has_more else None
    return {
        "contract_version": 2,
        "start": initial_fragment_index,
        "limit": safe_limit,
        "total": total,
        "returned_chars": returned_chars,
        "next_cursor": next_cursor,
        "has_more": has_more,
        "transform_options": options,
        "display_fragments": fragments,
    }
