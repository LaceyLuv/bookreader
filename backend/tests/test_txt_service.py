import services.txt_service as txt_service
from services.txt_service import clear_txt_caches, get_txt_cache_stats, read_txt_manifest, read_txt_segment_window


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
