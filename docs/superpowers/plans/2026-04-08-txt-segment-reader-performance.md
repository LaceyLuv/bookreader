# TXT Segment Reader Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild TXT reading around segment-based data and rendering so search-result clicks jump immediately without rescanning or rerendering the full TXT document.

**Architecture:** Replace the current full-text TXT pipeline with a segment-manifest pipeline. The backend will normalize TXT into stable segments plus a compact offset index; the frontend will render only a moving window of segments and navigate search results by `segment_id` and local offsets instead of walking the entire DOM. Global offsets remain supported for compatibility during migration, but active reading/search/highlight flows will use segment locators first.

**Tech Stack:** FastAPI, Pydantic, Python text-processing utilities, React 19, React Router 7, browser DOM APIs, Vitest, Testing Library, jsdom

---

## File Structure

- Modify: `backend/models.py`
  - Add TXT segment models, manifest response types, and segment-based search metadata.
- Modify: `backend/routers/books.py`
  - Add TXT manifest and segment-window endpoints, keep compatibility for existing routes during rollout.
- Modify: `backend/services/txt_service.py`
  - Build and cache normalized TXT segment manifests instead of only decoded full text.
- Modify: `backend/services/search_service.py`
  - Search against the TXT segment manifest and return segment-aware result payloads.
- Create: `backend/tests/test_txt_service.py`
  - Lock down segmentation, offset mapping, and cache invalidation.
- Create: `backend/tests/test_search_service.py`
  - Lock down segment-based TXT search results and compatibility offsets.
- Modify: `frontend/src/components/TxtReader.jsx`
  - Replace full-text rendering with segment-window rendering and segment-based search navigation.
- Create: `frontend/src/hooks/useTxtSegmentWindow.js`
  - Own visible segment range calculation, prefetch, and anchor restoration for TXT only.
- Create: `frontend/src/lib/txtSegmentDom.js`
  - Map segment/local offsets to DOM ranges and highlight targets without full-document rescans.
- Modify: `frontend/src/lib/searchHighlighter.js`
  - Add a segment-scoped highlighting path while preserving EPUB behavior.
- Modify: `frontend/src/lib/annotationSelection.js`
  - Emit segment-based selection metadata for TXT annotations.
- Modify: `frontend/src/lib/annotationHighlighter.js`
  - Highlight TXT annotations by segment/local offsets instead of full-document absolute offsets.
- Create: `frontend/src/components/TxtReader.segmented.test.jsx`
  - Verify segment-window rendering, search-result jumps, and visible-window stability.
- Modify: `frontend/src/components/TxtReader.anchor.test.jsx`
  - Reuse anchor coverage with segmented TXT rendering.
- Modify: `docs/qa-validation.md`
  - Add manual validation for large TXT search, jump latency, and annotation compatibility.

---

### Task 1: Establish TXT segmentation rules and backend fixtures

**Files:**
- Create: `backend/tests/test_txt_service.py`
- Create: `backend/tests/test_search_service.py`
- Modify: `backend/services/txt_service.py`
- Modify: `backend/services/search_service.py`

- [ ] **Step 1: Write failing backend tests for segment manifest generation**

```python
# backend/tests/test_txt_service.py
from services.txt_service import read_txt_manifest


def test_read_txt_manifest_builds_stable_segments(tmp_path):
    book_path = tmp_path / "sample.txt"
    book_path.write_text("Alpha line 1\nAlpha line 2\n\nBeta block\nGamma tail", encoding="utf-8")

    manifest = read_txt_manifest(str(book_path))

    assert manifest["segment_count"] == 3
    assert manifest["segments"][0]["segment_id"] == 0
    assert manifest["segments"][0]["text"] == "Alpha line 1\nAlpha line 2"
    assert manifest["segments"][1]["start_offset"] == len("Alpha line 1\nAlpha line 2\n\n")
    assert manifest["total_chars"] == len("Alpha line 1\nAlpha line 2\n\nBeta block\nGamma tail")
```

```python
# backend/tests/test_search_service.py
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
```

- [ ] **Step 2: Run backend tests to verify the new cases fail first**

Run: `python -m pytest backend/tests/test_txt_service.py backend/tests/test_search_service.py -v`
Expected: FAIL with import errors or missing manifest fields because the TXT pipeline is still full-text only.

