# TXT Reader Stability Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TXT reader optimization safe by locking the known segment, pagination, position, and navigation regressions behind tests before applying small recomputation reductions.

**Architecture:** Keep the current measured-pagination TXT reader architecture. Add focused helper seams for segment response normalization, viewport metric validation, anchor-preserving page-map hydration, and latest-request-wins navigation so the large `TxtReader.jsx` component changes as little as possible.

**Tech Stack:** React 19, Vite 6, Vitest, Testing Library, FastAPI-backed TXT segment APIs.

---

## File Structure

- Modify: `frontend/src/hooks/useTxtSegmentWindow.js`
  - Responsibility: load TXT manifest/window data and normalize `/txt-segments` responses into stable `segments` and `displayFragments`.
- Create: `frontend/src/hooks/useTxtSegmentWindow.test.jsx`
  - Responsibility: hook-level tests for `display_fragments` priority, `segments` fallback, and stale window request handling.
- Modify: `frontend/src/lib/txtPageMetrics.js`
  - Responsibility: compute viewport-derived pagination capacity and reject implausible authoritative metrics.
- Modify: `frontend/src/lib/txtPageMetrics.test.js`
  - Responsibility: tests for realistic metrics and invalid metric rejection.
- Create: `frontend/src/lib/txtNavigationState.js`
  - Responsibility: pure helpers for latest-request-wins navigation and anchor-to-page reconciliation.
- Create: `frontend/src/lib/txtNavigationState.test.js`
  - Responsibility: pure tests for stale request rejection and anchor-preserving page-map hydration.
- Modify: `frontend/src/components/TxtReader.jsx`
  - Responsibility: use the new helpers while preserving existing TXT reader behavior.
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`
  - Responsibility: minimal integration regression tests for content rendering and distant navigation alignment only where pure tests are insufficient.

## Task 1: Segment Response Normalization Contract

**Files:**
- Modify: `frontend/src/hooks/useTxtSegmentWindow.js`
- Create: `frontend/src/hooks/useTxtSegmentWindow.test.jsx`

- [ ] **Step 1: Export a pure normalization helper**

In `frontend/src/hooks/useTxtSegmentWindow.js`, replace the private `normalizeTxtDisplayFragments` helper with this exported helper near the top of the file:

```js
export function normalizeTxtSegmentWindowResponse(data, transformOptions = {}) {
    const segments = normalizeTxtCompatibilitySegments(data, transformOptions)
    const displayFragments = Array.isArray(data?.display_fragments) && data.display_fragments.length > 0
        ? data.display_fragments
        : segments

    return {
        segments,
        displayFragments,
        hasDisplayFragments: displayFragments.length > 0,
        usedDisplayFragments: Array.isArray(data?.display_fragments) && data.display_fragments.length > 0,
    }
}
```

- [ ] **Step 2: Use the helper in `loadWindow`**

In the `loadWindow` callback, replace:

```js
const windowData = {
    segments: normalizeTxtCompatibilitySegments(data, transformOptions),
    displayFragments: normalizeTxtDisplayFragments(data, transformOptions),
}
```

with:

```js
const windowData = normalizeTxtSegmentWindowResponse(data, transformOptions)
```

- [ ] **Step 3: Write failing tests for display fragment priority and fallback**

Create `frontend/src/hooks/useTxtSegmentWindow.test.jsx`:

```jsx
import { describe, expect, test } from 'vitest'

import { normalizeTxtSegmentWindowResponse } from './useTxtSegmentWindow'

