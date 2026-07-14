import pytest

import services.txt_service as txt_service
from services.txt_service import clear_txt_caches, get_txt_cache_stats, read_txt_file, read_txt_manifest, read_txt_segment_window


def _force_streaming(monkeypatch, tmp_path, *, read_chars=7, checkpoint_chars=11):
    monkeypatch.setattr(txt_service, "_TXT_STREAMING_THRESHOLD_BYTES", 1)
    monkeypatch.setattr(txt_service, "_TXT_STREAM_READ_CHARS", read_chars)
    monkeypatch.setattr(txt_service, "_TXT_CHECKPOINT_INTERVAL_CHARS", checkpoint_chars)
    monkeypatch.setattr(txt_service, "_TXT_INDEX_DIR", tmp_path / "txt-index")
    clear_txt_caches()


def test_read_txt_manifest_builds_stable_segments(tmp_path):
    book_path = tmp_path / "sample.txt"
    book_path.write_text("Alpha line 1\nAlpha line 2\n\nBeta block\nGamma tail", encoding="utf-8")

    manifest = read_txt_manifest(str(book_path))

    assert manifest["segment_count"] == 2
    assert manifest["segments"][0]["segment_id"] == 0
    assert manifest["segments"][0]["text"] == "Alpha line 1\nAlpha line 2"
    assert manifest["segments"][1]["start_offset"] == len("Alpha line 1\nAlpha line 2\n\n")
    assert manifest["total_chars"] == len("Alpha line 1\nAlpha line 2\n\nBeta block\nGamma tail")


def test_read_txt_manifest_can_return_lean_metadata_without_segment_payload(tmp_path):
    book_path = tmp_path / "large.txt"
    book_path.write_text("\n\n".join(f"Paragraph {index}" for index in range(200)), encoding="utf-8")

    manifest = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)

    assert manifest["encoding"]
    assert manifest["segment_count"] == 200
    assert manifest["total_chars"] == book_path.read_text(encoding="utf-8").replace("\r\n", "\n").__len__()
    assert "text" not in manifest
    assert "segments" not in manifest
    assert manifest["display_fragments"] == []


def test_read_txt_segment_window_clamps_to_valid_range_near_segment_boundary(tmp_path):
    book_path = tmp_path / "boundary.txt"
    book_path.write_text("Alpha\n\nBeta\n\nGamma", encoding="utf-8")

    window = read_txt_segment_window(str(book_path), start=2, limit=5)

    assert window["start"] == 2
    assert window["limit"] == 5
    assert window["total"] == 3
    assert [fragment["display_text"] for fragment in window["display_fragments"]] == ["Gamma"]
    assert window["display_fragments"][0]["source_start_offset"] == len("Alpha\n\nBeta\n\n")


def test_txt_window_v2_bounds_dense_paragraph_and_preserves_offsets(tmp_path):
    book_path = tmp_path / "dense-long.txt"
    original = "가나다라마바사" * 100
    book_path.write_text(original, encoding="utf-8")

    cursor = None
    chunks = []
    source_ranges = []
    while True:
        window = read_txt_segment_window(str(book_path), cursor=cursor, max_chars=73)
        assert window["contract_version"] == 2
        assert window["returned_chars"] <= 73
        chunks.extend(fragment["display_text"] for fragment in window["display_fragments"])
        source_ranges.extend(
            (fragment["source_start_offset"], fragment["source_end_offset"])
            for fragment in window["display_fragments"]
        )
        if not window["has_more"]:
            break
        assert window["next_cursor"] != cursor
        cursor = window["next_cursor"]

    assert "".join(chunks) == original
    assert source_ranges[0][0] == 0
    assert source_ranges[-1][1] == len(original)
    assert all(left[1] == right[0] for left, right in zip(source_ranges, source_ranges[1:]))


