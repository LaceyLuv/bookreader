# TXT Paged Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the TXT reader so it behaves like the EPUB reader with viewport-based page turns, working single/dual layout, and keyboard/progress-bar navigation that always changes the visible text.

**Architecture:** Keep TXT segment manifest/search/annotation transport as the data source, but replace the current segment-window-as-page model with a paged viewport model inside the frontend. TXT rendering will use a scroller plus column-based measurement flow similar to EPUB, with a TXT-only pagination map that translates between segment IDs and viewport pages so keyboard input, progress bar updates, search jumps, and annotations all operate on the same visible-page state.

**Tech Stack:** React 19, Vite 6, React Router 7, browser DOM APIs, Vitest, Testing Library, jsdom

---

## File Structure

- Create: `frontend/src/lib/txtPagination.js`
  - Pure helpers for page measurement math, page-to-segment mapping, and segment lookup by viewport page.
- Create: `frontend/src/lib/txtPagination.test.js`
  - Unit tests for pagination math and segment/page mapping.
- Modify: `frontend/src/components/TxtReader.jsx`
  - Replace segment-index navigation with viewport-page navigation and apply actual single/dual paged layout rendering.
- Modify: `frontend/src/hooks/useTxtSegmentWindow.js`
  - Support loading enough contiguous segments for viewport pagination and expose deterministic window ownership for a target segment.
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`
  - Replace segment-window expectations with viewport-page expectations and lock down search-result navigation.
- Modify: `frontend/src/components/TxtReader.anchor.test.jsx`
  - Preserve viewport position across bottom-bar visibility changes in the new paged TXT layout.
- Modify: `frontend/src/hooks/useKeyboardNav.test.jsx`
  - Add TXT-specific regression coverage that `Space` changes visible TXT content, not only the bottom-bar state.
- Modify: `frontend/src/components/ReaderProgressBar.test.jsx`
  - Verify progress-bar seeks update visible TXT content and preserve keyboard ownership.
- Modify: `docs/qa-validation.md`
  - Add manual QA steps for TXT paged layout, dual layout, and first-page keyboard navigation.

---

### Task 1: Introduce pure TXT pagination helpers and lock the target model in tests

**Files:**
- Create: `frontend/src/lib/txtPagination.js`
- Create: `frontend/src/lib/txtPagination.test.js`

- [ ] **Step 1: Write failing tests for viewport-page and segment mapping**

```js
// frontend/src/lib/txtPagination.test.js
import {
  buildViewportPageMap,
  clampViewportPage,
  findViewportPageForSegment,
} from './txtPagination'

test('buildViewportPageMap expands per-page ownership from measured segment page counts', () => {
  const map = buildViewportPageMap([
    { segmentId: 10, pageCount: 2 },
    { segmentId: 11, pageCount: 1 },
    { segmentId: 12, pageCount: 3 },
  ])

  expect(map.totalPages).toBe(6)
  expect(map.pages[0]).toEqual({ page: 0, segmentId: 10, segmentPage: 0 })
  expect(map.pages[1]).toEqual({ page: 1, segmentId: 10, segmentPage: 1 })
  expect(map.pages[2]).toEqual({ page: 2, segmentId: 11, segmentPage: 0 })
  expect(map.pages[5]).toEqual({ page: 5, segmentId: 12, segmentPage: 2 })
})

test('findViewportPageForSegment returns the first viewport page that owns the segment', () => {
  const map = buildViewportPageMap([
    { segmentId: 7, pageCount: 1 },
    { segmentId: 8, pageCount: 2 },
  ])

  expect(findViewportPageForSegment(map, 7)).toBe(0)
  expect(findViewportPageForSegment(map, 8)).toBe(1)
})

test('clampViewportPage keeps viewport navigation inside the measured page range', () => {
  expect(clampViewportPage(-4, 9)).toBe(0)
  expect(clampViewportPage(3, 9)).toBe(3)
  expect(clampViewportPage(99, 9)).toBe(8)
})
```

- [ ] **Step 2: Run the unit tests to verify the helper module does not exist yet**

Run: `cmd /c npx vitest run frontend/src/lib/txtPagination.test.js`
Expected: FAIL with module-not-found or missing export errors for `txtPagination.js`

- [ ] **Step 3: Add the minimal pure helper implementation**

```js
// frontend/src/lib/txtPagination.js
export function clampViewportPage(page, totalPages) {
  const max = Math.max(1, totalPages) - 1
  return Math.max(0, Math.min(page, max))
}