describe('normalizeTxtSegmentWindowResponse', () => {
    test('uses display_fragments when transform options are disabled', () => {
        const result = normalizeTxtSegmentWindowResponse({
            segments: [
                { segment_id: 0, text: 'raw backend segment', start_offset: 0, end_offset: 19 },
            ],
            display_fragments: [
                {
                    segment_id: 0,
                    display_text: 'renderable display fragment',
                    source_start_offset: 0,
                    source_end_offset: 27,
                },
            ],
        }, {
            trimSpaces: false,
            removeEmptyLines: false,
            splitParagraphs: false,
        })

        expect(result.usedDisplayFragments).toBe(true)
        expect(result.displayFragments).toHaveLength(1)
        expect(result.displayFragments[0].display_text).toBe('renderable display fragment')
    })

    test('falls back to compatibility segments only when display_fragments is absent', () => {
        const result = normalizeTxtSegmentWindowResponse({
            segments: [
                { segment_id: 2, text: 'fallback text', start_offset: 10, end_offset: 23 },
            ],
        })

        expect(result.usedDisplayFragments).toBe(false)
        expect(result.displayFragments).toHaveLength(1)
        expect(result.displayFragments[0].display_text ?? result.displayFragments[0].text).toBe('fallback text')
    })
})
```

- [ ] **Step 4: Run the targeted test**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/hooks/useTxtSegmentWindow.test.jsx
```

Expected: both tests pass after the implementation. If they fail before Step 1/2, the failure should identify `normalizeTxtSegmentWindowResponse` as missing or returning the wrong render source.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add frontend/src/hooks/useTxtSegmentWindow.js frontend/src/hooks/useTxtSegmentWindow.test.jsx
git commit -m "test: lock txt segment display normalization"
```

## Task 2: Viewport Metric Guardrails

**Files:**
- Modify: `frontend/src/lib/txtPageMetrics.js`
- Modify: `frontend/src/lib/txtPageMetrics.test.js`

- [ ] **Step 1: Add metric stability helper**

In `frontend/src/lib/txtPageMetrics.js`, after `getTxtViewportMetrics`, add:

```js
export function isStableTxtViewportMetrics(metrics) {
  if (!metrics) return false
  const charsPerLine = Number(metrics.charsPerLine)
  const linesPerPage = Number(metrics.linesPerPage)
  if (!Number.isFinite(charsPerLine) || !Number.isFinite(linesPerPage)) return false
  return charsPerLine >= MIN_CHARS_PER_LINE && linesPerPage > MIN_LINES_PER_PAGE
}
```

- [ ] **Step 2: Refuse unstable authoritative pagination options**

In `createTxtMeasuredPaginationOptions`, replace:

```js
if (!metrics) return null
```

with:

```js
if (!isStableTxtViewportMetrics(metrics)) return null
```

- [ ] **Step 3: Add tests for unstable metrics**

Append these tests to `frontend/src/lib/txtPageMetrics.test.js`:

```js
test('createTxtMeasuredPaginationOptions rejects missing or one-line viewport metrics', () => {
  expect(createTxtMeasuredPaginationOptions(null)).toBeNull()
  expect(createTxtMeasuredPaginationOptions({ charsPerLine: 80, linesPerPage: 1 })).toBeNull()
  expect(createTxtMeasuredPaginationOptions({ charsPerLine: 80, linesPerPage: 3 })).toBeNull()
})

test('createTxtMeasuredPaginationOptions accepts realistic viewport metrics', () => {
  const options = createTxtMeasuredPaginationOptions({ charsPerLine: 60, linesPerPage: 18 })

  expect(options).not.toBeNull()
  expect(options.pageHeight).toBe(18)
  expect(options.measureSliceHeight({ display_text: 'short line' })).toBe(1)
})
```

- [ ] **Step 4: Run the targeted metric tests**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/lib/txtPageMetrics.test.js
```

Expected: all `txtPageMetrics` tests pass. The new rejection test must fail if `createTxtMeasuredPaginationOptions` still accepts one-line or three-line metrics as authoritative.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add frontend/src/lib/txtPageMetrics.js frontend/src/lib/txtPageMetrics.test.js
git commit -m "test: guard txt viewport pagination metrics"
```

## Task 3: Anchor-Preserving Page Map Hydration Helpers

**Files:**
- Create: `frontend/src/lib/txtNavigationState.js`
- Create: `frontend/src/lib/txtNavigationState.test.js`
- Modify: `frontend/src/components/TxtReader.jsx`

- [ ] **Step 1: Create pure navigation state helpers**

Create `frontend/src/lib/txtNavigationState.js`:

```js
import { clampViewportPage } from './txtPagination'
import { findRenderPageForLocator, getRenderPageStartSegment } from './txtRenderPages'

