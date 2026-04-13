from __future__ import annotations

import re
from typing import Any


SENTENCE_RE = re.compile(r"[^.!?\n]+(?:[.!?]+|$)")


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
    while start < end and line[start] in {" ", "\t"}:
        start += 1
    while end > start and line[end - 1] in {" ", "\t"}:
        end -= 1

    if start >= end:
        return "", []

    display_chars: list[str] = []
    display_offsets: list[int] = []
    previous_was_space = False

    for index in range(start, end):
        char = line[index]
        if char in {" ", "\t"}:
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


def _split_dense_block(display_text: str, display_to_source: list[int]) -> list[tuple[str, list[int]]]:
    if "\n" in display_text or len(display_text) < 80:
        return [(display_text, display_to_source)]

    sentence_spans = [
        (match.start(), match.end())
        for match in SENTENCE_RE.finditer(display_text)
        if match.group(0).strip()
    ]
    if len(sentence_spans) < 4:
        return [(display_text, display_to_source)]

    split_index = len(sentence_spans) // 2
    split_pos = sentence_spans[split_index][0]

    left_text = display_text[:split_pos].rstrip(" \t")
    left_map = display_to_source[:split_pos]
    while left_text and left_map and left_text[-1] in {" ", "\t"}:
        left_text = left_text[:-1]
        left_map.pop()

    right_text = display_text[split_pos:].lstrip(" \t")
    right_map = display_to_source[split_pos:]
    lead_trim = len(display_text[split_pos:]) - len(right_text)
    if lead_trim:
        right_map = right_map[lead_trim:]

    fragments: list[tuple[str, list[int]]] = []
    if left_text.strip():
        fragments.append((left_text, left_map))
    if right_text.strip():
        fragments.append((right_text, right_map))

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
    return {
        "segment_id": segment_id,
        "display_text": display_text,
        "source_start_offset": absolute_display_to_source[0],
        "source_end_offset": absolute_display_to_source[-1] + 1,
        "display_to_source": absolute_display_to_source,
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
