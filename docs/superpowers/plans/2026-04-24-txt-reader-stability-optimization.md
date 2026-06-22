# TXT Reader Stability Optimization Plan

Status: superseded by current implementation as of 2026-05-19.

The original version of this plan proposed adding `txtNavigationState.js` and related tests. That file does not exist in the current implementation. The stability work was instead implemented directly around the existing TXT reader state, measured pagination utilities, and integration tests.

## Current Implemented Shape

- `frontend/src/hooks/useTxtSegmentWindow.js` normalizes segment-window responses for rendering.
- `frontend/src/lib/txtPageMetrics.js` computes viewport-derived page capacity.
- `frontend/src/lib/txtMeasuredPagination.js` builds measured render pages.
- `frontend/src/components/TxtReader.jsx` owns current viewport page, current start segment, current start fragment, async navigation request ids, and page-map hydration.
- `frontend/src/components/TxtReader.segmented.test.jsx` carries the main regression coverage for far jumps, keyboard movement, page-map hydration, transforms, and measured pages.

## Do Not Follow The Old Steps

Do not create `frontend/src/lib/txtNavigationState.js` just because older plan text mentioned it. Any future extraction should start from the current code and tests, not from the superseded checklist.

## Current Validation

From `frontend/`:

```powershell
cmd /c npx vitest run src/components/TxtReader.segmented.test.jsx
cmd /c npm run test
```

See also:

- `docs/txt-reader-regression-guardrails.md`
- `docs/qa-validation.md`