export function createTxtNavigationRequestTracker(initialRequestId = 0) {
  let currentRequestId = Number.isFinite(initialRequestId) ? initialRequestId : 0

  return {
    next() {
      currentRequestId += 1
      return currentRequestId
    },
    isLatest(requestId) {
      return currentRequestId === requestId
    },
    cancelPending() {
      currentRequestId += 1
      return currentRequestId
    },
    get current() {
      return currentRequestId
    },
  }
}

export function resolvePageForAnchor(renderPages, anchor, fallbackPage = 0) {
  const pages = Array.isArray(renderPages) ? renderPages : []
  if (pages.length === 0) return 0

  if (anchor != null) {
    const resolvedPage = findRenderPageForLocator(pages, anchor)
    if (Number.isFinite(resolvedPage)) {
      return clampViewportPage(resolvedPage, pages.length)
    }
  }

  return clampViewportPage(fallbackPage, pages.length)
}

export function reconcileHydratedTxtPageState({
  renderPages,
  currentAnchor,
  fallbackPage = 0,
  fallbackStartSegment = 0,
}) {
  const page = resolvePageForAnchor(renderPages, currentAnchor, fallbackPage)
  const startSegment = getRenderPageStartSegment(renderPages, { page }, fallbackStartSegment)

  return {
    page,
    startSegment,
  }
}
```

- [ ] **Step 2: Add pure tests for hydration behavior**

Create `frontend/src/lib/txtNavigationState.test.js`:

```js
import { describe, expect, test } from 'vitest'

import {
  createTxtNavigationRequestTracker,
  reconcileHydratedTxtPageState,
  resolvePageForAnchor,
} from './txtNavigationState'

const pages = [
  {
    page: 0,
    startLocator: 'segment:0:offset:0',
    segments: [{ segmentId: 0, startOffset: 0, endOffset: 100 }],
  },
  {
    page: 1,
    startLocator: 'segment:1:offset:100',
    segments: [{ segmentId: 1, startOffset: 100, endOffset: 200 }],
  },
  {
    page: 2,
    startLocator: 'segment:2:offset:200',
    segments: [{ segmentId: 2, startOffset: 200, endOffset: 300 }],
  },
]

describe('createTxtNavigationRequestTracker', () => {
  test('marks older navigation requests as stale after a newer request starts', () => {
    const tracker = createTxtNavigationRequestTracker()
    const first = tracker.next()
    const second = tracker.next()

    expect(tracker.isLatest(first)).toBe(false)
    expect(tracker.isLatest(second)).toBe(true)
  })
})

describe('resolvePageForAnchor', () => {
  test('keeps the anchored page when a hydrated page map becomes available', () => {
    expect(resolvePageForAnchor(pages, 'segment:2:offset:220', 0)).toBe(2)
  })

  test('uses fallback page only when no anchor is available', () => {
    expect(resolvePageForAnchor(pages, null, 1)).toBe(1)
  })
})

describe('reconcileHydratedTxtPageState', () => {
  test('returns the page and start segment for the current anchor', () => {
    expect(reconcileHydratedTxtPageState({
      renderPages: pages,
      currentAnchor: 'segment:1:offset:150',
      fallbackPage: 0,
      fallbackStartSegment: 0,
    })).toEqual({
      page: 1,
      startSegment: 'segment:1:offset:100',
    })
  })
})
```

- [ ] **Step 3: Use reconciliation in `TxtReader.jsx` page-map hydration effect**

In `frontend/src/components/TxtReader.jsx`, add this import:

```js
import { reconcileHydratedTxtPageState } from '../lib/txtNavigationState'
```

Find the effect that currently updates `currentViewportPage` when `hasGlobalRenderPageMap` is true. Replace the body that directly computes `anchoredViewportPage` and calls `setCurrentViewportPage` with:

```js
const reconciledState = reconcileHydratedTxtPageState({
    renderPages: globalRenderPages,
    currentAnchor: currentViewportStartSegment,
    fallbackPage: currentViewportPage,
    fallbackStartSegment: currentViewportStartSegment ?? 0,
})

if (reconciledState.page !== currentViewportPage) {
    setCurrentViewportPage(reconciledState.page)
}

