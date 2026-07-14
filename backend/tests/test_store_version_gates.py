from __future__ import annotations

import json

import pytest

from services import annotation_store, backup_service, library_store, reading_progress_store


def _write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


@pytest.mark.parametrize("version", [2, 3, 4])
def test_historical_library_versions_remain_explicitly_readable(version, tmp_path):
    payload = {"version": version, "books": [], "folders": []}

    validated = library_store._validate_store_data(payload, tmp_path / "library.json")

    assert validated["version"] == version
    assert validated["books"] == []


def test_future_library_version_never_falls_back_to_an_older_backup(monkeypatch, tmp_path):
    primary = tmp_path / "library.json"
    future = {"version": library_store.LIBRARY_VERSION + 1, "books": [], "folders": [], "future": "keep"}
    _write(primary, future)
    _write(primary.with_name("library.json.bak"), {"version": 4, "books": [], "folders": []})
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", primary)
    monkeypatch.setattr(library_store, "BOOKS_DIR", tmp_path / "books")

    with pytest.raises(library_store.UnsupportedStoreVersionError, match="newer than supported"):
        library_store.ensure_library_store()

    assert json.loads(primary.read_text(encoding="utf-8")) == future


def test_future_annotation_version_never_rewrites_or_recovers(monkeypatch, tmp_path):
    primary = tmp_path / "annotations.json"
    future = {"version": annotation_store.ANNOTATIONS_VERSION + 1, "annotations": [], "future": "keep"}
    _write(primary, future)
    _write(primary.with_name("annotations.json.bak"), {"version": 1, "annotations": []})
    monkeypatch.setattr(annotation_store, "ANNOTATIONS_DATA_PATH", primary)

    with pytest.raises(annotation_store.UnsupportedStoreVersionError, match="newer than supported"):
        annotation_store.list_book_annotations("book-1")

    assert json.loads(primary.read_text(encoding="utf-8")) == future


def test_future_progress_version_never_rewrites_or_recovers(monkeypatch, tmp_path):
    primary = tmp_path / "reading-progress.json"
    future = {"version": reading_progress_store.STORE_VERSION + 1, "progress": {}, "future": "keep"}
    _write(primary, future)
    _write(primary.with_name("reading-progress.json.bak"), {"version": 1, "progress": {}})
    monkeypatch.setattr(reading_progress_store, "READING_PROGRESS_DATA_PATH", primary)

    with pytest.raises(reading_progress_store.UnsupportedStoreVersionError, match="newer than supported"):
        reading_progress_store.get_reading_progress("book-1")

    assert json.loads(primary.read_text(encoding="utf-8")) == future


@pytest.mark.parametrize(
    ("validator", "payload"),
    [
        (backup_service._validate_library, {"version": library_store.LIBRARY_VERSION + 1, "books": [], "folders": []}),
        (backup_service._validate_annotations, {"version": annotation_store.ANNOTATIONS_VERSION + 1, "annotations": []}),
        (backup_service._validate_progress, {"version": reading_progress_store.STORE_VERSION + 1, "progress": {}}),
    ],
)
def test_backup_and_restore_validation_rejects_future_store_versions(validator, payload):
    with pytest.raises(backup_service.BackupValidationError, match="newer than supported"):
        validator(payload)


@pytest.mark.parametrize("display_name", ["한글 책.txt", "emoji-📚.epub", f"{'가' * 300}.zip"])
def test_managed_storage_names_stay_short_ascii_and_preserve_the_format(display_name):
    stored = library_store.build_storage_name("0123456789abcdef", display_name)

    assert stored == f"0123456789abcdef{display_name[display_name.rfind('.'):].lower()}"
    assert stored.isascii()
    assert len(stored) < 80
