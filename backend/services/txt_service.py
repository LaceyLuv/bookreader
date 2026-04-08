from functools import lru_cache
from pathlib import Path

import chardet


_SAMPLE_SIZE = 64 * 1024  # 64KB is sufficient for encoding detection


def _decode_txt_bytes(raw_data: bytes, detected_encoding: str | None) -> dict:
    # Try detected encoding first, then fallback chain
    for encoding in [detected_encoding, "utf-8", "euc-kr", "latin-1"]:
        if encoding is None:
            continue
        try:
            text = raw_data.decode(encoding)
            return {"text": text, "encoding": encoding}
        except (UnicodeDecodeError, LookupError):
            continue

    # Last resort
    text = raw_data.decode("utf-8", errors="replace")
    return {"text": text, "encoding": "utf-8 (fallback)"}


@lru_cache(maxsize=24)
def _read_txt_file_cached(file_path: str, size: int, mtime_ns: int) -> tuple[str, str]:
    with open(file_path, "rb") as f:
        sample = f.read(_SAMPLE_SIZE)
        detection = chardet.detect(sample)
        detected_encoding = detection.get("encoding", "utf-8")
        f.seek(0)
        raw_data = f.read()

    decoded = _decode_txt_bytes(raw_data, detected_encoding)
    return decoded["text"], decoded["encoding"]


def _split_txt_segments(text: str) -> list[dict]:
    normalized = text.replace("\r\n", "\n")
    if not normalized:
        return []

    segments = []
    segment_id = 0
    length = len(normalized)
    cursor = 0

    while cursor < length:
        while cursor < length and normalized[cursor] == "\n":
            cursor += 1
        if cursor >= length:
            break

        next_break = normalized.find("\n\n", cursor)
        end_offset = length if next_break < 0 else next_break
        segment_text = normalized[cursor:end_offset]
        if segment_text:
            segments.append({
                "segment_id": segment_id,
                "text": segment_text,
                "start_offset": cursor,
                "end_offset": end_offset,
            })
            segment_id += 1
        cursor = end_offset + 2 if next_break >= 0 else length

    return segments


@lru_cache(maxsize=24)
def _read_txt_manifest_cached(file_path: str, size: int, mtime_ns: int) -> dict:
    text, encoding = _read_txt_file_cached(file_path, size, mtime_ns)
    normalized = text.replace("\r\n", "\n")
    segments = _split_txt_segments(normalized)
    return {
        "text": normalized,
        "encoding": encoding,
        "total_chars": len(normalized),
        "segment_count": len(segments),
        "segments": segments,
    }


def clear_txt_caches() -> None:
    _read_txt_file_cached.cache_clear()
    _read_txt_manifest_cached.cache_clear()


def read_txt_file(file_path: str) -> dict:
    """Read a TXT file with automatic encoding detection and cache the decoded result."""
    stat = Path(file_path).stat()
    normalized_path = str(Path(file_path).resolve())
    text, encoding = _read_txt_file_cached(normalized_path, stat.st_size, stat.st_mtime_ns)
    return {"text": text, "encoding": encoding}


def read_txt_manifest(file_path: str) -> dict:
    stat = Path(file_path).stat()
    normalized_path = str(Path(file_path).resolve())
    return _read_txt_manifest_cached(normalized_path, stat.st_size, stat.st_mtime_ns)