def test_transformed_window_reuses_prefix_index_instead_of_rescanning_all_segments(tmp_path, monkeypatch):
    clear_txt_caches()
    book_path = tmp_path / "transformed.txt"
    book_path.write_text("\n\n".join(f"Paragraph {index}. Next." for index in range(50)), encoding="utf-8")
    original_transform = txt_service.transform_txt_segments
    calls = []

    def tracked_transform(segments, **kwargs):
        calls.append(segments[0]["segment_id"])
        return original_transform(segments, **kwargs)

    monkeypatch.setattr(txt_service, "transform_txt_segments", tracked_transform)
    options = {"trim_spaces": True, "remove_empty_lines": False, "split_paragraphs": False}
    manifest = read_txt_manifest(str(book_path), transform_options=options, include_fragments=False, include_segments=False)
    assert manifest["segment_count"] == 50
    assert len(calls) == 50

    calls.clear()
    window = read_txt_segment_window(str(book_path), start=25, limit=2, transform_options=options)
    assert len(window["display_fragments"]) == 2
    assert calls == [25, 26]


def test_txt_cache_reports_bounded_source_and_transform_index_weights(tmp_path):
    clear_txt_caches()
    book_path = tmp_path / "cached.txt"
    book_path.write_text("Alpha\n\nBeta", encoding="utf-8")
    read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)

    stats = get_txt_cache_stats()
    assert stats["source"]["entries"] == 1
    assert stats["source"]["weight"] <= stats["source"]["max_weight"]
    assert stats["transform_index"]["weight"] <= stats["transform_index"]["max_weight"]


def test_read_txt_manifest_handles_no_blank_lines_as_one_segment(tmp_path):
    book_path = tmp_path / "dense.txt"
    book_path.write_text("첫 줄\nsecond line\nthird line without blank separators", encoding="utf-8")

    manifest = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)
    window = read_txt_segment_window(str(book_path), start=0, limit=10)

    assert manifest["segment_count"] == 1
    assert window["display_fragments"][0]["display_text"] == "첫 줄\nsecond line\nthird line without blank separators"


@pytest.mark.parametrize(
    ("encoding", "text"),
    [
        ("utf-8", "😀 alpha\r\n둘째 줄\r\n\r\n끝"),
        ("utf-16", "첫 문장\r\nsecond 😀\r\n\r\n마지막"),
        ("cp949", "첫 문장\r\n둘째 문장\r\n\r\n마지막"),
    ],
)
def test_streaming_index_preserves_decoding_and_codepoint_offsets(tmp_path, monkeypatch, encoding, text):
    _force_streaming(monkeypatch, tmp_path, read_chars=5, checkpoint_chars=9)
    book_path = tmp_path / f"stream-{encoding}.txt"
    book_path.write_bytes(text.encode(encoding))
    expected = text.replace("\r\n", "\n")

    manifest = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)
    payload = read_txt_file(str(book_path))
    source, _ = txt_service._source_for_path(str(book_path))

    assert source.streaming is True
    assert source.text is None
    assert source.segment_ranges == ()
    assert source.checkpoints == ()
    assert source.index_path is not None
    assert manifest["total_chars"] == len(expected)
    assert payload["text"] == expected

    expected_ranges = txt_service._build_segment_ranges(expected)
    actual_ranges = [txt_service._segment_range(source, index) for index in range(manifest["segment_count"])]
    assert actual_ranges == list(expected_ranges)


