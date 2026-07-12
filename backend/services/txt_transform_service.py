from __future__ import annotations

import re
from typing import Any


_HORIZONTAL_SPACES = {" ", "\t", "\u00a0", "\u202f", "\u3000"}
_INVISIBLE_SPACES = {"\u200b", "\u2060", "\ufeff"}
_SENTENCE_TERMINATORS = {".", "!", "?", "。", "！", "？", "…"}
_SENTENCE_CLOSERS = {'"', "'", "”", "’", "」", "』", "〉", "》", ")", "]", "}"}
_SENTENCE_OPENERS = {'"', "'", "“", "‘", "「", "『", "〈", "《", "(", "[", "{"}
_DIALOGUE_START_RE = re.compile(r'^(?:["“‘「『〈《]|[-–—]\s*[^-–—])')
_SPEAKER_LINE_RE = re.compile(r"^[^\s:：]{1,12}\s*[:：]\s*\S")
_TITLE_LINE_RE = re.compile(
    r"^(?:제?\s*\d+\s*[장화편부]|chapter\s+\d+|prologue|epilogue|서장|종장|프롤로그|에필로그)\b",
    re.IGNORECASE,
)
_DENSE_SPLIT_MIN_CHARS = 80
_DENSE_TARGET_CHARS = 420
_DENSE_MAX_CHARS = 700


def _normalize_newlines_with_mapping(text: str) -> tuple[str, list[int]]:
    display_chars: list[str] = []
    display_to_source: list[int] = []
    index = 0

    while index < len(text):
        char = text[index]
        if char == "\r":
            if index + 1 < len(text) and text[index + 1] == "\n":
                display_chars.append("\n")
                display_to_source.append(index + 1)
                index += 2
                continue

            display_chars.append("\n")
            display_to_source.append(index)
            index += 1
            continue

        display_chars.append(char)
        display_to_source.append(index)
        index += 1

    return "".join(display_chars), display_to_source


def _split_source_lines(text: str, offsets: list[int]) -> list[tuple[str, list[int], int | None]]:
    lines: list[tuple[str, list[int], int | None]] = []
    start = 0
    for index, char in enumerate(text):
        if char != "\n":
            continue
        lines.append((text[start:index], offsets[start:index], offsets[index]))
        start = index + 1

    lines.append((text[start:], offsets[start:], None))
    return lines


def _trim_spaces(line: str, offsets: list[int]) -> tuple[str, list[int]]:
    if not line:
        return "", []

    start = 0
    end = len(line)
    while start < end and (line[start] in _HORIZONTAL_SPACES or line[start] in _INVISIBLE_SPACES):
        start += 1
    while end > start and (line[end - 1] in _HORIZONTAL_SPACES or line[end - 1] in _INVISIBLE_SPACES):
        end -= 1

    if start >= end:
        return "", []

    display_chars: list[str] = []
    display_offsets: list[int] = []
    previous_was_space = False

    for index in range(start, end):
        char = line[index]
        if char in _INVISIBLE_SPACES:
            continue
        if char in _HORIZONTAL_SPACES:
            if previous_was_space:
                continue
            display_chars.append(" ")
            display_offsets.append(offsets[index])
            previous_was_space = True
            continue

        display_chars.append(char)
        display_offsets.append(offsets[index])
        previous_was_space = False

    return "".join(display_chars), display_offsets


