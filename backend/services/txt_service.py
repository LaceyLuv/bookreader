import codecs
import hashlib
import io
import os
import sqlite3
from bisect import bisect_right
from collections import OrderedDict
from dataclasses import dataclass, replace
from pathlib import Path
from threading import RLock
from typing import Generic, TypeVar

import chardet

from paths import DATA_DIR
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
_TXT_STREAMING_THRESHOLD_BYTES = int(os.getenv("BOOKREADER_TXT_STREAMING_THRESHOLD_BYTES", str(8 * 1024 * 1024)))
_TXT_STREAM_READ_CHARS = int(os.getenv("BOOKREADER_TXT_STREAM_READ_CHARS", str(256 * 1024)))
_TXT_CHECKPOINT_INTERVAL_CHARS = int(os.getenv("BOOKREADER_TXT_CHECKPOINT_INTERVAL_CHARS", str(1024 * 1024)))
_TXT_INDEX_SCHEMA_VERSION = 2
_TXT_INDEX_DIR = DATA_DIR / "txt-index"
_TXT_WINDOW_DEFAULT_CHARS = 128 * 1024
TXT_WINDOW_MAX_CHARS = 1024 * 1024
TXT_HARD_SEGMENT_CHARS = 256 * 1024
TXT_ENCODING_OPTIONS = ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "cp949", "euc-kr", "latin-1")
_ENCODING_ALIASES = {
    "utf8": "utf-8",
    "utf_8": "utf-8",
    "utf-8": "utf-8",
    "utf-8-sig": "utf-8-sig",
    "utf_8_sig": "utf-8-sig",
    "utf16": "utf-16",
    "utf_16": "utf-16",
    "utf-16": "utf-16",
    "utf-16le": "utf-16-le",
    "utf_16_le": "utf-16-le",
    "utf-16-le": "utf-16-le",
    "utf-16be": "utf-16-be",
    "utf_16_be": "utf-16-be",
    "utf-16-be": "utf-16-be",
    "cp949": "cp949",
    "uhc": "cp949",
    "euc-kr": "euc-kr",
    "euc_kr": "euc-kr",
    "ks_c_5601-1987": "cp949",
    "latin-1": "latin-1",
    "latin_1": "latin-1",
    "iso-8859-1": "latin-1",
    "ascii": "utf-8",
}

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
    file_path: str
    text: str | None
    encoding: str
    total_chars: int
    segment_ranges: tuple[tuple[int, int], ...] = ()
    checkpoints: tuple[tuple[int, int], ...] = ()
    index_path: str | None = None
    segment_count: int = 0
    detected_encoding: str | None = None
    encoding_confidence: float | None = None
    encoding_override: str | None = None
    encoding_source: str = "auto"
    encoding_candidates: tuple[dict, ...] = ()

    @property
    def streaming(self) -> bool:
        return self.text is None


_source_cache: _WeightedLruCache[tuple[str, int, int, str], _TxtSource] = _WeightedLruCache(
    _TXT_SOURCE_CACHE_MAX_ENTRIES,
    _TXT_SOURCE_CACHE_MAX_BYTES,
)
_transform_index_cache: _WeightedLruCache[tuple, tuple[int, ...]] = _WeightedLruCache(
    16,
    _TXT_INDEX_CACHE_MAX_BYTES,
)
_index_build_lock = RLock()


def normalize_txt_encoding_override(value: str | None) -> str | None:
    if value is None or str(value).strip().lower() in {"", "auto"}:
        return None
    normalized = _ENCODING_ALIASES.get(str(value).strip().lower())
    if normalized not in TXT_ENCODING_OPTIONS:
        raise ValueError("Unsupported TXT encoding")
    return normalized


def _normalize_detected_encoding(value: str | None) -> str | None:
    if not value:
        return None
    return _ENCODING_ALIASES.get(str(value).strip().lower())


