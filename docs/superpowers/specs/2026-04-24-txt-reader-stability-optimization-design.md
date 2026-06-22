# TXT Reader Stability Design

Status: current design summary, refreshed 2026-05-19.

## Summary

TXT reader stability depends on keeping five pieces of state aligned:

- normalized display fragments from `/txt-segments`
- the loaded segment/window range
- viewport-derived measured render pages
- the current viewport page
- the current text anchor, represented by start segment and start fragment where available

The reader should optimize only inside those boundaries. Do not trade away anchor correctness for fewer recomputations.

## Invariants

1. Rendering source
   - Prefer `display_fragments` when present.
   - Fall back to normalized `segments`.
   - Transform options must not make otherwise valid display fragments disappear.

2. Pagination
   - Use measured viewport metrics: width, height, font size, line height, padding, gap, and layout.
   - Recalculate when typography or viewport changes.
   - Keep a conservative fallback for test and initial render environments.

3. Page-map hydration
   - Full-book page-map loading may update total pages.
   - It must not move the reader away from the current text anchor.

4. Async navigation
   - Navigation is latest-request-wins.
   - Slow window/page-map responses must not overwrite newer keyboard, search, progress, bookmark, or annotation jumps.

5. Far jumps
   - Search and annotation jumps should load a window centered around the target locator when needed.
   - After the jump, next/previous navigation must continue from the visible page.

## Regression Coverage

The main coverage lives in:

- `frontend/src/components/TxtReader.segmented.test.jsx`
- `frontend/src/components/TxtReader.anchor.test.jsx`
- `frontend/src/lib/txtPageMetrics.test.js`
- `frontend/src/lib/txtMeasuredPagination.test.js`
- `frontend/src/lib/txtDisplayMapper.test.js`
- `frontend/src/lib/txtRenderPages.test.js`

See `docs/txt-reader-regression-guardrails.md` for the operational checklist.
