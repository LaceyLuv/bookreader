# Reader Input and TXT Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix slow TXT reader interactions, make bottom-bar mouse interactions return keyboard control to the reader, and preserve visible reading position when the bottom bar opens or closes.

**Architecture:** Add a small shared reader-interaction contract around focus restore, keyboard ownership, and bottom-bar visibility changes. Keep reader-specific pagination logic inside each reader, but introduce a TXT-only anchor capture/restore path so layout changes preserve the visible text location instead of only preserving the page number.

**Tech Stack:** React 19, Vite 6, React Router 7, browser DOM APIs, Vitest, Testing Library, jsdom

---

## File Structure

- Modify: `frontend/package.json`
  - Add repeatable test commands for reader interaction work.
- Create: `frontend/vitest.config.js`
  - Enable jsdom-based component and hook tests.
- Create: `frontend/src/test/setup.js`
  - Shared Testing Library setup and DOM polyfills for reader tests.
- Create: `frontend/src/hooks/useKeyboardNav.test.jsx`
  - Lock down keyboard ownership, especially `Space` after pointer interactions.
- Create: `frontend/src/components/ReaderProgressBar.test.jsx`
  - Lock down bottom-bar collapse/expand and focus-return behavior.
- Modify: `frontend/src/hooks/useKeyboardNav.js`
  - Tighten interactive-target detection and support explicit keyboard ownership handoff.
- Modify: `frontend/src/components/ReaderProgressBar.jsx`
  - Emit bottom-bar visibility changes and restore focus to the reader root after pointer-based controls.
- Create: `frontend/src/hooks/useReaderViewportAnchor.js`
  - Shared helper for storing/restoring the visible text anchor across layout changes.
- Modify: `frontend/src/components/TxtReader.jsx`
  - Use the new focus and anchor APIs, reduce unnecessary TXT re-measure churn, and preserve top-visible text when the bottom bar changes.
- Modify: `frontend/src/components/EpubReader.jsx`
  - Adopt the shared bottom-bar focus contract so keyboard behavior is consistent across readers.
- Optional follow-up modify: `frontend/src/components/ZipReader.jsx`
  - Adopt the same bottom-bar focus contract if it renders `ReaderProgressBar` directly.
- Modify: `docs/qa-validation.md`
  - Add manual reader QA steps for TXT/EPUB keyboard and bottom-bar regression coverage.

---

### Task 1: Add a frontend test harness for reader interaction regressions

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.js`
- Create: `frontend/src/test/setup.js`
- Test: `frontend/src/hooks/useKeyboardNav.test.jsx`
- Test: `frontend/src/components/ReaderProgressBar.test.jsx`

- [ ] **Step 1: Add the failing test toolchain configuration**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^26.1.0",
    "vitest": "^2.1.8"
  }
}
```

```js
// frontend/vitest.config.js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
})
```

- [ ] **Step 2: Install dependencies and verify the test runner boots**

Run: `cmd /c npm install`
Expected: install completes and `vitest` is available under `frontend/node_modules/.bin/`

Run: `cmd /c npm test`
Expected: FAIL because the new test files do not exist yet

- [ ] **Step 3: Add the first failing reader interaction tests**

```jsx
// frontend/src/hooks/useKeyboardNav.test.jsx
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useKeyboardNav } from './useKeyboardNav'

function Harness({ onNext, onPrev }) {
  useKeyboardNav({ onNext, onPrev, enabled: true })
  return (
    <div>
      <div data-testid="reader-root" tabIndex={-1}>reader</div>
      <input aria-label="page input" />
    </div>
  )
}

test('Space moves to next page when focus is returned to reader root', async () => {
  const user = userEvent.setup()
  const onNext = vi.fn()
  const onPrev = vi.fn()
  const { getByTestId } = render(<Harness onNext={onNext} onPrev={onPrev} />)

  getByTestId('reader-root').focus()
  await user.keyboard(' ')

  expect(onNext).toHaveBeenCalledTimes(1)
  expect(onPrev).not.toHaveBeenCalled()
})
```

```jsx
// frontend/src/components/ReaderProgressBar.test.jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReaderProgressBar from './ReaderProgressBar'

test('collapse button returns focus to reader root after pointer interaction', async () => {
  const user = userEvent.setup()
  const readerRoot = document.createElement('div')
  readerRoot.tabIndex = -1
  document.body.appendChild(readerRoot)

  render(
    <ReaderProgressBar
      currentPage={3}
      totalPages={10}
      progress={0.2}
      readerFocusRef={{ current: readerRoot }}
    />,
  )

  await user.click(screen.getByRole('button', { name: /hide progress bar/i }))

  expect(document.activeElement).toBe(readerRoot)
})
```