if (reconciledState.startSegment !== currentViewportStartSegment) {
    setCurrentViewportStartSegment(reconciledState.startSegment)
}
```

Keep the existing early returns in that effect so it still exits when loading, errored, or no global page map exists.

- [ ] **Step 4: Run helper tests**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/lib/txtNavigationState.test.js
```

Expected: all helper tests pass.

- [ ] **Step 5: Run TXT reader tests most likely to catch hydration regressions**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/components/TxtReader.segmented.test.jsx
```

Expected: existing segmented reader tests pass, or any failure clearly points to pre-existing dirty worktree changes. Do not change unrelated EPUB or Dashboard files.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add frontend/src/lib/txtNavigationState.js frontend/src/lib/txtNavigationState.test.js frontend/src/components/TxtReader.jsx
git commit -m "test: preserve txt page anchor during hydration"
```

## Task 4: Latest-Request-Wins Navigation Integration

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/lib/txtNavigationState.js`
- Modify: `frontend/src/lib/txtNavigationState.test.js`
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`

- [ ] **Step 1: Add a ref-friendly request tracker helper**

Append this helper to `frontend/src/lib/txtNavigationState.js`:

```js
export function startTxtNavigationRequest(requestRef) {
  if (!requestRef || typeof requestRef !== 'object') {
    return {
      requestId: 1,
      isStale: () => false,
    }
  }

  requestRef.current = (Number.isFinite(requestRef.current) ? requestRef.current : 0) + 1
  const requestId = requestRef.current

  return {
    requestId,
    isStale: () => requestRef.current !== requestId,
  }
}
```

- [ ] **Step 2: Test the ref-friendly helper**

Append this test to `frontend/src/lib/txtNavigationState.test.js`:

```js
test('startTxtNavigationRequest reports stale status through a shared ref', () => {
  const requestRef = { current: 0 }
  const first = startTxtNavigationRequest(requestRef)
  const second = startTxtNavigationRequest(requestRef)

  expect(first.requestId).toBe(1)
  expect(second.requestId).toBe(2)
  expect(first.isStale()).toBe(true)
  expect(second.isStale()).toBe(false)
})
```

Also update the import in that test file:

```js
import {
  createTxtNavigationRequestTracker,
  reconcileHydratedTxtPageState,
  resolvePageForAnchor,
  startTxtNavigationRequest,
} from './txtNavigationState'
```

- [ ] **Step 3: Use the helper in `TxtReader.jsx`**

In `frontend/src/components/TxtReader.jsx`, update the import:

```js
import { reconcileHydratedTxtPageState, startTxtNavigationRequest } from '../lib/txtNavigationState'
```

Inside `goToViewportPage`, replace:

```js
const requestId = navigationRequestIdRef.current + 1
navigationRequestIdRef.current = requestId
const isStaleRequest = () => navigationRequestIdRef.current !== requestId
```

with:

```js
const { isStale: isStaleRequest } = startTxtNavigationRequest(navigationRequestIdRef)
```

- [ ] **Step 4: Guard the delayed `goNext` full-map expansion**

In `goNext`, before calling `loadGlobalRenderPages()`, capture the current request id:

```js
const expansionRequestId = navigationRequestIdRef.current
```

Then inside the `.then((targetPages) => {` callback, add this as the first line:

```js
if (navigationRequestIdRef.current !== expansionRequestId) return
```

This prevents a slow global-map expansion from issuing a late `goToViewportPage` after a newer navigation request has already started.

