# TXT Reader Regression Guardrails

Last updated: 2026-05-19

Use this document when changing TXT reader pagination, transforms, search jumps, keyboard navigation, or segment-window loading.

## Files To Review

- `frontend/src/components/TxtReader.jsx`
- `frontend/src/hooks/useTxtSegmentWindow.js`
- `frontend/src/hooks/useKeyboardNav.js`
- `frontend/src/lib/txtMeasuredPagination.js`
- `frontend/src/lib/txtPageMetrics.js`
- `frontend/src/lib/txtRenderPages.js`
- `frontend/src/lib/txtDisplayMapper.js`

## Guardrails

### 1. Segment API Normalization

The reader can receive both raw `segments` and transformed `display_fragments`. Rendering should prefer `display_fragments` when present and fall back to `segments` only when needed.

Check:
- Transform options on/off both render visible content.
- Empty or missing optional arrays do not create blank pages.
- Search and annotation locators still map to the displayed transformed text.

### 2. Viewport-Based Pagination

TXT page splits should be based on measured viewport width/height, font size, line height, padding, page gap, and layout. Avoid returning to fixed character-count paging for visible pages.

Check:
- Changing vertical margin recalculates total pages.
- Pages are not split into 1-line fragments except in intentionally tiny test viewports.
- The last visible line is not clipped at the bottom of the page surface.

### 3. Page Map Hydration

The local page map and later full-book page map can disagree temporarily. Hydration must preserve the current text anchor instead of blindly trusting page number.

Check:
- Current page text remains stable when the global page map finishes loading.
- Far search jumps stay on the target text after page map hydration.
- Progress bar page number and visible text remain aligned.

### 4. Async Navigation

Navigation requests can overlap. Page movement should use a latest-request-wins guard so stale async results do not overwrite newer state.

Check:
- Rapid `Space`/next-page presses advance naturally.
- Slow window fetches cannot pull the reader back to an older page.
- Keyboard, progress bar, bookmark, search, and annotation navigation share the same page-state rules.

### 5. Far Jumps And Window Starts

When jumping outside the current segment window, the target window, render page start, and current page state must be realigned around the target locator.

Check:
- Search result jumps land on the target segment and highlight the match.
- After a far jump, next/previous page starts from the visible page, not from a stale local window.
- Jumping before the full-book page map is ready still lands on useful text.

## Required Automated Checks

From `frontend/`:

```powershell
cmd /c npx vitest run src/components/TxtReader.segmented.test.jsx
cmd /c npx vitest run src/components/TxtReader.anchor.test.jsx src/lib/txtPageMetrics.test.js src/lib/txtMeasuredPagination.test.js src/lib/txtDisplayMapper.test.js src/lib/txtRenderPages.test.js
cmd /c npm run test
```

The full test suite currently runs with `fileParallelism: false` because reader tests share global jsdom mocks.

## Manual QA

Use a large TXT file and verify:

1. First page appears as a paged viewport, not a long scroll document.
2. Page count does not visibly inflate and then collapse.
3. Bottom bar hide/show preserves the visible paragraph.
4. `Space` advances the reader even if the progress control was recently focused.
5. Rapid next-page input advances one page at a time without delayed jumps.
6. Layout changes between single and dual keep text and progress coherent.
7. Search results and annotations jump to the expected visible text.
8. Compatibility toggles keep the reader near the same logical position.