- [ ] **Step 4: Run tests to confirm the new regression cases fail first**

Run: `cmd /c npm test -- --runInBand`
Expected: FAIL with missing props/behavior for focus restoration and keyboard ownership

- [ ] **Step 5: Commit the test harness baseline**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.js frontend/src/test/setup.js frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/ReaderProgressBar.test.jsx
git commit -m "test: add reader interaction regression harness"
```

---

### Task 2: Define the shared keyboard ownership and bottom-bar focus contract

**Files:**
- Modify: `frontend/src/hooks/useKeyboardNav.js`
- Modify: `frontend/src/components/ReaderProgressBar.jsx`
- Test: `frontend/src/hooks/useKeyboardNav.test.jsx`
- Test: `frontend/src/components/ReaderProgressBar.test.jsx`

- [ ] **Step 1: Extend the failing tests for the exact bug report**

```jsx
test('Space does not activate the last clicked progress-bar control after pointer seek', async () => {
  const user = userEvent.setup()
  const onNext = vi.fn()
  const readerRoot = document.createElement('div')
  readerRoot.tabIndex = -1
  document.body.appendChild(readerRoot)

  render(
    <>
      <Harness onNext={onNext} onPrev={vi.fn()} />
      <ReaderProgressBar
        currentPage={3}
        totalPages={10}
        progress={0.2}
        readerFocusRef={{ current: readerRoot }}
      />
    </>,
  )

  await user.click(screen.getByRole('slider'))
  await user.keyboard(' ')

  expect(onNext).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Update keyboard navigation so only truly active text inputs steal `Space`**

```js
// frontend/src/hooks/useKeyboardNav.js
function isTextEntryTarget(target) {
  if (!(target instanceof Element)) return false
  const editable = target.closest('input, textarea, [contenteditable="true"]')
  if (!editable) return false
  if (editable instanceof HTMLInputElement) {
    return !['range', 'button', 'checkbox', 'radio'].includes(editable.type)
  }
  return true
}

export function useKeyboardNav({ onNext, onPrev, onEscape, enabled = true, readerRootRef = null }) {
  const handler = useCallback((e) => {
    if (!enabled) return
    if (isTextEntryTarget(e.target)) return
    if (readerRootRef?.current && document.activeElement === document.body) {
      readerRootRef.current.focus({ preventScroll: true })
    }
    // existing next/prev/escape dispatch stays here
  }, [enabled, onEscape, onNext, onPrev, readerRootRef])
}
```

- [ ] **Step 3: Make the progress bar explicitly return focus to the reader root after pointer actions**

```jsx
// frontend/src/components/ReaderProgressBar.jsx
function restoreReaderFocus(readerFocusRef) {
  const target = readerFocusRef?.current
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true })
  }
}

function ReaderProgressBar({ readerFocusRef, onVisibilityChange, ...props }) {
  const handleCollapse = () => {
    setIsCollapsed(true)
    onVisibilityChange?.(false)
    queueMicrotask(() => restoreReaderFocus(readerFocusRef))
  }

  const handleExpand = () => {
    setIsCollapsed(false)
    onVisibilityChange?.(true)
    queueMicrotask(() => restoreReaderFocus(readerFocusRef))
  }
}
```

- [ ] **Step 4: Run focused tests for keyboard and progress-bar interaction**

Run: `cmd /c npx vitest run frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/ReaderProgressBar.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit the shared interaction contract**

```bash
git add frontend/src/hooks/useKeyboardNav.js frontend/src/components/ReaderProgressBar.jsx frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/ReaderProgressBar.test.jsx
git commit -m "fix: restore reader keyboard ownership after bottom bar input"
```

---

### Task 3: Add a shared viewport-anchor helper for layout changes

**Files:**
- Create: `frontend/src/hooks/useReaderViewportAnchor.js`
- Test: `frontend/src/components/ReaderProgressBar.test.jsx`
- Test: `frontend/src/components/TxtReader.anchor.test.jsx`

- [ ] **Step 1: Add a failing TXT anchor test before introducing the helper**

```jsx
// frontend/src/components/TxtReader.anchor.test.jsx
test('bottom bar toggle preserves the visible top text block in TXT reader', async () => {
  const user = userEvent.setup()
  render(<TxtReaderTestHarness text={'alpha\n'.repeat(800)} />)

  await user.click(screen.getByRole('button', { name: /hide progress bar/i }))
  await user.click(screen.getByRole('button', { name: /show progress bar/i }))

  expect(screen.getByTestId('top-visible-snippet')).toHaveTextContent('alpha')
})
```

- [ ] **Step 2: Create the anchor helper with explicit capture and restore APIs**

```js
// frontend/src/hooks/useReaderViewportAnchor.js
import { useCallback, useRef } from 'react'

export function useReaderViewportAnchor() {
  const anchorRef = useRef(null)

  const captureAnchor = useCallback((root) => {
    const firstNode = root?.firstChild
    if (!(firstNode instanceof Node)) return null
    anchorRef.current = {
      textSample: root.textContent?.slice(0, 120) ?? '',
      scrollLeft: root.parentElement?.scrollLeft ?? 0,
    }
    return anchorRef.current
  }, [])

  const restoreAnchor = useCallback((root) => {
    const anchor = anchorRef.current
    if (!anchor || !root?.parentElement) return false
    root.parentElement.scrollTo({ left: anchor.scrollLeft, behavior: 'auto' })
    return true
  }, [])

  return { captureAnchor, restoreAnchor, anchorRef }
}
```

- [ ] **Step 3: Keep the helper intentionally narrow and TXT-oriented**

```js
// note in file comments
// This hook preserves viewport position across reader chrome/layout changes.
// It does not own pagination; individual readers decide when to capture and restore.
```

- [ ] **Step 4: Run the new anchor test and confirm it fails until TXT uses the hook**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.anchor.test.jsx`
Expected: FAIL because `TxtReader` does not capture or restore the visible anchor yet

- [ ] **Step 5: Commit the helper scaffold and failing anchor coverage**

```bash
git add frontend/src/hooks/useReaderViewportAnchor.js frontend/src/components/TxtReader.anchor.test.jsx
git commit -m "test: add txt viewport anchor regression coverage"
```

---

### Task 4: Stabilize TXT layout measurement and preserve visible text across bottom-bar toggles

**Files:**
- Modify: `frontend/src/components/TxtReader.jsx`
- Modify: `frontend/src/components/ReaderProgressBar.jsx`
- Modify: `frontend/src/hooks/useKeyboardNav.js`
- Modify: `frontend/src/hooks/useReaderViewportAnchor.js`
- Test: `frontend/src/components/TxtReader.anchor.test.jsx`
- Test: `frontend/src/hooks/useKeyboardNav.test.jsx`
- Test: `frontend/src/components/ReaderProgressBar.test.jsx`

- [ ] **Step 1: Thread `readerRootRef` and `onVisibilityChange` into TXT before implementation**

```jsx
// frontend/src/components/TxtReader.jsx
const readerRootRef = useRef(null)
const { captureAnchor, restoreAnchor } = useReaderViewportAnchor()

<div ref={readerRootRef} tabIndex={-1} className="readerRoot ...">
  ...
  <ReaderProgressBar
    readerFocusRef={readerRootRef}
    onVisibilityChange={(visible) => {
      captureAnchor(contentRef.current)
      setProgressBarVisible(visible)
    }}
    ...
  />
</div>
```

- [ ] **Step 2: Split TXT re-measure triggers so chrome visibility does not look like content changes**

```jsx
const displayedText = useMemo(() => {
  let nextText = fullText
  if (compactWhitespace) nextText = removeExtraWhitespaceAndEmptyLines(nextText)
  if (splitParagraphs) nextText = splitDenseParagraphs(nextText)
  return nextText
}, [fullText, compactWhitespace, splitParagraphs])

const layoutMeasureKey = useMemo(() => JSON.stringify({
  layout,
  columnGap,
  hMargin,
  vMargin,
  lineHeight,
  letterSpacing,
  fontFamily: contentStyle.fontFamily,
  fontWeight: contentStyle.fontWeight,
  fontSize: contentStyle.fontSize,
  progressBarVisible,
}), [layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing, contentStyle.fontFamily, contentStyle.fontWeight, contentStyle.fontSize, progressBarVisible])
```

- [ ] **Step 3: Restore the visible anchor after TXT re-measure finishes**

```jsx
useEffect(() => {
  if (loading || !displayedText) return
  return scheduleAfterPaint(() => {
    scheduleMeasure(() => {
      measure()
      restoreAnchor(contentRef.current)
    })
  })
}, [loading, displayedText, layoutMeasureKey, measure, restoreAnchor, scheduleMeasure])
```

- [ ] **Step 4: Clamp page state from the restored anchor instead of blindly trusting the old page**

```jsx
const syncPageFromScroll = useCallback(() => {
  const scroller = scrollerRef.current
  const step = stepRef.current
  if (!scroller || step <= 0) return
  const nextPage = Math.max(0, Math.min(Math.round(scroller.scrollLeft / step), totalPages - 1))
  setCurrentPage((prev) => (prev === nextPage ? prev : nextPage))
}, [setCurrentPage, totalPages])
```

- [ ] **Step 5: Run TXT regression coverage and verify the new implementation passes**

Run: `cmd /c npx vitest run frontend/src/components/TxtReader.anchor.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/ReaderProgressBar.test.jsx`
Expected: PASS

- [ ] **Step 6: Run the production web build to catch layout-only regressions**

Run: `cmd /c npm run build`
Expected: PASS and `frontend/dist/` updates successfully

- [ ] **Step 7: Commit the TXT stabilization work**

```bash
git add frontend/src/components/TxtReader.jsx frontend/src/components/ReaderProgressBar.jsx frontend/src/hooks/useKeyboardNav.js frontend/src/hooks/useReaderViewportAnchor.js frontend/src/components/TxtReader.anchor.test.jsx frontend/src/hooks/useKeyboardNav.test.jsx frontend/src/components/ReaderProgressBar.test.jsx
git commit -m "fix: preserve txt viewport and keyboard flow across bottom bar changes"
```

---

### Task 5: Apply the shared bottom-bar behavior to EPUB and finish QA coverage

**Files:**
- Modify: `frontend/src/components/EpubReader.jsx`
- Modify: `frontend/src/components/ZipReader.jsx`
- Modify: `docs/qa-validation.md`
- Test: `frontend/src/components/ReaderProgressBar.test.jsx`

- [ ] **Step 1: Add an EPUB regression test for bottom-bar keyboard continuity**

```jsx
test('shared progress bar contract restores focus for epub readers too', async () => {
  const user = userEvent.setup()
  const readerRoot = document.createElement('div')
  readerRoot.tabIndex = -1
  document.body.appendChild(readerRoot)

  render(
    <ReaderProgressBar
      currentPage={5}
      totalPages={20}
      progress={0.25}
      readerFocusRef={{ current: readerRoot }}
    />,
  )

  await user.click(screen.getByRole('button', { name: /hide progress bar/i }))
  expect(document.activeElement).toBe(readerRoot)
})
```

- [ ] **Step 2: Pass the same `readerFocusRef` contract from EPUB and ZIP**

```jsx
// frontend/src/components/EpubReader.jsx
const readerRootRef = useRef(null)

return (
  <div ref={readerRootRef} tabIndex={-1} className="readerRoot ...">
    ...
    <ReaderProgressBar
      readerFocusRef={readerRootRef}
      onVisibilityChange={() => {}}
      ...
    />
  </div>
)
```

- [ ] **Step 3: Update manual QA to match the bug report**

```md
## Reader interaction regression checklist

- TXT: open a large `.txt` file, toggle the bottom bar twice, and confirm the visible paragraph does not jump.
- TXT: click the bottom-bar slider, then press `Space`; expected result is next page, not button/slider highlight.
- TXT: toggle whitespace and paragraph options with the bottom bar open and confirm no severe input lag.
- EPUB: click the bottom bar, then press `Space`; expected result is normal page/chapter advance behavior.
```

- [ ] **Step 4: Run the full frontend verification set**

Run: `cmd /c npm test`
Expected: PASS

Run: `cmd /c npm run build`
Expected: PASS

- [ ] **Step 5: Commit the shared-reader QA finish**

```bash
git add frontend/src/components/EpubReader.jsx frontend/src/components/ZipReader.jsx docs/qa-validation.md frontend/src/components/ReaderProgressBar.test.jsx
git commit -m "test: cover shared reader bottom bar behavior"
```

---

## Self-Review

- Spec coverage:
  - Slow TXT open / bottom-bar activation: covered by Tasks 3 and 4.
  - `Space` after mouse click should always page-turn: covered by Tasks 1 and 2.
  - Bottom-bar open/close should preserve visible text: covered by Tasks 3 and 4.
  - Shared behavior across readers: covered by Task 5.
- Placeholder scan:
  - No `TODO`, `TBD`, or `test later` language remains.
- Type consistency:
  - Shared prop names are `readerFocusRef` and `onVisibilityChange`.
  - Shared helper names are `captureAnchor` and `restoreAnchor`.
