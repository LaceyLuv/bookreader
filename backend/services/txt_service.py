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


def clear_txt_caches() -> None:
    _read_txt_file_cached.cache_clear()


def read_txt_file(file_path: str) -> dict:
    """Read a TXT file with automatic encoding detection and cache the decoded result."""
    stat = Path(file_path).stat()
    normalized_path = str(Path(file_path).resolve())
    text, encoding = _read_txt_file_cached(normalized_path, stat.st_size, stat.st_mtime_ns)
    return {"text": text, "encoding": encoding}