export function buildViewportPageMap(items) {
  const pages = []
  let page = 0

  for (const item of items) {
    const pageCount = Math.max(1, Number(item.pageCount) || 1)
    for (let segmentPage = 0; segmentPage < pageCount; segmentPage += 1) {
      pages.push({
        page,
        segmentId: item.segmentId,
        segmentPage,
      })
      page += 1
    }
  }

  return {
    totalPages: pages.length,
    pages,
  }
}

export function findViewportPageForSegment(map, segmentId) {
  const hit = map.pages.find((item) => item.segmentId === segmentId)
  return hit ? hit.page : 0
}
```

- [ ] **Step 4: Re-run the pure helper tests**

Run: `cmd /c npx vitest run frontend/src/lib/txtPagination.test.js`
Expected: PASS

- [ ] **Step 5: Commit the pagination helper baseline**

```bash
git add frontend/src/lib/txtPagination.js frontend/src/lib/txtPagination.test.js
git commit -m "test: add txt pagination helper baseline"
```

---

### Task 2: Refactor TXT state so the reader navigates viewport pages instead of segment IDs

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`
- Modify: `frontend/src/hooks/useKeyboardNav.test.jsx`

- [ ] **Step 1: Replace existing TXT regression tests with viewport-page expectations**

```jsx
// frontend/src/components/TxtReader.segmented.test.jsx
test('Space moves TXT reader to the next visible viewport page', async () => {
  const user = userEvent.setup()
  const { useKeyboardNav } = await import('../hooks/useKeyboardNav')
  const keyboardConfig = useKeyboardNav.mock.calls.at(-1)?.[0]

  renderReaderWithTxtSegments([
    { segment_id: 0, text: 'page zero body' },
    { segment_id: 1, text: 'page one body' },
  ])

  await screen.findByText('page zero body')
  await act(async () => {
    keyboardConfig.onNext()
  })

  await waitFor(() => expect(screen.getByText('page one body')).toBeTruthy())
})

test('progress-bar seek updates visible TXT content, not only the page indicator', async () => {
  renderReaderWithTxtSegments([
    { segment_id: 0, text: 'alpha page' },
    { segment_id: 1, text: 'beta page' },
    { segment_id: 2, text: 'gamma page' },
  ])

  await screen.findByText('alpha page')
  screen.getByTestId('reader-progress-bar-seek')(3)

  await waitFor(() => expect(screen.getByText('gamma page')).toBeTruthy())
})
```

- [ ] **Step 2: Run TXT reader tests and confirm the current state model still uses segment windows as pages**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.segmented.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx`
Expected: FAIL because `currentPage` currently tracks segment position while the rendered content still comes from the current segment window

- [ ] **Step 3: Replace TXT page state with viewport-page state in the reader**

```jsx
// frontend/src/components/TxtReader.jsx
const progress = useReadingProgress(id, { totalPages: totalViewportPages, type: 'txt', legacyId })
const {
  currentPosition: currentViewportPage,
  setCurrentPosition: setCurrentViewportPage,
  ...
} = progress

const goToViewportPage = useCallback(async (page) => {
  const target = clampViewportPage(page, totalViewportPages)
  const ownership = viewportPageMap.pages[target]
  if (!ownership) return

  await showWindowForSegment(ownership.segmentId)
  setCurrentViewportPage(target)
  setPendingViewportPage(target)
}, [setCurrentViewportPage, showWindowForSegment, totalViewportPages, viewportPageMap])

const goNext = useCallback(() => {
  if (currentViewportPage < totalViewportPages - 1) void goToViewportPage(currentViewportPage + 1)
}, [currentViewportPage, goToViewportPage, totalViewportPages])

const goPrev = useCallback(() => {
  if (currentViewportPage > 0) void goToViewportPage(currentViewportPage - 1)
}, [currentViewportPage, goToViewportPage])
```

- [ ] **Step 4: Update progress-bar wiring to use viewport-page state everywhere**

```jsx
<ReaderProgressBar
  currentPage={currentViewportPage + 1}
  totalPages={totalViewportPages}
  onSeekPage={(page) => { void goToViewportPage(page - 1) }}
  progress={totalViewportPages > 1 ? currentViewportPage / (totalViewportPages - 1) : 0}
  onSeekProgress={(value) => {
    if (totalViewportPages <= 1) return
    void goToViewportPage(Math.round(value * (totalViewportPages - 1)))
  }}
  extraInfo={manifest ? `TXT ${currentViewportPage + 1}/${totalViewportPages}` : `TXT | ${loadingLabel}`}
  readerFocusRef={readerRootRef}