def test_streaming_window_reads_only_requested_slice_of_one_large_logical_segment(tmp_path, monkeypatch):
    _force_streaming(monkeypatch, tmp_path, read_chars=13, checkpoint_chars=29)
    book_path = tmp_path / "dense-stream.txt"
    original = "가😀나다라마바사" * 80
    book_path.write_text(original, encoding="utf-8")

    manifest = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)
    original_read_range = txt_service._read_streaming_range
    requested_ranges = []

    def tracked_read_range(source, start, end):
        requested_ranges.append((start, end))
        return original_read_range(source, start, end)

    monkeypatch.setattr(txt_service, "_read_streaming_range", tracked_read_range)
    cursor = None
    chunks = []
    source_ranges = []
    display_starts = []
    while True:
        window = read_txt_segment_window(str(book_path), start=0, limit=1, cursor=cursor, max_chars=31)
        chunks.extend(fragment["display_text"] for fragment in window["display_fragments"])
        source_ranges.extend(
            (fragment["source_start_offset"], fragment["source_end_offset"])
            for fragment in window["display_fragments"]
        )
        display_starts.extend(fragment["display_start_offset"] for fragment in window["display_fragments"])
        assert all(fragment["segment_id"] == 0 for fragment in window["display_fragments"])
        if not window["has_more"]:
            break
        assert window["next_cursor"] != cursor
        cursor = window["next_cursor"]

    assert manifest["segment_count"] == 1
    assert "".join(chunks) == original
    assert source_ranges[0][0] == 0
    assert source_ranges[-1][1] == len(original)
    assert all(left[1] == right[0] for left, right in zip(source_ranges, source_ranges[1:]))
    assert display_starts == sorted(display_starts)
    assert requested_ranges
    assert max(end - start for start, end in requested_ranges) <= 31


def test_streaming_manifest_reuses_completed_sparse_index_after_cache_clear(tmp_path, monkeypatch):
    _force_streaming(monkeypatch, tmp_path)
    book_path = tmp_path / "persistent-index.txt"
    book_path.write_text("Alpha\n\nBeta\n\nGamma", encoding="utf-8")

    first = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)
    source, _ = txt_service._source_for_path(str(book_path))
    index_path = txt_service.Path(source.index_path)
    first_mtime = index_path.stat().st_mtime_ns
    clear_txt_caches()

    def fail_if_source_is_rescanned(*args, **kwargs):
        raise AssertionError("completed TXT index should be reused")

    monkeypatch.setattr(txt_service.io, "TextIOWrapper", fail_if_source_is_rescanned)
    second = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)

    assert second == first
    assert index_path.stat().st_mtime_ns == first_mtime


@pytest.mark.parametrize(
    ("raw", "expected_encoding", "expected_text"),
    [
        ("한글 😀".encode("utf-8"), "utf-8", "한글 😀"),
        (b"\xef\xbb\xbf" + "한글".encode("utf-8"), "utf-8-sig", "한글"),
        ("한글 똠방각하".encode("cp949"), "cp949", "한글 똠방각하"),
        ("한글 테스트".encode("euc-kr"), "euc-kr", "한글 테스트"),
        ("한글 test".encode("utf-16-le"), "utf-16-le", "한글 test"),
        ("한글 test".encode("utf-16-be"), "utf-16-be", "한글 test"),
    ],
)
def test_auto_encoding_prefers_safe_unicode_and_korean_candidates(tmp_path, raw, expected_encoding, expected_text):
    clear_txt_caches()
    book_path = tmp_path / "encoding.txt"
    book_path.write_bytes(raw)

    preview = txt_service.read_txt_encoding_preview(str(book_path))
    payload = read_txt_file(str(book_path))

    assert preview["encoding"] == expected_encoding
    assert payload == {"text": expected_text, "encoding": expected_encoding}
    assert len(preview["encoding_candidates"]) <= len(txt_service.TXT_ENCODING_OPTIONS)
    assert all(len(candidate["preview"]) <= 600 for candidate in preview["encoding_candidates"])


def test_auto_encoding_checks_beyond_ascii_prefix(tmp_path, monkeypatch):
    _force_streaming(monkeypatch, tmp_path, read_chars=4096, checkpoint_chars=8192)
    book_path = tmp_path / "ascii-prefix-cp949.txt"
    expected = "A" * (64 * 1024 + 17) + "한글 똠방각하"
    book_path.write_bytes(("A" * (64 * 1024 + 17)).encode("ascii") + "한글 똠방각하".encode("cp949"))

    preview = txt_service.read_txt_encoding_preview(str(book_path))
    payload = read_txt_file(str(book_path))

    assert preview["encoding"] == "cp949"
    assert payload["text"] == expected
    assert "�" not in payload["text"]


