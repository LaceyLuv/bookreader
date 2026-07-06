from services.txt_service import read_txt_manifest, read_txt_segment_window


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


def test_read_txt_manifest_handles_no_blank_lines_as_one_segment(tmp_path):
    book_path = tmp_path / "dense.txt"
    book_path.write_text("첫 줄\nsecond line\nthird line without blank separators", encoding="utf-8")

    manifest = read_txt_manifest(str(book_path), include_fragments=False, include_segments=False)
    window = read_txt_segment_window(str(book_path), start=0, limit=10)

    assert manifest["segment_count"] == 1
    assert window["display_fragments"][0]["display_text"] == "첫 줄\nsecond line\nthird line without blank separators"