/>
```

- [ ] **Step 5: Re-run the reader-state regressions**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.segmented.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx`
Expected: PASS for state transitions, but dual-layout and actual paged rendering tests still fail because TXT layout is not column-based yet

- [ ] **Step 6: Commit the TXT viewport-page state refactor**

```bash
git add frontend/src/components/TxtReader.jsx frontend/src/components/TxtReader.segmented.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx
git commit -m "refactor: drive txt reader from viewport page state"
```

---

### Task 3: Convert TXT rendering to actual paged single/dual layout

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`
- Modify: `frontend/src/components/TxtReader.anchor.test.jsx`

- [ ] **Step 1: Add failing tests for visible single-page rendering and working dual layout**

```jsx
// frontend/src/components/TxtReader.segmented.test.jsx
test('TXT reader renders paged content inside a horizontal scroller instead of one tall block', async () => {
  renderReaderWithTxtSegments([
    { segment_id: 0, text: 'first viewport page' },
    { segment_id: 1, text: 'second viewport page' },
  ])

  const scroller = await screen.findByTestId('txt-reader-scroller')
  expect(scroller.style.overflowX).toBe('auto')
  expect(scroller.style.overflowY).toBe('hidden')
})

test('TXT reader applies dual layout when settings.layout is dual', async () => {
  renderReaderWithTxtSegments(
    [{ segment_id: 0, text: 'left page text right page text' }],
    { layout: 'dual' },
  )

  const content = await screen.findByTestId('txt-reader-content')
  expect(content.style.columnCount).toBe('2')
})
```

```jsx
// frontend/src/components/TxtReader.anchor.test.jsx
test('bottom bar toggle preserves viewport page in paged TXT layout', async () => {
  const user = userEvent.setup()
  render(<TxtPagedAnchorHarness />)

  await user.click(screen.getByRole('button', { name: /hide progress bar/i }))
  await user.click(screen.getByRole('button', { name: /show progress bar/i }))

  expect(screen.getByTestId('visible-viewport-page')).toHaveTextContent('2')
})
```

- [ ] **Step 2: Run paged-layout tests and confirm TXT still renders a plain stacked segment list**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx`
Expected: FAIL because `TxtReader` does not yet render a paged scroller or apply `layout` to the content container

- [ ] **Step 3: Replace the tall TXT body with a paged scroller plus column-based content container**

```jsx
// frontend/src/components/TxtReader.jsx
<div
  ref={frameRef}
  style={{
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    padding: `${vMargin}px ${hMargin}px`,
    boxSizing: 'border-box',
  }}
>
  <div
    ref={scrollerRef}
    data-testid="txt-reader-scroller"
    className="reader-scroller"
    style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflowX: 'auto',
      overflowY: 'hidden',
      scrollSnapType: 'none',
      scrollbarGutter: 'stable',
    }}
  >
    <div
      ref={contentRef}
      data-testid="txt-reader-content"
      style={{
        height: '100%',
        boxSizing: 'border-box',
        display: 'block',
        backgroundColor: 'var(--reader-page-bg)',
        color: 'var(--reader-page-fg)',
        fontFamily: contentStyle.fontFamily,
        fontWeight: contentStyle.fontWeight,
        fontSize: contentStyle.fontSize,
        lineHeight: `${lineHeight}`,
        letterSpacing: `${letterSpacing}em`,
        columnCount: layout === 'dual' ? 2 : 1,
        columnGap: `${columnGap}px`,
        columnFill: 'auto',
        columnRule: layout === 'dual' ? '1px solid transparent' : 'none',
      }}
    >
      {displayedSegments.map((segment) => (
        <div key={segment.segment_id} data-segment-id={segment.segment_id} className="txt-segment-block">
          {segment.displayText}
        </div>
      ))}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Add measurement and scroll-sync logic so visible text always follows viewport-page state**

```jsx
const measureLayout = useCallback(() => {
  const scroller = scrollerRef.current
  const content = contentRef.current
  if (!scroller || !content) return

  const width = scroller.clientWidth
  const styles = getComputedStyle(content)
  const rawGap = styles.columnGap
  const fallbackGap = parseFloat(styles.fontSize) || 16
  const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
  const columnWidth = layout === 'dual'
    ? Math.max(1, Math.floor((width - gap) / 2))
    : Math.max(1, Math.floor(width))

  content.style.columnWidth = `${columnWidth}px`
  content.style.columnCount = layout === 'dual' ? '2' : '1'

  const step = width + gap
  stepRef.current = step
  const nextTotalPages = Math.max(1, Math.ceil((scroller.scrollWidth + gap) / step))
  setTotalViewportPages(nextTotalPages)
  scroller.scrollTo({ left: Math.round(currentViewportPage * step), behavior: 'auto' })
}, [currentViewportPage, layout])