- [ ] **Step 3: Implement a cached TXT manifest builder with stable offsets**

```python
# backend/services/txt_service.py
from functools import lru_cache
from pathlib import Path


def _split_txt_segments(text: str) -> list[dict]:
    segments = []
    cursor = 0
    segment_id = 0
    for raw_block in text.replace("\r\n", "\n").split("\n\n"):
        block = raw_block.strip("\n")
        if not block:
            cursor += len(raw_block) + 2
            continue
        start_offset = text.find(raw_block, cursor)
        end_offset = start_offset + len(raw_block)
        segments.append({
            "segment_id": segment_id,
            "text": raw_block,
            "start_offset": start_offset,
            "end_offset": end_offset,
        })
        cursor = end_offset + 2
        segment_id += 1
    return segments


@lru_cache(maxsize=24)
def _read_txt_manifest_cached(file_path: str, size: int, mtime_ns: int) -> dict:
    payload = read_txt_file(file_path)
    text = payload["text"]
    segments = _split_txt_segments(text)
    return {
        "encoding": payload["encoding"],
        "total_chars": len(text),
        "segment_count": len(segments),
        "segments": segments,
    }


def read_txt_manifest(file_path: str) -> dict:
    stat = Path(file_path).stat()
    return _read_txt_manifest_cached(str(Path(file_path).resolve()), stat.st_size, stat.st_mtime_ns)
```

- [ ] **Step 4: Update TXT search to use manifest segments instead of whole-document scans**

```python
# backend/services/search_service.py
def search_txt_file(file_path: str, query: str, limit: int = RESULT_LIMIT) -> dict:
    trimmed_query = (query or "").strip()
    if not trimmed_query:
        return {"query": "", "total": 0, "results": []}

    manifest = read_txt_manifest(file_path)
    lower_query = trimmed_query.lower()
    results = []
    total = 0

    for segment in manifest["segments"]:
        lower_text = segment["text"].lower()
        for start, end in _iter_match_spans(lower_text, lower_query):
            total += 1
            if len(results) < limit:
                results.append({
                    "index": total - 1,
                    "snippet": _build_snippet(segment["text"], start, end),
                    "position": segment["start_offset"] + start,
                    "locator": f"segment:{segment['segment_id']}:offset:{start}",
                    "segment_id": segment["segment_id"],
                    "segment_local_start": start,
                    "segment_local_end": end,
                })

    return {"query": trimmed_query, "total": total, "results": results}
```

- [ ] **Step 5: Run backend tests to verify segmentation and search now pass**

Run: `python -m pytest backend/tests/test_txt_service.py backend/tests/test_search_service.py -v`
Expected: PASS

- [ ] **Step 6: Commit the backend segmentation baseline**

```bash
git add backend/services/txt_service.py backend/services/search_service.py backend/tests/test_txt_service.py backend/tests/test_search_service.py
git commit -m "feat: add segmented txt manifest and search baseline"
```

---

### Task 2: Add explicit TXT manifest APIs and keep route compatibility

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/routers/books.py`
- Create: `backend/tests/test_books_txt_manifest_api.py`

- [ ] **Step 1: Write failing API tests for manifest and segment-window endpoints**

```python
# backend/tests/test_books_txt_manifest_api.py
from fastapi.testclient import TestClient
from main import app


client = TestClient(app)


def test_txt_manifest_endpoint_returns_summary_fields(txt_book_id):
    response = client.get(f"/api/books/{txt_book_id}/txt-manifest")

    assert response.status_code == 200
    payload = response.json()
    assert "segment_count" in payload
    assert "segments" not in payload


def test_txt_segments_endpoint_returns_requested_window(txt_book_id):
    response = client.get(f"/api/books/{txt_book_id}/txt-segments?start=10&limit=4")

    assert response.status_code == 200
    payload = response.json()
    assert payload["start"] == 10
    assert len(payload["segments"]) <= 4
```

- [ ] **Step 2: Run the API tests and confirm the endpoints do not exist yet**

Run: `python -m pytest backend/tests/test_books_txt_manifest_api.py -v`
Expected: FAIL with `404` or missing response model errors because `/txt-manifest` and `/txt-segments` are not implemented.

- [ ] **Step 3: Extend backend models with segment-aware TXT response types**

```python
# backend/models.py
class TxtSegment(BaseModel):
    segment_id: int
    text: str
    start_offset: int
    end_offset: int


