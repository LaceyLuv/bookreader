from services.txt_service import read_txt_manifest


def test_read_txt_manifest_builds_stable_segments(tmp_path):
    book_path = tmp_path / "sample.txt"
    book_path.write_text("Alpha line 1\nAlpha line 2\n\nBeta block\nGamma tail", encoding="utf-8")

    manifest = read_txt_manifest(str(book_path))

    assert manifest["segment_count"] == 2
    assert manifest["segments"][0]["segment_id"] == 0
    assert manifest["segments"][0]["text"] == "Alpha line 1\nAlpha line 2"
    assert manifest["segments"][1]["start_offset"] == len("Alpha line 1\nAlpha line 2\n\n")
    assert manifest["total_chars"] == len("Alpha line 1\nAlpha line 2\n\nBeta block\nGamma tail")