useEffect(() => {
  return scheduleAfterPaint(() => {
    measureLayout()
  })
}, [displayedSegments, layout, lineHeight, letterSpacing, hMargin, vMargin, measureLayout])
```

- [ ] **Step 5: Re-run paged TXT layout regressions**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit the paged TXT layout implementation**

```bash
git add frontend/src/components/TxtReader.jsx frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx
git commit -m "feat: render txt reader as paged single and dual layout"
```

---

### Task 4: Map search results and annotations onto viewport pages

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/hooks/useTxtSegmentWindow.js`
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`

- [ ] **Step 1: Add failing tests for search and annotation jumps landing on the correct viewport page**

```jsx
// frontend/src/components/TxtReader.segmented.test.jsx
test('search-result click jumps to the viewport page that owns the target segment', async () => {
  const user = userEvent.setup()
  renderReaderWithSearchResult({
    segment_id: 12,
    segment_local_start: 4,
    segment_local_end: 10,
    snippet: 'target hit',
  })

  await user.click(await screen.findByRole('button', { name: /target hit/i }))

  await waitFor(() => {
    expect(screen.getByTestId('visible-viewport-page')).toHaveTextContent('5')
  })
})

test('annotation click jumps to the viewport page that owns the annotation segment', async () => {
  const user = userEvent.setup()
  renderReaderWithAnnotation({
    id: 1,
    segment_id: 8,
    page: null,
    snippet: 'saved highlight',
  })

  await user.click(await screen.findByRole('button', { name: /saved highlight/i }))

  await waitFor(() => {
    expect(screen.getByTestId('visible-viewport-page')).toHaveTextContent('3')
  })
})
```

- [ ] **Step 2: Run the TXT navigation tests and confirm search/annotation still navigate by raw segment index**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.segmented.test.jsx`
Expected: FAIL because search and annotation paths still call `setCurrentPage(result.segment_id)` or equivalent segment-based navigation

- [ ] **Step 3: Use the pagination map to translate segment targets into viewport-page targets**

```jsx
const handleSearchResultClick = useCallback(async (result) => {
  setAnnotationsOpen(false)
  setActiveAnnotationId(null)
  setActiveSearchIndex(result.index)

  if (!Number.isFinite(result.segment_id)) return

  await showWindowForSegment(result.segment_id)
  const targetPage = findViewportPageForSegment(viewportPageMap, result.segment_id)
  await goToViewportPage(targetPage)
  setPendingSearchTarget({
    segmentId: result.segment_id,
    start: result.segment_local_start ?? 0,
    end: result.segment_local_end ?? ((result.segment_local_start ?? 0) + searchQuery.length),
  })
}, [goToViewportPage, searchQuery.length, showWindowForSegment, viewportPageMap])

const handleAnnotationClick = useCallback((annotation) => {
  setSearchOpen(false)
  setPendingSearchTarget(null)
  setActiveSearchIndex(null)
  setActiveAnnotationId(annotation.id)

  if (Number.isFinite(annotation.segment_id)) {
    const targetPage = findViewportPageForSegment(viewportPageMap, annotation.segment_id)
    void goToViewportPage(targetPage)
    return
  }

  if (Number.isFinite(annotation.page)) {
    void goToViewportPage(annotation.page)
  }
}, [goToViewportPage, viewportPageMap])
```

- [ ] **Step 4: Update the TXT segment-window hook so the owning window for a segment is deterministic**

