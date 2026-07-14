from __future__ import annotations

import json
import os
import zipfile
from pathlib import Path

import pytest

from services import backup_service


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _paths(tmp_path: Path) -> backup_service.BackupPaths:
    books = tmp_path / "books"
    fonts = tmp_path / "fonts"
    books.mkdir()
    fonts.mkdir()
    library = tmp_path / "library.json"
    annotations = tmp_path / "annotations.json"
    progress = tmp_path / "reading-progress.json"
    (books / "book-1.txt").write_text("hello book", encoding="utf-8")
    (fonts / "abc123456789-test.woff2").write_bytes(b"wOF2font")
    _write_json(
        library,
        {
            "version": 4,
            "folders": [{"id": "folder-1", "name": "Shelf"}],
            "books": [
                {
                    "id": "book-1",
                    "legacy_id": "legacy-1",
                    "filename": "book.txt",
                    "stored_filename": "book-1.txt",
                    "file_type": "txt",
                    "title": "Original title",
                    "content_fingerprint": "same-fingerprint",
                }
            ],
        },
    )
    _write_json(
        annotations,
        {
            "version": 1,
            "annotations": [
                {
                    "id": "note-1",
                    "book_id": "book-1",
                    "selected_text": "hello",
                    "locator_v2": {"version": 2, "kind": "txt", "offset": 0},
                }
            ],
        },
    )
    _write_json(
        progress,
        {
            "version": 1,
            "progress": {
                "book-1": {"position": 1, "totalPages": 3, "type": "txt", "updatedAt": "2026-01-01T00:00:00Z"}
            },
        },
    )
    return backup_service.BackupPaths(
        data_dir=tmp_path,
        books_dir=books,
        fonts_dir=fonts,
        library_path=library,
        annotations_path=annotations,
        progress_path=progress,
        delete_journal_path=tmp_path / "delete-journal.json",
        restore_journal_path=tmp_path / "restore-journal.json",
        backups_dir=tmp_path / "backups",
        sessions_dir=tmp_path / ".restore-sessions",
    )


def test_data_backup_has_verified_manifest_and_merges_newer_local_progress(tmp_path):
    paths = _paths(tmp_path)
    bundle, manifest = backup_service.create_backup_bundle(
        paths=paths,
        client_state={
            "settings": {"theme": "sepia"},
            "folder_colors": {"folder-1": "#abcdef"},
            "progress": {
                "legacy-1": {
                    "position": 2,
                    "totalPages": 3,
                    "type": "txt",
                    "updatedAt": "2026-02-01T00:00:00Z",
                }
            },
            "__BOOKREADER_SAFE_MODE__": True,
        },
    )
    try:
        validated = backup_service.inspect_backup_bundle(bundle)
        assert manifest["kind"] == "data"
        assert validated.progress["progress"]["book-1"]["position"] == 2
        assert validated.client_state == {
            "settings": {"theme": "sepia"},
            "folder_colors": {"folder-1": "#abcdef"},
        }
        with zipfile.ZipFile(bundle) as archive:
            names = set(archive.namelist())
        assert "manifest.json" in names
        assert "fonts/abc123456789-test.woff2" in names
        assert not any(name.startswith("books/") for name in names)
        assert not any(".bak" in name or ".trash" in name for name in names)
    finally:
        bundle.unlink(missing_ok=True)