def _collapse_empty_lines(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collapsed: list[dict[str, Any]] = []
    blank_entry: dict[str, Any] | None = None

    for entry in entries:
        if entry["text"] == "":
            if blank_entry is None:
                blank_entry = entry
            continue

        if blank_entry is not None and collapsed:
            collapsed.append(blank_entry)
        blank_entry = None
        collapsed.append(entry)

    return collapsed


def _assemble_entries(entries: list[dict[str, Any]]) -> tuple[str, list[int]]:
    display_parts: list[str] = []
    display_to_source: list[int] = []

    for index, entry in enumerate(entries):
        text = entry["text"]
        display_parts.append(text)
        display_to_source.extend(entry["map"])

        if index == len(entries) - 1:
            continue

        newline_offset = entry["newline_offset"]
        if newline_offset is None:
            continue

        display_parts.append("\n")
        display_to_source.append(newline_offset)

    return "".join(display_parts), display_to_source


def _is_decimal_point(text: str, index: int) -> bool:
    return (
        text[index] == "."
        and index > 0
        and index + 1 < len(text)
        and text[index - 1].isdigit()
        and text[index + 1].isdigit()
    )


def _sentence_boundaries(text: str) -> list[int]:
    boundaries: list[int] = []
    index = 0
    while index < len(text):
        if text[index] not in _SENTENCE_TERMINATORS or _is_decimal_point(text, index):
            index += 1
            continue

        end = index + 1
        while end < len(text) and text[end] in _SENTENCE_TERMINATORS:
            end += 1
        while end < len(text) and text[end] in _SENTENCE_CLOSERS:
            end += 1
        previous = text[index - 1] if index > 0 else ""
        following = text[end] if end < len(text) else ""
        hangul_continuation = (
            previous
            and following
            and "가" <= previous <= "힣"
            and "가" <= following <= "힣"
        )
        if end == len(text) or text[end].isspace() or text[end] in _SENTENCE_OPENERS or hangul_continuation:
            boundaries.append(end)
        index = end
    return boundaries


def _is_structural_line(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    return bool(
        _DIALOGUE_START_RE.match(stripped)
        or _SPEAKER_LINE_RE.match(stripped)
        or _TITLE_LINE_RE.match(stripped)
    )


def _structural_boundaries(text: str) -> list[int]:
    boundaries: set[int] = set()
    line_start = 0
    for line in text.splitlines(keepends=True):
        line_end = line_start + len(line.rstrip("\r\n"))
        if _is_structural_line(line):
            if line_start > 0:
                boundaries.add(line_start)
            boundaries.add(line_end)
        line_start += len(line)
    return sorted(boundary for boundary in boundaries if 0 < boundary < len(text))


def _trim_fragment_edges(text: str, mapping: list[int]) -> tuple[str, list[int]]:
    start = 0
    end = len(text)
    while start < end and text[start] in {" ", "\t", "\n"}:
        start += 1
    while end > start and text[end - 1] in {" ", "\t", "\n"}:
        end -= 1
    return text[start:end], mapping[start:end]


def _preferred_fallback_boundary(text: str, start: int, hard_end: int) -> int:
    minimum = min(hard_end, start + _DENSE_SPLIT_MIN_CHARS)
    for index in range(hard_end - 1, minimum - 1, -1):
        if text[index] == "\n":
            return index + 1
    for index in range(hard_end - 1, minimum - 1, -1):
        if text[index].isspace():
            return index + 1
    return hard_end


def _split_region(text: str, mapping: list[int]) -> list[tuple[str, list[int]]]:
    clean_text, clean_map = _trim_fragment_edges(text, mapping)
    if not clean_text:
        return []

    sentence_boundaries = _sentence_boundaries(clean_text)
    hangul_count = sum(1 for char in clean_text if "가" <= char <= "힣")
    minimum_split_chars = 60 if hangul_count >= len(clean_text) // 2 else _DENSE_SPLIT_MIN_CHARS
    if len(clean_text) <= _DENSE_MAX_CHARS:
        if len(clean_text) < minimum_split_chars or len(sentence_boundaries) < 4:
            return [(clean_text, clean_map)]
        split_pos = sentence_boundaries[len(sentence_boundaries) // 2 - 1]
        left = _trim_fragment_edges(clean_text[:split_pos], clean_map[:split_pos])
        right = _trim_fragment_edges(clean_text[split_pos:], clean_map[split_pos:])
        return [fragment for fragment in (left, right) if fragment[0]]

    fragments: list[tuple[str, list[int]]] = []
    start = 0
    while start < len(clean_text):
        remaining = len(clean_text) - start
        if remaining <= _DENSE_MAX_CHARS:
            fragment = _trim_fragment_edges(clean_text[start:], clean_map[start:])
            if fragment[0]:
                fragments.append(fragment)
            break

        target_end = min(len(clean_text), start + _DENSE_TARGET_CHARS)
        hard_end = min(len(clean_text), start + _DENSE_MAX_CHARS)
        candidates = [
            boundary for boundary in sentence_boundaries
            if start + _DENSE_SPLIT_MIN_CHARS <= boundary <= hard_end
        ]
        preferred = [boundary for boundary in candidates if boundary <= target_end]
        split_pos = preferred[-1] if preferred else (candidates[0] if candidates else _preferred_fallback_boundary(clean_text, start, hard_end))
        fragment = _trim_fragment_edges(clean_text[start:split_pos], clean_map[start:split_pos])
        if fragment[0]:
            fragments.append(fragment)
        start = max(split_pos, start + 1)

    return fragments


def _split_dense_block(display_text: str, display_to_source: list[int]) -> list[tuple[str, list[int]]]:
    boundaries = [0, *_structural_boundaries(display_text), len(display_text)]
    fragments: list[tuple[str, list[int]]] = []
    for start, end in zip(boundaries, boundaries[1:]):
        fragments.extend(_split_region(display_text[start:end], display_to_source[start:end]))
    return fragments or [(display_text, display_to_source)]


def _build_fragment(
    segment_id: Any,
    segment_start_offset: int,
    display_text: str,
    display_to_source: list[int],
) -> dict[str, Any] | None:
    if not display_text.strip() or not display_to_source:
        return None

    absolute_display_to_source = [segment_start_offset + offset for offset in display_to_source]
    runs: list[list[int]] = []
    run_display_start = 0
    run_source_start = absolute_display_to_source[0]
    for display_index in range(1, len(absolute_display_to_source)):
        if absolute_display_to_source[display_index] == absolute_display_to_source[display_index - 1] + 1:
            continue
        runs.append([run_display_start, run_source_start, display_index - run_display_start])
        run_display_start = display_index
        run_source_start = absolute_display_to_source[display_index]
    runs.append([run_display_start, run_source_start, len(absolute_display_to_source) - run_display_start])
    return {
        "segment_id": segment_id,
        "display_text": display_text,
        "source_start_offset": absolute_display_to_source[0],
        "source_end_offset": absolute_display_to_source[-1] + 1,
        # Piecewise identity runs avoid serializing one Python/JSON integer per
        # displayed character while preserving exact mappings across trims.
        "display_to_source_runs": runs,
    }


def transform_txt_segments(
    segments: list[dict[str, Any]],
    trim_spaces: bool,
    remove_empty_lines: bool,
    split_paragraphs: bool,
) -> dict[str, list[dict[str, Any]]]:
    fragments: list[dict[str, Any]] = []

    for segment in segments:
        normalized_text, normalized_offsets = _normalize_newlines_with_mapping(segment["text"])
        raw_lines = _split_source_lines(normalized_text, normalized_offsets)

        entries: list[dict[str, Any]] = []
        for line_text, line_offsets, newline_offset in raw_lines:
            display_text = line_text
            display_offsets = line_offsets
            if trim_spaces:
                display_text, display_offsets = _trim_spaces(display_text, display_offsets)

            entries.append(
                {
                    "text": display_text,
                    "map": display_offsets,
                    "newline_offset": newline_offset,
                }
            )

        if remove_empty_lines:
            entries = _collapse_empty_lines(entries)

        if not split_paragraphs:
            display_text, display_to_source = _assemble_entries(entries)
            fragment = _build_fragment(
                segment["segment_id"],
                segment["start_offset"],
                display_text,
                display_to_source,
            )
            if fragment is not None:
                fragments.append(fragment)
            continue

        blocks: list[list[dict[str, Any]]] = []
        current_block: list[dict[str, Any]] = []
        for entry in entries:
            if entry["text"] == "":
                if current_block:
                    blocks.append(current_block)
                    current_block = []
                continue
            current_block.append(entry)
        if current_block:
            blocks.append(current_block)

        for block_entries in blocks:
            block_text, block_map = _assemble_entries(block_entries)
            for display_text, display_to_source in _split_dense_block(block_text, block_map):
                fragment = _build_fragment(
                    segment["segment_id"],
                    segment["start_offset"],
                    display_text,
                    display_to_source,
                )
                if fragment is not None:
                    fragments.append(fragment)

    return {"fragments": fragments}
