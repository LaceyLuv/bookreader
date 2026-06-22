# Upload Dedup And UI Filename Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent newly uploaded books from creating duplicate library entries and ensure the UI only shows the original filename, never the internal storage filename.

**Architecture:** Tighten backend upload registration so one physical file maps to one logical record for new uploads, then remove any frontend fallback paths that can render `stored_filename` to the user. Keep historical duplicate records out of scope and treat remaining TXT-open failures as a separate follow-up if they persist after this change.

**Tech Stack:** FastAPI, Python, React 19, Vite, pytest, Vitest/RTL

---

## File Structure

### Backend

- Modify: `backend/services/library_store.py`
  - Owns upload record registration and library-store synchronization behavior.
  - Add the new-upload dedup guard without introducing historical cleanup logic.
- Modify: `backend/routers/books.py`
  - Confirm the upload path still returns the canonical uploaded record and does not leak storage-name behavior.
- Create or modify: `backend/tests/test_library_store_upload_dedup.py`
  - Covers storage-level dedup behavior for new uploads.
- Create or modify: `backend/tests/test_books_upload_api.py`
  - Covers upload API contract and canonical filename behavior.

### Frontend

- Modify: `frontend/src/pages/Dashboard.jsx`
  - Remove any visible fallback or temporary state that can surface `stored_filename`.
- Modify: `frontend/src/components/TxtReader.jsx`
  - Only if needed for display-field hygiene or route assumptions. Do not broaden scope into TXT rendering fixes unless required by failing tests.
- Create or modify: `frontend/src/pages/Dashboard.upload.test.jsx`
  - Covers filename rendering after upload and detail-panel behavior.

### Docs

- Reference: `docs/superpowers/specs/2026-04-13-upload-dedup-and-txt-entry-design.md`
  - Source-of-truth design document for this implementation.

## Task 1: Lock Backend Dedup Behavior With Tests

**Files:**
- Modify: `backend/tests/test_library_store_upload_dedup.py`
- Create: `backend/tests/test_books_upload_api.py`
- Reference: `backend/services/library_store.py`
- Reference: `backend/routers/books.py`

- [ ] **Step 1: Add a failing storage-level test for replacing a provisional record**

```python
def test_add_book_record_reuses_existing_stored_filename_record(tmp_path, monkeypatch):
    from services import library_store

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    library_path = tmp_path / "library.json"

    stored_filename = "abcd1234-original.txt"
    (books_dir / stored_filename).write_text("hello", encoding="utf-8")
    library_path.write_text(
        json.dumps(
            {
                "version": library_store.LIBRARY_VERSION,
                "books": [
                    {
                        "id": "provisional-id",
                        "legacy_id": "legacy-provisional",
                        "title": "abcd1234-original",
                        "author": None,
                        "file_type": "txt",
                        "filename": stored_filename,
                        "stored_filename": stored_filename,
                        "size": 5,
                        "upload_date": "2026-04-13T00:00:00",
                        "last_opened_at": None,
                        "last_read_at": None,
                        "reading_status": "unread",
                        "favorite": False,
                        "pinned": False,
                        "tags": [],
                        "collections": [],
                        "library_folder_id": None,
                        "library_folder_name": None,
                        "series_name": None,
                        "series_index": None,
                        "duplicate_group": None,
                        "version_label": None,
                        "duplicate_lead": False,
                        "content_fingerprint": None,
                        "content_fingerprint_size": None,
                        "content_fingerprint_mtime_ns": None,
                    }
                ],
                "folders": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(library_store, "BOOKS_DIR", books_dir)
    monkeypatch.setattr(library_store, "LIBRARY_DATA_PATH", library_path)

    record = library_store.add_book_record(
        book_id="real-upload-id",
        filename="원본 제목.txt",
        stored_filename=stored_filename,
    )

    records = library_store.list_book_records()
    assert record["id"] == "real-upload-id"
    assert len(records) == 1
    assert records[0]["filename"] == "원본 제목.txt"
```

- [ ] **Step 2: Run the storage-level test and verify it fails first**

Run: `pytest backend/tests/test_library_store_upload_dedup.py::test_add_book_record_reuses_existing_stored_filename_record -q`

Expected: FAIL because the current store logic keeps or creates two logical records for the same `stored_filename`.

- [ ] **Step 3: Add a failing upload API test for canonical filename visibility**