class TxtManifest(BaseModel):
    encoding: str
    total_chars: int
    segment_count: int


class TxtSegmentWindow(BaseModel):
    start: int
    limit: int
    total: int
    segments: List[TxtSegment] = Field(default_factory=list)
```

- [ ] **Step 4: Add TXT manifest and segment-window routes while preserving `/content` during rollout**

```python
# backend/routers/books.py
@router.get('/{book_id}/txt-manifest', response_model=TxtManifest)
async def get_txt_manifest(book_id: str, background_tasks: BackgroundTasks):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')
    _touch_book_open(record)
    _schedule_search_prewarm(background_tasks, path, record['file_type'])
    manifest = read_txt_manifest(str(path))
    return TxtManifest(
        encoding=manifest['encoding'],
        total_chars=manifest['total_chars'],
        segment_count=manifest['segment_count'],
    )


@router.get('/{book_id}/txt-segments', response_model=TxtSegmentWindow)
async def get_txt_segments(book_id: str, start: int = 0, limit: int = 40):
    record, path = _resolve_book_file(book_id)
    if record['file_type'] != 'txt':
        raise HTTPException(status_code=400, detail='Not a TXT file')
    manifest = read_txt_manifest(str(path))
    safe_start = max(0, start)
    safe_limit = max(1, min(limit, 120))
    window = manifest['segments'][safe_start:safe_start + safe_limit]
    return TxtSegmentWindow(start=safe_start, limit=safe_limit, total=manifest['segment_count'], segments=window)
```

- [ ] **Step 5: Re-run the API tests to verify the contract**

Run: `python -m pytest backend/tests/test_books_txt_manifest_api.py -v`
Expected: PASS

- [ ] **Step 6: Commit the TXT API contract**

```bash
git add backend/models.py backend/routers/books.py backend/tests/test_books_txt_manifest_api.py
git commit -m "feat: expose segmented txt manifest endpoints"
```

---

### Task 3: Build a frontend TXT segment window and virtual rendering path

**Files:**
- Create: `frontend/src/hooks/useTxtSegmentWindow.js`
- Create: `frontend/src/components/TxtReader.segmented.test.jsx`
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/components/TxtReader.anchor.test.jsx`

- [ ] **Step 1: Write failing frontend tests for windowed TXT rendering**

```jsx
// frontend/src/components/TxtReader.segmented.test.jsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TxtReader from './TxtReader'

test('TXT reader renders only the requested segment window on first load', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/txt-manifest')) {
      return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 120000, segment_count: 500 }), { status: 200 })
    }
    if (String(url).includes('/txt-segments?start=0&limit=40')) {
      return new Response(JSON.stringify({
        start: 0,
        limit: 40,
        total: 500,
        segments: [{ segment_id: 0, text: 'alpha block', start_offset: 0, end_offset: 11 }],
      }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }))

  render(
    <MemoryRouter initialEntries={['/read/txt-1']}>
      <Routes>
        <Route path="/read/:id" element={<TxtReader />} />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText('alpha block')).toBeInTheDocument())
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/txt-manifest'))
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=0&limit=40'))
})
```

- [ ] **Step 2: Run the frontend test and confirm the current TXT reader still expects `/content`**

Run: `cmd /c npm test -- frontend/src/components/TxtReader.segmented.test.jsx`
Expected: FAIL because `TxtReader` still fetches `/{id}/content` and renders one full string.

- [ ] **Step 3: Create a TXT segment-window hook for manifest load, window fetch, and prefetch**