def test_encoding_override_isolates_index_cache_and_source_revision(tmp_path, monkeypatch):
    _force_streaming(monkeypatch, tmp_path, read_chars=128, checkpoint_chars=256)
    book_path = tmp_path / "override.txt"
    book_path.write_bytes("한글 똠방각하".encode("cp949"))

    automatic = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)
    automatic_source, _ = txt_service._source_for_path(str(book_path))
    latin = read_txt_manifest(
        str(book_path), include_fragments=False, include_segments=False, encoding_override="latin-1"
    )
    latin_source, _ = txt_service._source_for_path(str(book_path), "latin-1")
    automatic_again = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)

    assert automatic["encoding"] == "cp949"
    assert latin["encoding"] == "latin-1"
    assert automatic["source_revision"] != latin["source_revision"]
    assert automatic_source.index_path != latin_source.index_path
    assert automatic_again["source_revision"] == automatic["source_revision"]


@pytest.mark.parametrize(
    ("encoding", "bom"),
    [("utf-16-le", b"\xff\xfe"), ("utf-16-be", b"\xfe\xff")],
)
def test_streaming_explicit_utf16_endianness_does_not_expose_bom(tmp_path, monkeypatch, encoding, bom):
    _force_streaming(monkeypatch, tmp_path, read_chars=5, checkpoint_chars=9)
    book_path = tmp_path / f"bom-{encoding}.txt"
    expected = "한글\n본문"
    book_path.write_bytes(bom + expected.encode(encoding))

    payload = read_txt_file(str(book_path), encoding_override=encoding)
    manifest = read_txt_manifest(
        str(book_path), include_fragments=False, include_segments=False, encoding_override=encoding
    )

    assert payload["text"] == expected
    assert not payload["text"].startswith("\ufeff")
    assert manifest["total_chars"] == len(expected)


def test_hard_segments_bound_no_line_transform_reads_and_match_small_streaming_ranges(tmp_path, monkeypatch):
    book_path = tmp_path / "huge-single-line.txt"
    original = "\uac00" * (txt_service.TXT_HARD_SEGMENT_CHARS * 2 + 37)
    book_path.write_text(original, encoding="utf-8")
    monkeypatch.setattr(txt_service, "_TXT_STREAMING_THRESHOLD_BYTES", book_path.stat().st_size + 1)
    clear_txt_caches()
    small_source, _ = txt_service._source_for_path(str(book_path))
    small_ranges = list(small_source.segment_ranges)

    _force_streaming(monkeypatch, tmp_path, read_chars=64 * 1024, checkpoint_chars=128 * 1024)
    streaming_source, _ = txt_service._source_for_path(str(book_path))
    streaming_ranges = [
        txt_service._segment_range(streaming_source, index)
        for index in range(txt_service._segment_count(streaming_source))
    ]
    original_read_range = txt_service._read_streaming_range
    requested_ranges = []

    def tracked_read_range(source, start, end):
        requested_ranges.append((start, end))
        return original_read_range(source, start, end)

    monkeypatch.setattr(txt_service, "_read_streaming_range", tracked_read_range)
    manifest = read_txt_manifest(
        str(book_path),
        transform_options={"trim_spaces": True},
        include_fragments=False,
        include_segments=False,
    )

    assert streaming_ranges == small_ranges
    assert len(streaming_ranges) == 3
    assert all(0 < end - start <= txt_service.TXT_HARD_SEGMENT_CHARS for start, end in streaming_ranges)
    assert all(left[1] == right[0] for left, right in zip(streaming_ranges, streaming_ranges[1:]))
    assert manifest["segment_count"] == 3
    assert requested_ranges
    assert max(end - start for start, end in requested_ranges) <= txt_service.TXT_HARD_SEGMENT_CHARS