```python
def test_upload_book_returns_original_filename_not_storage_filename(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from main import app
    import paths

    books_dir = tmp_path / "books"
    books_dir.mkdir()
    monkeypatch.setattr(paths, "BOOKS_DIR", books_dir)

    client = TestClient(app)
    response = client.post(
        "/api/books",
        files={"file": ("원본 제목.txt", b"hello world", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["filename"] == "원본 제목.txt"
    assert payload["filename"] != payload.get("stored_filename")
```

- [ ] **Step 4: Run the API test and verify the current behavior**

Run: `pytest backend/tests/test_books_upload_api.py::test_upload_book_returns_original_filename_not_storage_filename -q`

Expected: Either FAIL because the setup exposes duplicate-registration behavior, or PASS on filename contract while still leaving dedup coverage to the storage test. Record the actual result in the implementation notes before moving on.

- [ ] **Step 5: Commit the red tests only if both failures are captured cleanly**

```bash
git add backend/tests/test_library_store_upload_dedup.py backend/tests/test_books_upload_api.py
git commit -m "test: capture upload dedup and filename contract"
```

If the worktree is too dirty for an isolated commit, skip the commit and note that constraint in the task log.

## Task 2: Make New Upload Registration Idempotent

**Files:**
- Modify: `backend/services/library_store.py`
- Reference: `backend/routers/books.py`
- Test: `backend/tests/test_library_store_upload_dedup.py`
- Test: `backend/tests/test_books_upload_api.py`

- [ ] **Step 1: Implement the smallest dedup guard in `add_book_record`**

```python
def add_book_record(*, book_id: str, filename: str, stored_filename: str) -> dict[str, Any]:
    with _STORE_LOCK:
        data = _sync_store_unlocked()
        file_path = BOOKS_DIR / _safe_display_name(stored_filename)
        if not file_path.exists():
            raise FileNotFoundError(str(file_path))

        record = _new_record(filename, stored_filename, file_path, book_id=book_id)
        books = data.get('books', [])
        existing_index = next(
            (index for index, item in enumerate(books) if item.get('stored_filename') == record['stored_filename']),
            None,
        )

        if existing_index is None:
            books.append(record)
        else:
            books[existing_index] = record

        data['books'] = books
        _write_store_unlocked(data)
        return dict(record)
```

- [ ] **Step 2: Keep synchronization scoped to new-upload safety only**

```python
def _sync_store_unlocked() -> dict[str, Any]:
    ...
    normalized_books: list[dict[str, Any]] = []
    seen_stored_names: set[str] = set()

    for raw_book in data.get('books', []):
        ...
        normalized_books.append(normalized)
        seen_stored_names.add(stored_name)

    orphan_files = [
        file_path
        for name, file_path in existing_files.items()
        if name not in seen_stored_names
    ]
    ...
```

Constraint:

- Do not add historical cleanup logic that merges or deletes old duplicate records during general sync.
- Limit the fix to the canonical upload-registration path unless the failing tests prove a second narrow guard is required.

- [ ] **Step 3: Verify the storage-level red test now passes**

Run: `pytest backend/tests/test_library_store_upload_dedup.py -q`

Expected: PASS

- [ ] **Step 4: Verify the upload API contract still passes**

Run: `pytest backend/tests/test_books_upload_api.py -q`

Expected: PASS

- [ ] **Step 5: Commit the backend dedup fix**

```bash
git add backend/services/library_store.py backend/tests/test_library_store_upload_dedup.py backend/tests/test_books_upload_api.py
git commit -m "fix: dedupe new upload registration"
```