- [ ] **Step 5: Run navigation helper tests**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/lib/txtNavigationState.test.js
```

Expected: all navigation helper tests pass.

- [ ] **Step 6: Add a minimal component regression for rapid navigation**

Append this test to `frontend/src/components/TxtReader.segmented.test.jsx` near the other keyboard navigation tests:

```jsx
test('ignores stale TXT navigation results after rapid next-page requests', async () => {
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 72, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                display_fragments: [
                    { segment_id: 0, display_text: 'A'.repeat(24), source_start_offset: 0, source_end_offset: 24 },
                    { segment_id: 1, display_text: 'B'.repeat(24), source_start_offset: 24, source_end_offset: 48 },
                    { segment_id: 2, display_text: 'C'.repeat(24), source_start_offset: 48, source_end_offset: 72 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ results: [] }), { status: 200 })
        }
        throw new Error(`Unhandled fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await waitFor(() => {
        expect(screen.getByTestId('progress-current-page').textContent).toBe('1')
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
    })

    await act(async () => {
        mockUseKeyboardNav.mock.lastCall[0].onNext()
        mockUseKeyboardNav.mock.lastCall[0].onNext()
    })

    await waitFor(() => {
        expect(screen.getByTestId('progress-current-page').textContent).toBe('3')
    })
    expect(screen.getByTestId('txt-reader-content').textContent).toContain('C'.repeat(24))
    expect(screen.getByTestId('txt-reader-content').textContent).not.toContain('A'.repeat(24))
})
```

- [ ] **Step 7: Run targeted component tests**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/components/TxtReader.segmented.test.jsx
```

Expected: the rapid navigation regression passes and no existing TXT segmented tests regress.

- [ ] **Step 8: Commit Task 4**

Run:

```powershell
git add frontend/src/components/TxtReader.jsx frontend/src/lib/txtNavigationState.js frontend/src/lib/txtNavigationState.test.js frontend/src/components/TxtReader.segmented.test.jsx
git commit -m "fix: ignore stale txt navigation results"
```

## Task 5: Local Recalculation Reductions

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: tests only if behavior changes reveal missing coverage

- [ ] **Step 1: Avoid rebuilding measured pages before metrics are stable**

In `TxtReader.jsx`, update `buildMeasuredRenderPages` so it returns an empty array when `createTxtMeasuredPaginationOptions(viewportMetrics)` returns `null` and no fallback should be authoritative:

```js
const measuredOptions = createTxtMeasuredPaginationOptions(viewportMetrics)
if (!measuredOptions && viewportMetrics != null) return []
```

Keep the existing `DEFAULT_TXT_RENDER_PAGE_SIZE` fallback only for initial no-metrics state if current tests depend on provisional rendering.

- [ ] **Step 2: Skip no-op current-page state writes**

Where `goToViewportPage` calls `setCurrentViewportPage(targetPageIndex)` or `setCurrentViewportPage(resolvedViewportPage)`, wrap the setter:

```js
setCurrentViewportPage((currentPage) => (
    currentPage === targetPageIndex ? currentPage : targetPageIndex
))
```

and:

```js
setCurrentViewportPage((currentPage) => (
    currentPage === resolvedViewportPage ? currentPage : resolvedViewportPage
))
```

Use the same pattern only for no-op writes where the target value is already computed and stable.

- [ ] **Step 3: Run TXT-focused tests**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/hooks/useTxtSegmentWindow.test.jsx src/lib/txtPageMetrics.test.js src/lib/txtNavigationState.test.js src/components/TxtReader.segmented.test.jsx
```

Expected: all targeted TXT tests pass.

- [ ] **Step 4: Run the full frontend test suite**

Run:

```powershell
cd C:\dev\bookreader\frontend
npm run test
```

Expected: all frontend tests pass. If there are pre-existing failures, record the exact test names and failure messages before continuing.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add frontend/src/components/TxtReader.jsx
git commit -m "perf: reduce redundant txt reader updates"
```

## Final Verification

- [ ] Run all targeted TXT tests:

```powershell
cd C:\dev\bookreader\frontend
npm run test -- src/hooks/useTxtSegmentWindow.test.jsx src/lib/txtPageMetrics.test.js src/lib/txtNavigationState.test.js src/components/TxtReader.segmented.test.jsx
```

- [ ] Run full frontend tests:

```powershell
cd C:\dev\bookreader\frontend
npm run test
```

- [ ] Optional manual web check:

```powershell
cd C:\dev\bookreader\backend
python run_server.py
```

```powershell
cd C:\dev\bookreader\frontend
npm run dev
```

Open `http://127.0.0.1:5174`, load a large TXT file, and verify:

- content appears with transform options on and off
- pages contain normal amounts of text
- progress does not jump back to page one after total pages hydrate
- Space and arrow keys advance one page per keydown
- a far progress seek still leaves Space/arrow navigation page-based