def _read_encoding_sample(file_path: str, size: int) -> tuple[bytes, ...]:
    """Read bounded head/middle/tail probes so an ASCII preface cannot hide legacy text."""
    if size <= _SAMPLE_SIZE * 3:
        with open(file_path, "rb") as file:
            return (file.read(_SAMPLE_SIZE * 3),)
    offsets = (0, max(0, size // 2 - _SAMPLE_SIZE // 2), max(0, size - _SAMPLE_SIZE))
    pieces: list[bytes] = []
    with open(file_path, "rb") as file:
        for offset in offsets:
            file.seek(offset)
            pieces.append(file.read(_SAMPLE_SIZE))
    return tuple(pieces)


def _probe_codec(encoding: str, first_probe: bytes, probe_index: int) -> str:
    if encoding != "utf-16" or probe_index == 0:
        return encoding
    if first_probe.startswith(codecs.BOM_UTF16_BE):
        return "utf-16-be"
    return "utf-16-le"


def _decode_probe_strict(probe: bytes, encoding: str, *, allow_start_trim: bool, allow_end_trim: bool) -> str | None:
    max_trim = 3 if encoding in {"utf-8", "utf-8-sig"} else (1 if encoding != "latin-1" else 0)
    starts = range(max_trim + 1) if allow_start_trim else (0,)
    ends = range(max_trim + 1) if allow_end_trim else (0,)
    attempts = sorted(((start + end, start, end) for start in starts for end in ends), key=lambda item: item[0])
    for _, start, end in attempts:
        stop = len(probe) - end if end else len(probe)
        if start >= stop:
            continue
        try:
            return probe[start:stop].decode(encoding, errors="strict")
        except (UnicodeDecodeError, LookupError):
            continue
    return None


def _encoding_candidate(sample_parts: tuple[bytes, ...], encoding: str, detected: str | None, confidence: float | None) -> dict:
    decoded_parts: list[str] = []
    strict_valid = True
    for index, probe in enumerate(sample_parts):
        probe_encoding = _probe_codec(encoding, sample_parts[0], index)
        decoded_probe = _decode_probe_strict(
            probe,
            probe_encoding,
            allow_start_trim=index > 0,
            allow_end_trim=index < len(sample_parts) - 1,
        )
        if decoded_probe is None:
            strict_valid = False
            try:
                decoded_probe = probe.decode(probe_encoding, errors="replace")
            except (UnicodeError, LookupError):
                decoded_probe = "\ufffd"
        decoded_parts.append(decoded_probe)
    decoded = "\n…\n".join(decoded_parts)
    decoded = decoded.replace("\r\n", "\n")
    if decoded.startswith("\ufeff"):
        decoded = decoded[1:]
    replacement_count = decoded.count("\ufffd")
    valid = strict_valid
    preview = decoded[:600]
    return {
        "encoding": encoding,
        "label": encoding.upper().replace("-SIG", " BOM"),
        "valid": valid,
        "strict_valid": strict_valid,
        "preview": preview,
        "confidence": confidence if encoding == detected else None,
        "replacement_count": replacement_count,
    }


def _inspect_encoding_sample(sample: bytes | tuple[bytes, ...], encoding_override: str | None = None) -> dict:
    sample_parts = (sample,) if isinstance(sample, bytes) else sample
    combined_sample = b"".join(sample_parts)
    first_probe = sample_parts[0] if sample_parts else b""
    override = normalize_txt_encoding_override(encoding_override)
    raw_detection = chardet.detect(combined_sample) if combined_sample else {"encoding": "utf-8", "confidence": 1.0}
    detected_raw = raw_detection.get("encoding")
    detected = _normalize_detected_encoding(detected_raw)
    confidence_value = raw_detection.get("confidence")
    confidence = float(confidence_value) if isinstance(confidence_value, (int, float)) else None

    bom_encoding = None
    if first_probe.startswith(codecs.BOM_UTF8):
        bom_encoding = "utf-8-sig"
    elif first_probe.startswith(codecs.BOM_UTF16_LE) or first_probe.startswith(codecs.BOM_UTF16_BE):
        bom_encoding = "utf-16"

    null_probe = first_probe[: min(len(first_probe), _SAMPLE_SIZE)]
    even_nulls = null_probe[0::2].count(0)
    odd_nulls = null_probe[1::2].count(0)
    pairs = max(1, len(null_probe) // 2)
    likely_utf16 = None
    if odd_nulls / pairs > 0.2 and odd_nulls >= max(2, even_nulls * 2):
        likely_utf16 = "utf-16-le"
    elif even_nulls / pairs > 0.2 and even_nulls >= max(2, odd_nulls * 2):
        likely_utf16 = "utf-16-be"

    order: list[str] = []
    detected_korean = detected if detected in {"cp949", "euc-kr"} else None
    for candidate in [
        override,
        bom_encoding,
        likely_utf16,
        "utf-8",
        detected_korean,
        "cp949",
        "euc-kr",
        detected,
        "latin-1",
        *TXT_ENCODING_OPTIONS,
    ]:
        if candidate in TXT_ENCODING_OPTIONS and candidate not in order:
            order.append(candidate)
    candidates = tuple(_encoding_candidate(sample_parts, candidate, detected, confidence) for candidate in order)
    if override:
        effective = override
        source = "override"
    else:
        effective = next((item["encoding"] for item in candidates if item["valid"]), "utf-8")
        source = "auto"
    effective_candidate = next((item for item in candidates if item["encoding"] == effective), None)
    if bom_encoding == effective:
        selection_confidence = 1.0
    elif likely_utf16 == effective:
        selection_confidence = 0.9
    elif effective == "utf-8" and effective_candidate and effective_candidate["strict_valid"]:
        selection_confidence = 1.0
    elif effective == detected and confidence is not None:
        selection_confidence = confidence
    elif effective in {"cp949", "euc-kr"}:
        selection_confidence = 0.5
    else:
        selection_confidence = 0.2
    warnings: list[str] = []
    if selection_confidence < 0.6:
        warnings.append("low_confidence")
    if effective_candidate and not effective_candidate["strict_valid"]:
        warnings.append("invalid_bytes_replaced")
    if combined_sample and all(byte < 0x80 for byte in combined_sample):
        warnings.append("ascii_only_sample")
    return {
        "encoding": effective,
        "detected_encoding": detected or detected_raw,
        "encoding_confidence": selection_confidence,
        "encoding_override": override,
        "encoding_source": source,
        "encoding_candidates": candidates,
        "warnings": warnings,
    }


def _append_hard_ranges(ranges: list[tuple[int, int]], start: int, end: int) -> None:
    cursor = start
    while cursor < end:
        next_cursor = min(end, cursor + TXT_HARD_SEGMENT_CHARS)
        ranges.append((cursor, next_cursor))
        cursor = next_cursor


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
            _append_hard_ranges(ranges, cursor, end_offset)
        cursor = end_offset + 2 if next_break >= 0 else length
    return tuple(ranges)


def _source_weight(source: _TxtSource) -> int:
    # Conservative UTF-16-like estimate plus Python integer/tuple overhead.
    text_weight = len(source.text) * 2 if source.text is not None else 0
    return text_weight + len(source.segment_ranges) * 32 + len(source.checkpoints) * 32 + len(source.file_path) * 2


def _index_path_for(file_path: str, size: int, mtime_ns: int, encoding: str) -> Path:
    identity = f"{_TXT_INDEX_SCHEMA_VERSION}\0{file_path}\0{size}\0{mtime_ns}\0{encoding}".encode("utf-8")
    return _TXT_INDEX_DIR / f"{hashlib.sha256(identity).hexdigest()}.sqlite3"


def _load_streaming_index(file_path: str, size: int, mtime_ns: int, expected_encoding: str, index_path: Path) -> _TxtSource | None:
    if not index_path.exists():
        return None
    try:
        with sqlite3.connect(index_path) as connection:
            row = connection.execute(
                "SELECT schema_version, source_path, source_size, source_mtime_ns, encoding, "
                "total_chars, segment_count, completed FROM metadata LIMIT 1"
            ).fetchone()
        if row is None:
            return None
        schema_version, source_path, source_size, source_mtime_ns, encoding, total_chars, segment_count, completed = row
        if (
            schema_version != _TXT_INDEX_SCHEMA_VERSION
            or source_path != file_path
            or source_size != size
            or source_mtime_ns != mtime_ns
            or encoding != expected_encoding
            or completed != 1
        ):
            return None
        return _TxtSource(
            file_path=file_path,
            text=None,
            encoding=encoding,
            total_chars=total_chars,
            index_path=str(index_path),
            segment_count=segment_count,
        )
    except (OSError, sqlite3.DatabaseError, TypeError, ValueError):
        return None


def _build_streaming_source(file_path: str, size: int, mtime_ns: int, encoding: str) -> _TxtSource:
    index_path = _index_path_for(file_path, size, mtime_ns, encoding)
    with _index_build_lock:
        cached = _load_streaming_index(file_path, size, mtime_ns, encoding, index_path)
        if cached is not None:
            return cached

        _TXT_INDEX_DIR.mkdir(parents=True, exist_ok=True)
        temporary_path = index_path.with_name(f".{index_path.name}.{os.getpid()}.tmp")
        temporary_path.unlink(missing_ok=True)
        connection = sqlite3.connect(temporary_path)
        # The database is a disposable derived cache built under a temporary
        # name. Avoid journaling the bulk insert, then fsync before publishing
        # it atomically so an interrupted build can never look complete.
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("PRAGMA synchronous=OFF")
        connection.execute("PRAGMA locking_mode=EXCLUSIVE")
        connection.execute(
            "CREATE TABLE metadata (schema_version INTEGER NOT NULL, source_path TEXT NOT NULL, "
            "source_size INTEGER NOT NULL, source_mtime_ns INTEGER NOT NULL, encoding TEXT NOT NULL, "
            "total_chars INTEGER NOT NULL, segment_count INTEGER NOT NULL, completed INTEGER NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE segments (segment_id INTEGER PRIMARY KEY, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE checkpoints (char_offset INTEGER PRIMARY KEY, cookie TEXT NOT NULL)"
        )
        connection.execute("INSERT INTO checkpoints(char_offset, cookie) VALUES(0, '0')")

        segment_count = 0
        pending_segment_rows: list[tuple[int, int, int]] = []
        pending_cr = ""
        boundary_carry = ""
        segment_start: int | None = None
        total_chars = 0
        last_checkpoint = 0

        try:
            with open(file_path, "rb") as binary:
                with io.TextIOWrapper(binary, encoding=encoding, errors="replace", newline="") as reader:
                    while True:
                        if not pending_cr and total_chars - last_checkpoint >= max(1, _TXT_CHECKPOINT_INTERVAL_CHARS):
                            connection.execute(
                                "INSERT OR IGNORE INTO checkpoints(char_offset, cookie) VALUES(?, ?)",
                                (total_chars, str(reader.tell())),
                            )
                            last_checkpoint = total_chars

                        chunk = reader.read(max(1, _TXT_STREAM_READ_CHARS))
                        if not chunk:
                            if not pending_cr:
                                break
                            normalized = "\n"
                            pending_cr = ""
                        else:
                            chunk = pending_cr + chunk
                            pending_cr = ""
                            if chunk.endswith("\r"):
                                pending_cr = "\r"
                                chunk = chunk[:-1]
                            normalized = chunk.replace("\r\n", "\n").replace("\r", "\n")

                        if total_chars == 0 and normalized.startswith("\ufeff"):
                            normalized = normalized[1:]

                        if normalized:
                            chunk_start = total_chars
                            total_chars += len(normalized)
                            combined = boundary_carry + normalized
                            combined_start = chunk_start - len(boundary_carry)
                            cursor = 0
                            while cursor < len(combined):
                                if segment_start is None:
                                    while cursor < len(combined) and combined[cursor] == "\n":
                                        cursor += 1
                                    if cursor >= len(combined):
                                        break
                                    segment_start = combined_start + cursor
                                next_break = combined.find("\n\n", cursor)
                                if next_break < 0:
                                    break
                                end_offset = combined_start + next_break
                                while segment_start + TXT_HARD_SEGMENT_CHARS < end_offset:
                                    hard_end = segment_start + TXT_HARD_SEGMENT_CHARS
                                    pending_segment_rows.append((segment_count, segment_start, hard_end))
                                    segment_count += 1
                                    segment_start = hard_end
                                if end_offset > segment_start:
                                    pending_segment_rows.append((segment_count, segment_start, end_offset))
                                    segment_count += 1
                                if len(pending_segment_rows) >= 2048:
                                    connection.executemany(
                                        "INSERT INTO segments(segment_id, start_offset, end_offset) VALUES(?, ?, ?)",
                                        pending_segment_rows,
                                    )
                                    pending_segment_rows.clear()
                                segment_start = None
                                cursor = next_break + 2
                            available_end = combined_start + len(combined) - (1 if combined.endswith("\n") else 0)
                            while segment_start is not None and segment_start + TXT_HARD_SEGMENT_CHARS <= available_end:
                                hard_end = segment_start + TXT_HARD_SEGMENT_CHARS
                                pending_segment_rows.append((segment_count, segment_start, hard_end))
                                segment_count += 1
                                segment_start = hard_end
                                if len(pending_segment_rows) >= 2048:
                                    connection.executemany(
                                        "INSERT INTO segments(segment_id, start_offset, end_offset) VALUES(?, ?, ?)",
                                        pending_segment_rows,
                                    )
                                    pending_segment_rows.clear()
                            boundary_carry = "\n" if combined.endswith("\n") else ""

            while segment_start is not None and total_chars > segment_start:
                hard_end = min(total_chars, segment_start + TXT_HARD_SEGMENT_CHARS)
                pending_segment_rows.append((segment_count, segment_start, hard_end))
                segment_count += 1
                segment_start = hard_end if hard_end < total_chars else None
            if pending_segment_rows:
                connection.executemany(
                    "INSERT INTO segments(segment_id, start_offset, end_offset) VALUES(?, ?, ?)",
                    pending_segment_rows,
                )
            connection.execute(
                "INSERT INTO metadata VALUES(?, ?, ?, ?, ?, ?, ?, 1)",
                (_TXT_INDEX_SCHEMA_VERSION, file_path, size, mtime_ns, encoding, total_chars, segment_count),
            )
            connection.commit()
        except Exception:
            connection.close()
            temporary_path.unlink(missing_ok=True)
            raise
        else:
            connection.close()
            with open(temporary_path, "r+b") as index_file:
                os.fsync(index_file.fileno())
            os.replace(temporary_path, index_path)

        source = _load_streaming_index(file_path, size, mtime_ns, encoding, index_path)
        if source is None:
            raise OSError("Failed to build TXT streaming index")
        return source


def _segment_range(source: _TxtSource, segment_id: int) -> tuple[int, int]:
    if not source.streaming:
        return source.segment_ranges[segment_id]
    if source.index_path is None:
        raise IndexError("TXT streaming index is unavailable")
    with sqlite3.connect(source.index_path) as connection:
        row = connection.execute(
            "SELECT start_offset, end_offset FROM segments WHERE segment_id = ?",
            (segment_id,),
        ).fetchone()
    if row is None:
        raise IndexError("TXT segment is unavailable")
    return int(row[0]), int(row[1])


def _segment_count(source: _TxtSource) -> int:
    return source.segment_count if source.streaming else len(source.segment_ranges)


def _checkpoint_for(source: _TxtSource, char_offset: int) -> tuple[int, int]:
    if not source.streaming or source.index_path is None:
        return 0, 0
    with sqlite3.connect(source.index_path) as connection:
        row = connection.execute(
            "SELECT char_offset, cookie FROM checkpoints WHERE char_offset <= ? ORDER BY char_offset DESC LIMIT 1",
            (char_offset,),
        ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0]), int(row[1])


def _iter_segment_ranges(source: _TxtSource):
    if not source.streaming:
        yield from enumerate(source.segment_ranges)
        return
    if source.index_path is None:
        return
    with sqlite3.connect(source.index_path) as connection:
        cursor = connection.execute("SELECT segment_id, start_offset, end_offset FROM segments ORDER BY segment_id")
        for segment_id, start_offset, end_offset in cursor:
            yield int(segment_id), (int(start_offset), int(end_offset))


def _read_streaming_range(source: _TxtSource, start: int, end: int) -> str:
    safe_start = max(0, min(start, source.total_chars))
    safe_end = max(safe_start, min(end, source.total_chars))
    if safe_start == safe_end:
        return ""

    current_offset, cookie = _checkpoint_for(source, safe_start)
    pieces: list[str] = []
    pending_cr = ""

    with open(source.file_path, "rb") as binary:
        with io.TextIOWrapper(binary, encoding=source.encoding, errors="replace", newline="") as reader:
            reader.seek(cookie)
            while current_offset < safe_end:
                chunk = reader.read(max(1, _TXT_STREAM_READ_CHARS))
                if not chunk:
                    if not pending_cr:
                        break
                    normalized = "\n"
                    pending_cr = ""
                else:
                    chunk = pending_cr + chunk
                    pending_cr = ""
                    if chunk.endswith("\r"):
                        pending_cr = "\r"
                        chunk = chunk[:-1]
                    normalized = chunk.replace("\r\n", "\n").replace("\r", "\n")

                if current_offset == 0 and normalized.startswith("\ufeff"):
                    normalized = normalized[1:]

                chunk_end = current_offset + len(normalized)
                overlap_start = max(safe_start, current_offset)
                overlap_end = min(safe_end, chunk_end)
                if overlap_start < overlap_end:
                    pieces.append(normalized[overlap_start - current_offset:overlap_end - current_offset])
                current_offset = chunk_end

    return "".join(pieces)


def _read_source_range(source: _TxtSource, start: int, end: int) -> str:
    if source.text is not None:
        return source.text[start:end]
    return _read_streaming_range(source, start, end)


def _load_txt_source(file_path: str, size: int, mtime_ns: int, encoding_override: str | None = None) -> _TxtSource:
    normalized_override = normalize_txt_encoding_override(encoding_override)
    key = (file_path, size, mtime_ns, normalized_override or "auto")
    cached = _source_cache.get(key)
    if cached is not None:
        return cached
    sample = _read_encoding_sample(file_path, size)
    inspection = _inspect_encoding_sample(sample, normalized_override)
    with open(file_path, "rb") as file:
        if size < max(1, _TXT_STREAMING_THRESHOLD_BYTES):
            raw_data = file.read()
        else:
            raw_data = None

    if raw_data is None:
        source = _build_streaming_source(
            file_path,
            size,
            mtime_ns,
            inspection["encoding"],
        )
    else:
        normalized = raw_data.decode(inspection["encoding"], errors="replace").replace("\r\n", "\n").replace("\r", "\n")
        if normalized.startswith("\ufeff"):
            normalized = normalized[1:]
        segment_ranges = _build_segment_ranges(normalized)
        source = _TxtSource(
            file_path=file_path,
            text=normalized,
            encoding=inspection["encoding"],
            total_chars=len(normalized),
            segment_ranges=segment_ranges,
            segment_count=len(segment_ranges),
        )
    source = replace(
        source,
        detected_encoding=inspection["detected_encoding"],
        encoding_confidence=inspection["encoding_confidence"],
        encoding_override=inspection["encoding_override"],
        encoding_source=inspection["encoding_source"],
        encoding_candidates=inspection["encoding_candidates"],
    )
    return _source_cache.put(key, source, _source_weight(source))


def _source_for_path(file_path: str, encoding_override: str | None = None) -> tuple[_TxtSource, tuple[str, int, int, str]]:
    path = Path(file_path)
    stat = path.stat()
    normalized_override = normalize_txt_encoding_override(encoding_override)
    base_key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
    source = _load_txt_source(*base_key, normalized_override)
    return source, (*base_key, source.encoding)


def _segment(source: _TxtSource, segment_id: int) -> dict:
    start_offset, end_offset = _segment_range(source, segment_id)
    return {
        "segment_id": segment_id,
        "text": _read_source_range(source, start_offset, end_offset),
        "start_offset": start_offset,
        "end_offset": end_offset,
    }


def _segments(source: _TxtSource, start: int = 0, end: int | None = None) -> list[dict]:
    stop = _segment_count(source) if end is None else min(end, _segment_count(source))
    return [_segment(source, index) for index in range(max(0, start), stop)]


def _options(transform_options: dict | None) -> dict:
    return {**_DEFAULT_TRANSFORM_OPTIONS, **(transform_options or {})}


def _options_key(options: dict) -> tuple[bool, bool, bool]:
    return options["trim_spaces"], options["remove_empty_lines"], options["split_paragraphs"]


def _source_revision(source_key: tuple[str, int, int, str]) -> str:
    _, size, mtime_ns, encoding = source_key
    identity = f"{_TXT_INDEX_SCHEMA_VERSION}:{TXT_HARD_SEGMENT_CHARS}:{size}:{mtime_ns}:{encoding}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]


def _transform_segment(source: _TxtSource, segment_id: int, options: dict) -> list[dict]:
    return transform_txt_segments(
        [_segment(source, segment_id)],
        trim_spaces=options["trim_spaces"],
        remove_empty_lines=options["remove_empty_lines"],
        split_paragraphs=options["split_paragraphs"],
    )["fragments"]


def _transform_prefix(source: _TxtSource, source_key: tuple[str, int, int, str], options: dict) -> tuple[int, ...]:
    cache_key = (*source_key, *_options_key(options))
    cached = _transform_index_cache.get(cache_key)
    if cached is not None:
        return cached
    prefix = [0]
    for segment_id in range(_segment_count(source)):
        prefix.append(prefix[-1] + len(_transform_segment(source, segment_id, options)))
    result = tuple(prefix)
    return _transform_index_cache.put(cache_key, result, len(result) * 8)


def _plain_fragment(source: _TxtSource, fragment_index: int) -> dict:
    start_offset, end_offset = _segment_range(source, fragment_index)
    return _plain_fragment_slice(source, fragment_index, 0, end_offset - start_offset)


def _plain_fragment_slice(source: _TxtSource, fragment_index: int, start: int, end: int) -> dict:
    segment_start, segment_end = _segment_range(source, fragment_index)
    safe_start = max(0, min(start, segment_end - segment_start))
    safe_end = max(safe_start, min(end, segment_end - segment_start))
    source_start = segment_start + safe_start
    source_end = segment_start + safe_end
    text = _read_source_range(source, source_start, source_end)
    length = len(text)
    return {
        "segment_id": fragment_index,
        "fragment_index": fragment_index,
        "display_text": text,
        "source_start_offset": source_start,
        "source_end_offset": source_end,
        "display_start_offset": safe_start,
        "display_to_source_runs": [[0, source_start, length]],
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


def prepare_txt_index(file_path: str, encoding_override: str | None = None) -> None:
    path = Path(file_path)
    try:
        if path.stat().st_size >= max(1, _TXT_STREAMING_THRESHOLD_BYTES):
            _source_for_path(str(path), encoding_override)
    except OSError:
        return


def should_prewarm_txt_search(file_path: str) -> bool:
    try:
        return Path(file_path).stat().st_size < max(1, _TXT_STREAMING_THRESHOLD_BYTES)
    except OSError:
        return False


def read_txt_encoding_preview(file_path: str, encoding_override: str | None = None) -> dict:
    path = Path(file_path)
    stat = path.stat()
    sample = _read_encoding_sample(str(path), stat.st_size)
    inspection = _inspect_encoding_sample(sample, encoding_override)
    return {
        **inspection,
        "sampled_bytes": sum(len(part) for part in sample),
    }


def read_txt_file(file_path: str, encoding_override: str | None = None) -> dict:
    source, _ = _source_for_path(file_path, encoding_override)
    return {"text": _read_source_range(source, 0, source.total_chars), "encoding": source.encoding}


def read_txt_manifest(
    file_path: str,
    transform_options: dict | None = None,
    include_fragments: bool = True,
    include_segments: bool = True,
    encoding_override: str | None = None,
) -> dict:
    source, source_key = _source_for_path(file_path, encoding_override)
    options = _options(transform_options)
    active_transforms = any(options.values())
    prefix = _transform_prefix(source, source_key, options) if active_transforms else None
    segment_count = prefix[-1] if prefix is not None else _segment_count(source)
    display_fragments: list[dict] = []
    if include_fragments:
        for fragment_index in range(segment_count):
            display_fragments.append(_fragment_at(source, fragment_index, options, prefix))
    response = {
        "encoding": source.encoding,
        "detected_encoding": source.detected_encoding,
        "encoding_confidence": source.encoding_confidence,
        "encoding_override": source.encoding_override,
        "encoding_source": source.encoding_source,
        "encoding_candidates": list(source.encoding_candidates),
        "source_revision": _source_revision(source_key),
        "total_chars": source.total_chars,
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
    encoding_override: str | None = None,
) -> dict:
    source, source_key = _source_for_path(file_path, encoding_override)
    options = _options(transform_options)
    active_transforms = any(options.values())
    prefix = _transform_prefix(source, source_key, options) if active_transforms else None
    total = prefix[-1] if prefix is not None else _segment_count(source)
    safe_start = max(0, start)
    safe_limit = max(1, min(limit, 120))
    char_budget = max(1, min(max_chars, TXT_WINDOW_MAX_CHARS))
    fragment_index, display_offset = _parse_cursor(cursor, safe_start)
    fragment_index = min(fragment_index, total)
    range_end = min(total, safe_start + safe_limit)
    if cursor and fragment_index < total and not (safe_start <= fragment_index < range_end):
        raise ValueError("TXT window cursor is outside the requested range")
    initial_fragment_index = fragment_index
    fragments: list[dict] = []
    returned_chars = 0
    returned_fragment_count = 0

    while fragment_index < range_end and returned_fragment_count < safe_limit and returned_chars < char_budget:
        if prefix is None:
            segment_start, segment_end = _segment_range(source, fragment_index)
            text_length = segment_end - segment_start
        else:
            fragment = _fragment_at(source, fragment_index, options, prefix)
            text_length = len(fragment["display_text"])
        if display_offset >= text_length:
            fragment_index += 1
            display_offset = 0
            continue
        take = min(text_length - display_offset, char_budget - returned_chars)
        if prefix is None:
            fragments.append(_plain_fragment_slice(source, fragment_index, display_offset, display_offset + take))
        else:
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
