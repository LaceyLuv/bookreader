import json

import pytest

from services.delete_recovery import begin_delete, mark_delete_phase, recover_pending_deletes


@pytest.mark.parametrize(
    "crash_phase",
    ["intent", "file_staged", "metadata_deleted", "annotations_deleted", "progress_deleted", "trash_deleted"],
)
def test_recovery_finishes_delete_after_each_crash_phase(tmp_path, crash_phase):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    source = books_dir / "book.txt"
    trash = books_dir / ".trash" / ".book.txt.delete-token"
    trash.parent.mkdir()
    source.write_text("content", encoding="utf-8")
    journal = tmp_path / "delete-journal.json"
    record = {"id": "book-1", "stored_filename": source.name}
    library_ids = {"book-1"}
    annotation_ids = {"book-1"}
    progress_ids = {"book-1"}

    begin_delete(record, ".trash/.book.txt.delete-token", journal_path=journal)
    if crash_phase != "intent":
        source.replace(trash)
        mark_delete_phase("book-1", "file_staged", journal_path=journal)
    if crash_phase in {"metadata_deleted", "annotations_deleted", "progress_deleted", "trash_deleted"}:
        library_ids.discard("book-1")
        mark_delete_phase("book-1", "metadata_deleted", journal_path=journal)
    if crash_phase in {"annotations_deleted", "progress_deleted", "trash_deleted"}:
        annotation_ids.discard("book-1")
        mark_delete_phase("book-1", "annotations_deleted", journal_path=journal)
    if crash_phase in {"progress_deleted", "trash_deleted"}:
        progress_ids.discard("book-1")
        mark_delete_phase("book-1", "progress_deleted", journal_path=journal)
    if crash_phase == "trash_deleted":
        trash.unlink()
        mark_delete_phase("book-1", "trash_deleted", journal_path=journal)

    recovered = recover_pending_deletes(
        books_dir=books_dir,
        journal_path=journal,
        delete_record=lambda book_id: library_ids.discard(book_id),
        delete_annotations=lambda book_id: annotation_ids.discard(book_id),
        delete_progress=lambda book_id: progress_ids.discard(book_id),
    )

    assert recovered == ["book-1"]
    assert not source.exists()
    assert not trash.exists()
    assert library_ids == set()
    assert annotation_ids == set()
    assert progress_ids == set()
    assert not journal.exists()


def test_failed_recovery_keeps_journal_for_next_start(tmp_path):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    source = books_dir / "book.txt"
    source.write_text("content", encoding="utf-8")
    journal = tmp_path / "delete-journal.json"
    begin_delete({"id": "book-1", "stored_filename": source.name}, ".book.txt.delete-token", journal_path=journal)

    with pytest.raises(OSError, match="annotation store unavailable"):
        recover_pending_deletes(
            books_dir=books_dir,
            journal_path=journal,
            delete_record=lambda _book_id: None,
            delete_annotations=lambda _book_id: (_ for _ in ()).throw(OSError("annotation store unavailable")),
            delete_progress=lambda _book_id: None,
        )

    payload = json.loads(journal.read_text(encoding="utf-8"))
    assert "book-1" in payload["operations"]
    assert (books_dir / ".book.txt.delete-token").exists()

    recover_pending_deletes(
        books_dir=books_dir,
        journal_path=journal,
        delete_record=lambda _book_id: None,
        delete_annotations=lambda _book_id: None,
        delete_progress=lambda _book_id: None,
    )
    assert not journal.exists()
    assert not (books_dir / ".book.txt.delete-token").exists()


def test_recovery_refuses_ambiguous_source_and_trash(tmp_path):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    source = books_dir / "book.txt"
    trash = books_dir / ".book.txt.delete-token"
    source.write_text("original", encoding="utf-8")
    trash.write_text("staged", encoding="utf-8")
    journal = tmp_path / "delete-journal.json"
    begin_delete({"id": "book-1", "stored_filename": source.name}, trash.name, journal_path=journal)

    with pytest.raises(RuntimeError, match="Both source and staged"):
        recover_pending_deletes(books_dir=books_dir, journal_path=journal)

    assert source.read_text(encoding="utf-8") == "original"
    assert trash.read_text(encoding="utf-8") == "staged"
    assert journal.exists()


def test_progress_failure_keeps_staged_file_and_journal_until_retry(tmp_path):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    source = books_dir / "book.txt"
    source.write_text("content", encoding="utf-8")
    journal = tmp_path / "delete-journal.json"
    begin_delete({"id": "book-1", "stored_filename": source.name}, ".trash/book.trash", journal_path=journal)

    with pytest.raises(OSError, match="progress store unavailable"):
        recover_pending_deletes(
            books_dir=books_dir,
            journal_path=journal,
            delete_record=lambda _book_id: None,
            delete_annotations=lambda _book_id: None,
            delete_progress=lambda _book_id: (_ for _ in ()).throw(OSError("progress store unavailable")),
        )

    assert not source.exists()
    assert (books_dir / ".trash" / "book.trash").exists()
    assert journal.exists()

    recover_pending_deletes(
        books_dir=books_dir,
        journal_path=journal,
        delete_record=lambda _book_id: None,
        delete_annotations=lambda _book_id: None,
        delete_progress=lambda _book_id: None,
    )
    assert not journal.exists()
    assert not (books_dir / ".trash" / "book.trash").exists()


def test_recovery_validates_every_operation_before_mutating(tmp_path):
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    source = books_dir / "book.txt"
    source.write_text("content", encoding="utf-8")
    journal = tmp_path / "delete-journal.json"
    payload = {
        "version": 1,
        "operations": {
            "book-1": {
                "book_id": "book-1",
                "stored_filename": "book.txt",
                "trash_name": ".trash/book.trash",
                "phase": "intent",
            },
            "book-2": {
                "book_id": "book-2",
                "stored_filename": "../outside.txt",
                "trash_name": ".trash/outside.trash",
                "phase": "intent",
            },
        },
    }
    journal.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(RuntimeError, match="Unsafe stored filename"):
        recover_pending_deletes(books_dir=books_dir, journal_path=journal)

    assert source.exists()
    assert not (books_dir / ".trash" / "book.trash").exists()