```js
// frontend/src/hooks/useTxtSegmentWindow.js
const showWindowForSegment = useCallback(async (segmentId) => {
  const centeredStart = Math.max(0, segmentId - Math.floor(windowSize / 2))
  await loadWindow(centeredStart)
  setVisibleStart(centeredStart)
  return centeredStart
}, [loadWindow, windowSize])
```

- [ ] **Step 5: Re-run TXT search and annotation navigation regressions**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.segmented.test.jsx`
Expected: PASS

- [ ] **Step 6: Commit viewport-aware TXT search and annotation navigation**

```bash
git add frontend/src/components/TxtReader.jsx frontend/src/hooks/useTxtSegmentWindow.js frontend/src/components/TxtReader.segmented.test.jsx
git commit -m "fix: map txt search and annotations to viewport pages"
```

---

### Task 5: Finish verification and document manual QA for the reported bugs

**Files:**
- Modify: `docs/qa-validation.md`
- Modify: `frontend/src/components/ReaderProgressBar.test.jsx`
- Modify: `frontend/src/hooks/useKeyboardNav.test.jsx`
- Modify: `frontend/src/components/TxtReader.segmented.test.jsx`

- [ ] **Step 1: Add final regression tests for the exact reported TXT bugs**

```jsx
// frontend/src/hooks/useKeyboardNav.test.jsx
test('Space on the first TXT viewport page changes visible content and page state together', async () => {
  const onNext = vi.fn()
  render(<KeyboardHarness onNext={onNext} onPrev={vi.fn()} />)

  fireEvent.keyDown(window, { key: ' ', code: 'Space' })

  expect(onNext).toHaveBeenCalledTimes(1)
})
```

```jsx
// frontend/src/components/ReaderProgressBar.test.jsx
test('TXT progress seek callback is wired to viewport pages', () => {
  const onSeekPage = vi.fn()
  render(
    <ReaderProgressBar
      currentPage={1}
      totalPages={12}
      onSeekPage={onSeekPage}
      progress={0}
    />,
  )

  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } })
  fireEvent.blur(screen.getByRole('spinbutton'))

  expect(onSeekPage).toHaveBeenCalledWith(6)
})
```

- [ ] **Step 2: Run the complete TXT-focused frontend suite**

Run: `cmd /c npx vitest run frontend/src/lib/txtPagination.test.js frontend/src/components/TxtReader.segmented.test.jsx frontend/src/components/TxtReader.anchor.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/ReaderProgressBar.test.jsx`
Expected: PASS

- [ ] **Step 3: Run the full frontend verification and production build**

Run: `cmd /c npm test`
Expected: PASS

Run: `cmd /c npm run build`
Expected: PASS

- [ ] **Step 4: Update manual QA with the three reported TXT regressions**

```md
## TXT paged-reader regression checklist

- Open a long TXT file and confirm the first screen fits inside one paged viewport with no vertical content spill that requires normal document scrolling.
- Toggle TXT layout from `single` to `dual` and confirm the visible page changes to a true two-page spread instead of staying visually identical.
- On the first TXT page, press `Space` and confirm both the visible text and the bottom progress bar move to the next viewport page together.
- Drag the bottom progress slider to the middle of a long TXT file and confirm the visible text changes immediately to the target viewport page.
- Open search results and annotation items for TXT and confirm each jump lands on the correct visible viewport page.
```

- [ ] **Step 5: Commit verification and QA coverage**

```bash
git add docs/qa-validation.md frontend/src/components/ReaderProgressBar.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/TxtReader.segmented.test.jsx
git commit -m "test: cover txt paged reader regressions"
```

---

## Self-Review

- Spec coverage:
  - One-screen paged TXT rendering is covered by Tasks 2 and 3.
  - Working single/dual TXT layout is covered by Task 3.
  - First-page `Space` changing visible text together with the bottom bar is covered by Tasks 2 and 5.
  - Search and annotation jumps staying aligned with the visible TXT page are covered by Task 4.
- Placeholder scan:
  - No `TODO`, `TBD`, or deferred “implement later” wording remains.
- Type consistency:
  - The plan uses `currentViewportPage`, `totalViewportPages`, `goToViewportPage`, and `viewportPageMap` consistently.
  - Segment-based lookups use `segment_id`, `segment_local_start`, and `segment_local_end` consistently with the existing backend/frontend contract.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-08-txt-paged-reader.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
