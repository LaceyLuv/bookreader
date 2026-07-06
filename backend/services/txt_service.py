from functools import lru_cache
from pathlib import Path

import chardet

from services.txt_transform_service import transform_txt_segments


_SAMPLE_SIZE = 64 * 1024  # 64KB is sufficient for encoding detection
_DEFAULT_TRANSFORM_OPTIONS = {
    "trim_spaces": False,
    "remove_empty_lines": False,
    "split_paragraphs": False,
}


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


def _segments_to_display_fragments(segments: list[dict]) -> list[dict]:
    fragments = []
    for segment in segments:
        start_offset = segment["start_offset"]
        end_offset = segment["end_offset"]
        fragments.append(
            {
                "segment_id": segment["segment_id"],
                "display_text": segment["text"],
                "source_start_offset": start_offset,
                "source_end_offset": end_offset,
                "display_to_source": list(range(start_offset, end_offset)),
            }
        )
    return fragments


def _build_txt_response(
    manifest: dict,
    options: dict,
    display_fragments: list[dict] | None = None,
    include_segments: bool = True,
    segment_count: int | None = None,
) -> dict:
    fragments = display_fragments if display_fragments is not None else _segments_to_display_fragments(manifest["segments"])
    response = {
        "encoding": manifest["encoding"],
        "total_chars": manifest["total_chars"],
        "segment_count": segment_count if _is_nonnegative_int(segment_count) else len(fragments),
        "transform_options": options,
        "display_fragments": fragments,
    }
    if include_segments:
        response["segments"] = manifest["segments"]
    return response


def _is_nonnegative_int(value: int | None) -> bool:
    return isinstance(value, int) and value >= 0


def clear_txt_caches() -> None:
    _read_txt_file_cached.cache_clear()
    _read_txt_manifest_cached.cache_clear()


def read_txt_file(file_path: str) -> dict:
    """Read a TXT file with automatic encoding detection and cache the decoded result."""
    stat = Path(file_path).stat()
    normalized_path = str(Path(file_path).resolve())
    text, encoding = _read_txt_file_cached(normalized_path, stat.st_size, stat.st_mtime_ns)
    return {"text": text, "encoding": encoding}


def read_txt_manifest(
    file_path: str,
    transform_options: dict | None = None,
    include_fragments: bool = True,
    include_segments: bool = True,
) -> dict:
    stat = Path(file_path).stat()
    normalized_path = str(Path(file_path).resolve())
    manifest = _read_txt_manifest_cached(normalized_path, stat.st_size, stat.st_mtime_ns)
    options = {**_DEFAULT_TRANSFORM_OPTIONS, **(transform_options or {})}
    if not any(options.values()):
        return _build_txt_response(
            manifest,
            options,
            display_fragments=_segments_to_display_fragments(manifest["segments"]) if include_fragments else [],
            include_segments=include_segments,
            segment_count=len(manifest["segments"]) if not include_fragments else None,
        )

    if include_fragments:
        transformed = transform_txt_segments(
            manifest["segments"],
            trim_spaces=options["trim_spaces"],
            remove_empty_lines=options["remove_empty_lines"],
            split_paragraphs=options["split_paragraphs"],
        )
        display_fragments = transformed["fragments"]
    else:
        transformed_count = 0
        for segment in manifest["segments"]:
            transformed = transform_txt_segments(
                [segment],
                trim_spaces=options["trim_spaces"],
                remove_empty_lines=options["remove_empty_lines"],
                split_paragraphs=options["split_paragraphs"],
            )
            transformed_count += len(transformed["fragments"])

    return _build_txt_response(
        manifest,
        options,
        display_fragments=display_fragments if include_fragments else [],
        include_segments=include_segments,
        segment_count=len(display_fragments) if include_fragments else transformed_count,
    )


def read_txt_segment_window(
    file_path: str,
    start: int = 0,
    limit: int = 40,
    transform_options: dict | None = None,
) -> dict:
    stat = Path(file_path).stat()
    normalized_path = str(Path(file_path).resolve())
    manifest = _read_txt_manifest_cached(normalized_path, stat.st_size, stat.st_mtime_ns)
    options = {**_DEFAULT_TRANSFORM_OPTIONS, **(transform_options or {})}
    safe_start = max(0, start)
    safe_limit = max(1, min(limit, 120))

    if not any(options.values()):
        fragments = _segments_to_display_fragments(manifest["segments"][safe_start:safe_start + safe_limit])
        total = len(manifest["segments"])
    else:
        transformed = transform_txt_segments(
            manifest["segments"],
            trim_spaces=options["trim_spaces"],
            remove_empty_lines=options["remove_empty_lines"],
            split_paragraphs=options["split_paragraphs"],
        )
        all_fragments = transformed["fragments"]
        fragments = all_fragments[safe_start:safe_start + safe_limit]
        total = len(all_fragments)

    return {
        "start": safe_start,
        "limit": safe_limit,
        "total": total,
        "transform_options": options,
        "display_fragments": fragments,
    }
