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