```js
// frontend/src/hooks/useTxtSegmentWindow.js
import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BOOKS_BASE } from '../lib/apiBase'

const WINDOW_SIZE = 40

export function useTxtSegmentWindow(bookId) {
  const [manifest, setManifest] = useState(null)
  const [windows, setWindows] = useState({})
  const [visibleStart, setVisibleStart] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-manifest`)
      const data = await res.json()
      if (!cancelled) setManifest(data)
    })()
    return () => {
      cancelled = true
    }
  }, [bookId])

  const loadWindow = useCallback(async (start) => {
    const safeStart = Math.max(0, start)
    if (windows[safeStart]) return
    const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-segments?start=${safeStart}&limit=${WINDOW_SIZE}`)
    const data = await res.json()
    setWindows((prev) => ({ ...prev, [safeStart]: data.segments }))
  }, [bookId, windows])

  const visibleSegments = useMemo(() => windows[visibleStart] || [], [windows, visibleStart])

  return { manifest, visibleStart, setVisibleStart, visibleSegments, loadWindow, windowSize: WINDOW_SIZE }
}
```

- [ ] **Step 4: Refactor TXT reader to render a segment list instead of a monolithic text node**

```jsx
// frontend/src/components/TxtReader.jsx
const { manifest, visibleStart, setVisibleStart, visibleSegments, loadWindow, windowSize } = useTxtSegmentWindow(id)

useEffect(() => {
  loadWindow(0)
}, [loadWindow])

<div ref={contentRef} data-testid="txt-segment-content">
  {visibleSegments.map((segment) => (
    <p
      key={segment.segment_id}
      data-segment-id={segment.segment_id}
      data-segment-start={segment.start_offset}
      data-segment-end={segment.end_offset}
      className="txt-segment"
    >
      {segment.text}
    </p>
  ))}
</div>
```

- [ ] **Step 5: Re-run the segmented TXT test and anchor coverage**

Run: `cmd /c npm test -- frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit the frontend segment-window baseline**

```bash
git add frontend/src/hooks/useTxtSegmentWindow.js frontend/src/components/TxtReader.jsx frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx
git commit -m "feat: render txt reader from segment windows"
```

---

### Task 4: Make search-result clicks jump by segment locator with no full-document scan

**Files:**
- Modify: `frontend/src/lib/searchHighlighter.js`
- Create: `frontend/src/lib/txtSegmentDom.js`
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`

- [ ] **Step 1: Add a failing search-jump regression test**

```jsx
test('search-result click loads the target segment window and scrolls directly to the match', async () => {
  const searchResult = {
    index: 0,
    locator: 'segment:120:offset:8',
    segment_id: 120,
    segment_local_start: 8,
    segment_local_end: 14,
    snippet: '... target ...',
  }

  render(<TxtReaderSearchHarness result={searchResult} />)
  await userEvent.click(screen.getByRole('button', { name: /target/i }))

  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=100&limit=40'))
  })
  expect(screen.getByTestId('active-search-mark')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the targeted test and verify there is still no segment-aware jump path**

Run: `cmd /c npm test -- frontend/src/components/TxtReader.segmented.test.jsx`
Expected: FAIL because search clicks still only set `activeSearchIndex` and depend on DOM-wide text walking.

- [ ] **Step 3: Add TXT segment DOM helpers that resolve one match inside one segment**

```js
// frontend/src/lib/txtSegmentDom.js
export function findSegmentElement(root, segmentId) {
  return root?.querySelector(`[data-segment-id="${segmentId}"]`) || null
}

export function highlightSegmentMatch(segmentEl, start, end) {
  if (!segmentEl) return null
  const text = segmentEl.textContent || ''
  const before = text.slice(0, start)
  const match = text.slice(start, end)
  const after = text.slice(end)
  segmentEl.innerHTML = ''
  if (before) segmentEl.appendChild(document.createTextNode(before))
  const mark = document.createElement('mark')
  mark.dataset.bookreaderSearch = 'true'
  mark.dataset.activeSearchMark = 'true'
  mark.textContent = match
  segmentEl.appendChild(mark)
  if (after) segmentEl.appendChild(document.createTextNode(after))
  return mark
}
```

- [ ] **Step 4: Update TXT reader search clicks to load the owning segment window before highlighting**

```jsx
// frontend/src/components/TxtReader.jsx
const handleSearchResultClick = useCallback(async (result) => {
  setAnnotationsOpen(false)
  setActiveAnnotationId(null)

  const targetWindowStart = Math.max(0, result.segment_id - Math.floor(windowSize / 2))
  await loadWindow(targetWindowStart)
  setVisibleStart(targetWindowStart)
  setPendingSearchTarget({
    segmentId: result.segment_id,
    start: result.segment_local_start,
    end: result.segment_local_end,
  })
}, [loadWindow, setVisibleStart, windowSize])

useEffect(() => {
  if (!pendingSearchTarget || !contentRef.current) return
  const segmentEl = findSegmentElement(contentRef.current, pendingSearchTarget.segmentId)
  if (!segmentEl) return
  const mark = highlightSegmentMatch(segmentEl, pendingSearchTarget.start, pendingSearchTarget.end)
  mark?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}, [pendingSearchTarget, visibleSegments])
```

- [ ] **Step 5: Re-run the search-jump regression and related TXT tests**

Run: `cmd /c npm test -- frontend/src/components/TxtReader.segmented.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit direct segment-jump search behavior**

```bash
git add frontend/src/lib/txtSegmentDom.js frontend/src/lib/searchHighlighter.js frontend/src/components/TxtReader.jsx frontend/src/components/TxtReader.segmented.test.jsx
git commit -m "feat: jump txt search results by segment locator"
```

---

### Task 5: Migrate TXT annotations and selection to segment-local locators

**Files:**
- Modify: `frontend/src/lib/annotationSelection.js`
- Modify: `frontend/src/lib/annotationHighlighter.js`
- Modify: `frontend/src/components/TxtReader.jsx`
- Create: `frontend/src/lib/annotationSelection.test.jsx`
- Modify: `backend/models.py`

- [ ] **Step 1: Write failing tests for segment-aware TXT selections**

```jsx
// frontend/src/lib/annotationSelection.test.jsx
import { getSelectionSnapshot } from './annotationSelection'

test('selection snapshot in TXT reader returns segment-local offsets', () => {
  document.body.innerHTML = '<p data-segment-id="7">alpha target omega</p>'
  const root = document.body
  const textNode = root.querySelector('p').firstChild
  const range = document.createRange()
  range.setStart(textNode, 6)
  range.setEnd(textNode, 12)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)

  const snapshot = getSelectionSnapshot(root)

  expect(snapshot.segmentId).toBe(7)
  expect(snapshot.startOffset).toBe(6)
  expect(snapshot.endOffset).toBe(12)
})
```

- [ ] **Step 2: Run the selection test and confirm the current helper still reports whole-document offsets**

Run: `cmd /c npm test -- frontend/src/lib/annotationSelection.test.jsx`
Expected: FAIL because `getSelectionSnapshot()` only emits document-global offsets today.

- [ ] **Step 3: Extend TXT selection payloads to carry both compatibility and segment-local offsets**

```js
// frontend/src/lib/annotationSelection.js
export function getSelectionSnapshot(root) {
  // existing guards
  const segmentEl = commonAncestor?.closest?.('[data-segment-id]')
  const segmentId = segmentEl ? Number(segmentEl.dataset.segmentId) : null
  const segmentRange = range.cloneRange()
  if (segmentEl) {
    segmentRange.selectNodeContents(segmentEl)
    segmentRange.setEnd(range.startContainer, range.startOffset)
  }

  return {
    selectedText,
    startOffset,
    endOffset,
    segmentId,
    segmentLocalStart: segmentId != null ? segmentRange.toString().length : null,
    segmentLocalEnd: segmentId != null ? segmentRange.toString().length + range.toString().length : null,
    snippet,
    rect,
  }
}
```

- [ ] **Step 4: Update TXT annotation creation and highlighting to prefer segment-local locators**

```jsx
// frontend/src/components/TxtReader.jsx
body: JSON.stringify({
  kind,
  locator: selectionSnapshot.segmentId != null
    ? `segment:${selectionSnapshot.segmentId}:offset:${selectionSnapshot.segmentLocalStart}`
    : `offset:${selectionSnapshot.startOffset}`,
  start_offset: selectionSnapshot.startOffset,
  end_offset: selectionSnapshot.endOffset,
  segment_id: selectionSnapshot.segmentId,
  segment_local_start: selectionSnapshot.segmentLocalStart,
  segment_local_end: selectionSnapshot.segmentLocalEnd,
  selected_text: selectionSnapshot.selectedText,
  snippet: selectionSnapshot.snippet,
})
```

```js
// frontend/src/lib/annotationHighlighter.js
export function highlightAnnotationsInElement(root, annotations) {
  const txtSegmentAnnotations = annotations.filter((item) => Number.isFinite(item.segment_id))
  if (txtSegmentAnnotations.length > 0) {
    for (const annotation of txtSegmentAnnotations) {
      const segmentEl = root.querySelector(`[data-segment-id="${annotation.segment_id}"]`)
      if (!segmentEl) continue
      wrapSegmentSlice(segmentEl, annotation.segment_local_start, annotation.segment_local_end, annotation)
    }
    return getAnnotationNodes(root)
  }

  // existing fallback path for EPUB/global offsets
}
```

- [ ] **Step 5: Run TXT annotation tests and the existing reader regression suite**

Run: `cmd /c npm test -- frontend/src/lib/annotationSelection.test.jsx frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit the segment-based TXT annotation path**

```bash
git add frontend/src/lib/annotationSelection.js frontend/src/lib/annotationHighlighter.js frontend/src/components/TxtReader.jsx frontend/src/lib/annotationSelection.test.jsx backend/models.py
git commit -m "feat: store txt annotations with segment locators"
```

---

### Task 6: Verify large-TXT behavior and retire the old full-text TXT rendering path

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `backend/routers/books.py`
- Modify: `docs/qa-validation.md`

- [ ] **Step 1: Add a final regression test that forbids the old `/content` path for TXT**

```jsx
test('TXT reader does not request legacy full-content endpoint during segmented load', async () => {
  const fetchSpy = vi.fn(async (url) => new Response(JSON.stringify({}), { status: 200 }))
  vi.stubGlobal('fetch', fetchSpy)

  render(<TxtReaderBootHarness />)

  await waitFor(() => {
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/content'))
  })
})
```

- [ ] **Step 2: Run the test and confirm the TXT reader is still carrying fallback code if present**

Run: `cmd /c npm test -- frontend/src/components/TxtReader.segmented.test.jsx`
Expected: FAIL if the reader still fetches `/content` or keeps mixed render modes.

- [ ] **Step 3: Remove the old TXT full-text boot path once segmented flow is green**

```jsx
// frontend/src/components/TxtReader.jsx
// remove:
// const [fullText, setFullText] = useState('')
// fetch(`${API}/${id}/content`)
// displayedText full-string memo for TXT body rendering

// keep:
const [encoding, setEncoding] = useState('')
const { manifest, visibleSegments } = useTxtSegmentWindow(id)
```

```python
# backend/routers/books.py
# keep /content available only for explicit compatibility consumers, but
# stop using it from the React TXT reader path and mark it for deprecation in comments.
```

- [ ] **Step 4: Add explicit manual QA for large TXT search-jump latency**

```md
## Large TXT segmented-reader checklist

- Open a TXT file larger than 5 MB and confirm the first visible text appears without locking the UI.
- Search for a word with 50+ hits and click a result near the end of the list; expected result is a direct jump with no whole-page freeze.
- Add a highlight on a searched segment, reload the page, and confirm the annotation still lands on the same text.
- Toggle `trimSpaces` and `splitParagraphs` after several search jumps; expected result is no full-document stutter and the visible anchor remains stable.
```

- [ ] **Step 5: Run the full frontend verification and production build**

Run: `cmd /c npm test`
Expected: PASS

Run: `cmd /c npm run build`
Expected: PASS

- [ ] **Step 6: Commit rollout cleanup and QA updates**

```bash
git add frontend/src/components/TxtReader.jsx backend/routers/books.py docs/qa-validation.md frontend/src/components/TxtReader.segmented.test.jsx
git commit -m "refactor: retire full-text txt reader boot path"
```

---

## Self-Review

- Spec coverage:
  - Segment-based TXT rendering is covered by Tasks 1 through 3.
  - Search-result click speedup through direct segment jumps is covered by Task 4.
  - TXT annotation/search compatibility under the new locator model is covered by Task 5.
  - Final removal of the old full-text TXT reader path and manual QA is covered by Task 6.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” placeholders remain in the task steps.
- Type consistency:
  - Backend uses `segment_id`, `segment_local_start`, and `segment_local_end`.
  - Frontend uses the same property names in tests, selection payloads, and search result handling.
