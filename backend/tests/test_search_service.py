from services.search_service import search_txt_file


def test_search_txt_file_returns_segment_locators(tmp_path):
    book_path = tmp_path / "searchable.txt"
    book_path.write_text("alpha one\n\nbeta target here\n\nbeta target again", encoding="utf-8")

    result = search_txt_file(str(book_path), "target")

    assert result["total"] == 2
    assert result["results"][0]["segment_id"] == 1
    assert result["results"][0]["segment_local_start"] == 5
    assert result["results"][0]["locator"] == "segment:1:offset:5"
    assert result["results"][0]["position"] == len("alpha one\n\nbeta ")


def test_search_txt_file_uses_transform_aware_display_fragments(monkeypatch):
    captured = {}

    def _read_manifest(file_path, transform_options=None):
        captured["file_path"] = file_path
        captured["transform_options"] = transform_options
        return {
            "segments": [
                {
                    "segment_id": 3,
                    "text": "alpha    beta",
                    "start_offset": 100,
                    "end_offset": 113,
                },
            ],
            "display_fragments": [
                {
                    "segment_id": 3,
                    "display_text": "alpha beta",
                    "source_start_offset": 100,
                    "source_end_offset": 113,
                    "display_to_source": [100, 101, 102, 103, 104, 108, 109, 110, 111, 112],
                },
            ],
        }

    monkeypatch.setattr("services.search_service.read_txt_manifest", _read_manifest)

    result = search_txt_file(
        "fake-book.txt",
        "beta",
        transform_options={
            "trim_spaces": True,
            "remove_empty_lines": True,
            "split_paragraphs": False,
        },
    )

    assert captured["transform_options"] == {
        "trim_spaces": True,
        "remove_empty_lines": True,
        "split_paragraphs": False,
    }
    assert result["total"] == 1
    assert result["results"][0]["snippet"] == "alpha beta"
    assert result["results"][0]["segment_id"] == 3
    assert result["results"][0]["segment_local_start"] == 9
    assert result["results"][0]["segment_local_end"] == 13
    assert result["results"][0]["locator"] == "segment:3:offset:9"
    assert result["results"][0]["position"] == 109
