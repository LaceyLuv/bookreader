from threading import Event

from services.search_service import search_txt_file
from services.txt_service import TXT_WINDOW_MAX_CHARS


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

    def _read_window(file_path, start=0, limit=40, transform_options=None, cursor=None, max_chars=None):
        captured["file_path"] = file_path
        captured["transform_options"] = transform_options
        return {
            "total": 1,
            "next_cursor": None,
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

    monkeypatch.setattr("services.search_service.read_txt_segment_window", _read_window)

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


def test_search_compacted_unicode_whitespace_returns_original_source_locator(tmp_path):
    book_path = tmp_path / "unicode-whitespace.txt"
    book_path.write_text("머리말\n\nalpha\u00a0\u00a0beta\u200b  gamma", encoding="utf-8")

    result = search_txt_file(
        str(book_path),
        "beta gamma",
        transform_options={
            "trim_spaces": True,
            "remove_empty_lines": True,
            "split_paragraphs": False,
        },
    )

    assert result["total"] == 1
    match = result["results"][0]
    assert match["segment_id"] == 1
    assert match["segment_local_start"] == 7
    assert match["segment_local_end"] == 19
    assert match["locator"] == "segment:1:offset:7"
    assert match["position"] == len("머리말\n\n") + 7


def test_search_stops_before_reading_when_cancelled(monkeypatch):
    cancelled = Event()
    cancelled.set()
    monkeypatch.setattr(
        "services.search_service.read_txt_segment_window",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("cancelled search read data")),
    )

    result = search_txt_file("unused.txt", "target", cancel_event=cancelled)

    assert result["complete"] is False
    assert result["partial_reason"] == "cancelled"
    assert result["results"] == []


def test_search_timeout_returns_a_usable_partial_response(monkeypatch):
    monkeypatch.setattr(
        "services.search_service.read_txt_segment_window",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("timed out search read data")),
    )

    result = search_txt_file("unused.txt", "target", timeout_seconds=0)

    assert result["complete"] is False
    assert result["partial_reason"] == "timeout"
    assert result["total"] == 0


def test_search_stops_at_result_cap_instead_of_scanning_to_exact_total(tmp_path):
    book_path = tmp_path / "many-results.txt"
    book_path.write_text("\n\n".join(["target"] * 40), encoding="utf-8")

    result = search_txt_file(str(book_path), "target", limit=10)

    assert result["total"] == 11
    assert len(result["results"]) == 10
    assert result["complete"] is False
    assert result["results_truncated"] is True


def test_search_finds_a_match_once_across_a_giant_segment_window_boundary(tmp_path):
    book_path = tmp_path / "boundary.txt"
    expected_position = TXT_WINDOW_MAX_CHARS - 3
    book_path.write_text("a" * expected_position + "TARGET" + "z" * 20, encoding="utf-8")

    result = search_txt_file(str(book_path), "target")

    assert result["total"] == 1
    assert result["results"][0]["position"] == expected_position


def test_case_insensitive_search_keeps_source_offsets_when_lowercase_length_changes(tmp_path):
    book_path = tmp_path / "unicode-case.txt"
    book_path.write_bytes(b"\xef\xbb\xbf" + "prefix İ target".encode("utf-8"))

    result = search_txt_file(str(book_path), "TARGET")

    assert result["results"][0]["position"] == len("prefix İ ")