## Task 3: Remove Internal Storage Name Leakage From The UI

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`
- Test: `frontend/src/pages/Dashboard.upload.test.jsx`
- Reference: `frontend/src/lib/readErrorDetail.js`

- [ ] **Step 1: Add a failing UI test that rejects storage-name display**

```jsx
it('shows the original filename after upload and hides stored_filename', async () => {
  const uploadedBook = {
    id: 'book-1',
    file_type: 'txt',
    title: '',
    filename: '원본 제목.txt',
    stored_filename: 'abcd1234-original.txt',
    upload_date: '2026-04-13T10:00:00',
  }

  global.fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(uploadedBook), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([uploadedBook]), { status: 200 }))

  render(<Dashboard />)
  await userEvent.upload(screen.getByLabelText(/upload/i), new File(['hello'], '원본 제목.txt', { type: 'text/plain' }))

  expect(await screen.findByText('원본 제목.txt')).toBeInTheDocument()
  expect(screen.queryByText('abcd1234-original.txt')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the UI test and verify it fails for the right reason**

Run: `npm test -- Dashboard.upload.test.jsx`

Expected: FAIL because the component still exposes `stored_filename` through fallback state or detail rendering.

- [ ] **Step 3: Remove display fallbacks that can surface `stored_filename`**

```jsx
setSelectedInfo({ ...book, path: '' })

...

<div className="break-all">{selectedInfo.filename}</div>

...

const visibleName = book.title?.trim() || book.filename
```

Constraints:

- Do not render `stored_filename` in cards, detail panels, or temporary state.
- Keep routing and API behavior keyed by `book.id`.
- Do not broaden this task into visual redesign or metadata model changes.

- [ ] **Step 4: Re-run the focused UI test**

Run: `npm test -- Dashboard.upload.test.jsx`

Expected: PASS

- [ ] **Step 5: Re-run the existing dashboard-related suite**

Run: `npm test -- Dashboard`

Expected: PASS with no new filename regressions

- [ ] **Step 6: Commit the UI hygiene fix**

```bash
git add frontend/src/pages/Dashboard.jsx frontend/src/pages/Dashboard.upload.test.jsx
git commit -m "fix: hide internal storage filenames in library ui"
```

## Task 4: Regression Check TXT Entry Path Without Expanding Scope

**Files:**
- Reference: `frontend/src/components/TxtReader.jsx`
- Reference: `frontend/src/hooks/useTxtSegmentWindow.js`
- Test: `frontend/src/components/TxtReader.segmented.test.jsx`

- [ ] **Step 1: Run the existing TXT reader segmented suite unchanged**

Run: `npm test -- TxtReader.segmented.test.jsx`

Expected: PASS

- [ ] **Step 2: Add a single focused regression test only if upload changes expose a route or identity issue**

```jsx
it('opens the uploaded txt entry by id after library refresh', async () => {
  // only add this test if current suite does not already cover the id-based entry path
})
```

Rule:

- Do not invent new TXT rendering fixes here.
- Add coverage only if Task 3 reveals an entry-path regression.

- [ ] **Step 3: Record follow-up instead of patching TXT rendering if failures remain unrelated**

```md
- TXT manifest fetch still passes
- TXT window fetch still passes
- Remaining failure appears in render-page composition / empty-page fallback
```

- [ ] **Step 4: Commit only if a narrow regression test was added**

```bash
git add frontend/src/components/TxtReader.segmented.test.jsx
git commit -m "test: cover txt entry path after upload dedup"
```

If no new test was needed, skip this commit.

## Task 5: Final Verification And Handoff

**Files:**
- Reference: `backend/tests/test_library_store_upload_dedup.py`
- Reference: `backend/tests/test_books_upload_api.py`
- Reference: `frontend/src/pages/Dashboard.upload.test.jsx`
- Reference: `docs/superpowers/specs/2026-04-13-upload-dedup-and-txt-entry-design.md`

- [ ] **Step 1: Run the backend verification batch**

Run: `pytest backend/tests/test_library_store_upload_dedup.py backend/tests/test_books_upload_api.py backend/tests/test_books_txt_manifest_api.py -q`

Expected: all PASS

- [ ] **Step 2: Run the frontend verification batch**

Run: `npm test -- Dashboard.upload.test.jsx TxtReader.segmented.test.jsx`

Expected: PASS

- [ ] **Step 3: Perform manual verification in the app**

```text
1. Upload a Korean-named .txt file.
2. Confirm one new library item appears.
3. Confirm the visible name is the original filename.
4. Confirm no storage-looking filename appears in library or details UI.
5. Open the uploaded TXT file immediately.
6. Refresh the app and confirm the same single entry remains.
```

- [ ] **Step 4: Summarize unresolved TXT behavior explicitly if present**

```text
If TXT open still fails after dedup and UI hygiene pass:
- mark upload dedup as fixed
- mark storage-name leakage as fixed
- open a separate follow-up for TXT reader investigation
```

- [ ] **Step 5: Commit final verification updates if any files changed during manual QA**

```bash
git add <only-files-changed-during-final-verification>
git commit -m "test: finalize upload dedup verification"
```

If no files changed, skip this commit.

## Self-Review

### Spec Coverage

- New uploads appear once: covered by Task 1 and Task 2.
- Original filename only in UI: covered by Task 3.
- No historical cleanup: enforced as a constraint in Task 2.
- TXT failures treated separately if still present: covered by Task 4 and Task 5.

### Placeholder Scan

- No `TODO`, `TBD`, or "implement later" placeholders remain.
- Every coding task includes exact files, commands, and expected outcomes.

### Type And Interface Consistency

- Backend contract uses `filename`, `stored_filename`, and `id` consistently.
- Frontend rendering rules consistently prefer `title` then `filename`.
- No task relies on `stored_filename` as a visible display field.
