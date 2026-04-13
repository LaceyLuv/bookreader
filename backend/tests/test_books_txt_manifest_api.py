from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_txt_manifest_endpoint_returns_summary_fields(monkeypatch):
    from routers import books as books_router

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        books_router,
        "read_txt_manifest",
        lambda file_path, transform_options=None: {
            "encoding": "utf-8",
            "total_chars": 120,
            "segment_count": 8,
            "segments": [
                {"segment_id": 0, "text": "alpha", "start_offset": 0, "end_offset": 5},
            ],
        },
    )

    response = client.get("/api/books/txt-1/txt-manifest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["segment_count"] == 8
    assert "segments" not in payload


def test_txt_manifest_endpoint_accepts_transform_options_and_returns_display_fragments(monkeypatch):
    from routers import books as books_router

    captured_transform_options = {}

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)

    def _read_manifest(file_path, transform_options=None):
        captured_transform_options["value"] = transform_options
        return {
            "encoding": "utf-8",
            "total_chars": 10,
            "segment_count": 1,
            "segments": [],
            "transform_options": {
                "trim_spaces": True,
                "remove_empty_lines": True,
                "split_paragraphs": False,
            },
            "display_fragments": [
                {
                    "segment_id": 0,
                    "display_text": "Alpha beta",
                    "source_start_offset": 0,
                    "source_end_offset": 10,
                    "display_to_source": list(range(10)),
                }
            ],
        }

    monkeypatch.setattr(books_router, "read_txt_manifest", _read_manifest)

    response = client.get(
        "/api/books/txt-1/txt-manifest"
        "?trim_spaces=true&remove_empty_lines=true&split_paragraphs=false"
    )

    assert response.status_code == 200
    payload = response.json()
    assert captured_transform_options["value"] == {
        "trim_spaces": True,
        "remove_empty_lines": True,
        "split_paragraphs": False,
    }
    assert payload["transform_options"] == {
        "trim_spaces": True,
        "remove_empty_lines": True,
        "split_paragraphs": False,
    }
    assert payload["display_fragments"][0]["display_text"] == "Alpha beta"


def test_txt_manifest_endpoint_preserves_whitespace_only_segments_when_transforms_are_off(tmp_path, monkeypatch):
    from routers import books as books_router

    book_path = tmp_path / "raw-whitespace.txt"
    book_path.write_text("Alpha\n\n   \n\nBeta", encoding="utf-8")

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, book_path),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)

    response = client.get(
        "/api/books/txt-1/txt-manifest"
        "?trim_spaces=false&remove_empty_lines=false&split_paragraphs=false"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["segment_count"] == 3
    assert payload["transform_options"] == {
        "trim_spaces": False,
        "remove_empty_lines": False,
        "split_paragraphs": False,
    }
    assert [fragment["display_text"] for fragment in payload["display_fragments"]] == [
        "Alpha",
        "   ",
        "Beta",
    ]


def test_transformed_manifest_and_segment_window_counts_stay_aligned(monkeypatch):
    from routers import books as books_router

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)
    monkeypatch.setattr(books_router, "_schedule_search_prewarm", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        books_router,
        "read_txt_manifest",
        lambda file_path, transform_options=None: {
            "encoding": "utf-8",
            "total_chars": 120,
            "segment_count": 20,
            "segments": [],
            "transform_options": {
                "trim_spaces": True,
                "remove_empty_lines": True,
                "split_paragraphs": True,
            },
            "display_fragments": [
                {
                    "segment_id": index,
                    "display_text": f"display {index}",
                    "source_start_offset": index * 10,
                    "source_end_offset": index * 10 + 9,
                    "display_to_source": list(range(index * 10, index * 10 + 10)),
                }
                for index in range(30)
            ],
        },
    )

    manifest_response = client.get(
        "/api/books/txt-1/txt-manifest"
        "?trim_spaces=true&remove_empty_lines=true&split_paragraphs=true"
    )
    segments_response = client.get(
        "/api/books/txt-1/txt-segments"
        "?start=0&limit=5&trim_spaces=true&remove_empty_lines=true&split_paragraphs=true"
    )

    assert manifest_response.status_code == 200
    assert segments_response.status_code == 200
    manifest_payload = manifest_response.json()
    segments_payload = segments_response.json()
    assert manifest_payload["segment_count"] == 30
    assert manifest_payload["segment_count"] == segments_payload["total"]


def test_txt_segments_endpoint_returns_transform_aware_window(monkeypatch):
    from routers import books as books_router

    captured_transform_options = {}

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )

    def _read_manifest(file_path, transform_options=None):
        captured_transform_options["value"] = transform_options
        return {
            "encoding": "utf-8",
            "total_chars": 120,
            "segment_count": 20,
            "segments": [
                {"segment_id": index, "text": f"segment {index}", "start_offset": index * 10, "end_offset": index * 10 + 9}
                for index in range(20)
            ],
            "display_fragments": [
                {
                    "segment_id": index,
                    "display_text": f"display {index}",
                    "source_start_offset": index * 10,
                    "source_end_offset": index * 10 + 9,
                    "display_to_source": list(range(index * 10, index * 10 + 10)),
                }
                for index in range(30)
            ],
        }

    monkeypatch.setattr(books_router, "read_txt_manifest", _read_manifest)

    response = client.get(
        "/api/books/txt-1/txt-segments"
        "?start=10&limit=4&trim_spaces=true&remove_empty_lines=true&split_paragraphs=false"
    )

    assert response.status_code == 200
    payload = response.json()
    assert captured_transform_options["value"] == {
        "trim_spaces": True,
        "remove_empty_lines": True,
        "split_paragraphs": False,
    }
    assert payload["start"] == 10
    assert payload["limit"] == 4
    assert payload["total"] == 30
    assert len(payload["display_fragments"]) == 4
    assert payload["display_fragments"][0]["segment_id"] == 10
    assert payload["display_fragments"][0]["display_text"] == "display 10"
    assert "segments" not in payload


def test_txt_search_endpoint_threads_transform_options(monkeypatch):
    from routers import books as books_router

    captured = {}

    monkeypatch.setattr(
        books_router,
        "_resolve_book_file",
        lambda book_id: ({"id": book_id, "file_type": "txt"}, "fake-path"),
    )
    monkeypatch.setattr(books_router, "_touch_book_open", lambda record: record)

    def _search_txt_file(file_path, query, limit=100, transform_options=None):
        captured["file_path"] = file_path
        captured["query"] = query
        captured["limit"] = limit
        captured["transform_options"] = transform_options
        return {
            "query": query,
            "total": 1,
            "results": [
                {
                    "index": 0,
                    "snippet": "alpha beta",
                    "position": 108,
                    "locator": "segment:3:offset:8",
                    "segment_id": 3,
                    "segment_local_start": 8,
                    "segment_local_end": 12,
                }
            ],
        }

    monkeypatch.setattr(books_router, "search_txt_file", _search_txt_file)

    response = client.get(
        "/api/books/txt-1/search"
        "?q=beta&trim_spaces=true&remove_empty_lines=true&split_paragraphs=false"
    )

    assert response.status_code == 200
    assert captured["query"] == "beta"
    assert captured["transform_options"] == {
        "trim_spaces": True,
        "remove_empty_lines": True,
        "split_paragraphs": False,
    }
    payload = response.json()
    assert payload["results"][0]["locator"] == "segment:3:offset:8"