def test_full_restore_round_trip_and_creates_pre_restore_snapshot(tmp_path):
    paths = _paths(tmp_path)
    bundle, _ = backup_service.create_backup_bundle(
        paths=paths,
        include_books=True,
        client_state={"settings": {"theme": "dark"}},
    )
    restore_id, preview = backup_service.create_restore_session(bundle, paths=paths)
    assert preview.manifest["kind"] == "full"

    library = json.loads(paths.library_path.read_text(encoding="utf-8"))
    library["books"][0]["title"] = "Changed title"
    _write_json(paths.library_path, library)
    paths.progress_path.write_text('{"version":1,"progress":{}}', encoding="utf-8")
    paths.books_dir.joinpath("book-1.txt").write_text("changed bytes", encoding="utf-8")
    paths.fonts_dir.joinpath("abc123456789-test.woff2").write_bytes(b"wOF2changed")

    result = backup_service.apply_restore_session(
        restore_id,
        paths=paths,
        current_client_state={"settings": {"theme": "light"}},
    )

    assert json.loads(paths.library_path.read_text(encoding="utf-8"))["books"][0]["title"] == "Original title"
    assert json.loads(paths.progress_path.read_text(encoding="utf-8"))["progress"]["book-1"]["position"] == 1
    assert paths.books_dir.joinpath("book-1.txt").read_text(encoding="utf-8") == "hello book"
    assert paths.fonts_dir.joinpath("abc123456789-test.woff2").read_bytes() == b"wOF2font"
    assert result["client_state"]["settings"]["theme"] == "dark"
    assert (paths.backups_dir / result["snapshot_filename"]).is_file()
    assert not paths.restore_journal_path.exists()


def test_data_restore_preserves_unrelated_current_books(tmp_path):
    paths = _paths(tmp_path)
    bundle, _ = backup_service.create_backup_bundle(paths=paths)
    restore_id, _ = backup_service.create_restore_session(bundle, paths=paths)
    library = json.loads(paths.library_path.read_text(encoding="utf-8"))
    library["books"][0]["title"] = "Changed title"
    library["books"].append(
        {
            "id": "book-2",
            "filename": "other.txt",
            "stored_filename": "book-2.txt",
            "file_type": "txt",
            "title": "Keep this",
            "content_fingerprint": "other",
        }
    )
    paths.books_dir.joinpath("book-2.txt").write_text("other", encoding="utf-8")
    _write_json(paths.library_path, library)

    backup_service.apply_restore_session(restore_id, paths=paths)

    restored = json.loads(paths.library_path.read_text(encoding="utf-8"))
    assert [(item["id"], item["title"]) for item in restored["books"]] == [
        ("book-1", "Original title"),
        ("book-2", "Keep this"),
    ]
    assert paths.books_dir.joinpath("book-2.txt").read_text(encoding="utf-8") == "other"


def test_restore_failure_rolls_back_every_live_target(tmp_path, monkeypatch):
    paths = _paths(tmp_path)
    bundle, _ = backup_service.create_backup_bundle(paths=paths, include_books=True)
    restore_id, _ = backup_service.create_restore_session(bundle, paths=paths)
    old_library = paths.library_path.read_bytes()
    old_annotations = paths.annotations_path.read_bytes()
    real_replace = os.replace

    def fail_annotations(source, destination):
        if Path(source).parent.name == "stage" and Path(destination) == paths.annotations_path:
            raise OSError("injected restore failure")
        return real_replace(source, destination)

    monkeypatch.setattr(backup_service.os, "replace", fail_annotations)

    with pytest.raises(OSError, match="injected"):
        backup_service.apply_restore_session(restore_id, paths=paths)

    assert paths.library_path.read_bytes() == old_library
    assert paths.annotations_path.read_bytes() == old_annotations
    assert paths.books_dir.joinpath("book-1.txt").read_text(encoding="utf-8") == "hello book"
    assert not paths.restore_journal_path.exists()


def test_checksum_tampering_is_rejected(tmp_path):
    paths = _paths(tmp_path)
    bundle, _ = backup_service.create_backup_bundle(paths=paths)
    tampered = tmp_path / "tampered.bookreader-backup"
    with zipfile.ZipFile(bundle) as source, zipfile.ZipFile(tampered, "w", compression=zipfile.ZIP_STORED) as target:
        for info in source.infolist():
            payload = source.read(info)
            if info.filename == "stores/annotations.json":
                payload += b" "
            target.writestr(info.filename, payload)

    with pytest.raises(backup_service.BackupValidationError, match="size mismatch|checksum mismatch"):
        backup_service.inspect_backup_bundle(tampered)


def test_unsafe_archive_member_is_rejected_before_restore(tmp_path):
    archive = tmp_path / "unsafe.bookreader-backup"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("../outside", b"bad")
        target.writestr("manifest.json", b"{}")

    with pytest.raises(backup_service.BackupValidationError, match="Unsafe archive path"):
        backup_service.inspect_backup_bundle(archive)
