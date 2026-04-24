# TXT Reader Stability Optimization Design

## Summary

This design defines a conservative TXT reader optimization pass. The goal is to improve responsiveness without repeating previous regressions in segment loading, pagination, progress restoration, or keyboard navigation.

The work is limited to TXT reader stability and local performance improvements. EPUB, ZIP, Dashboard, broad reader UI redesign, and aggressive caching are out of scope.

## Background

Previous TXT optimization work caused several user-visible failures:

1. TXT content failed to load when transform options were disabled because `display_fragments` from `/txt-segments` was ignored and the reader expected `segments` only.
2. TXT pages showed only one or two lines because pagination was computed from inaccurate capacity assumptions instead of the actual reader viewport.
3. The reader initially showed a small provisional total, then switched to the full total and returned to the first page because page-map hydration overwrote the current location.
4. Space and arrow navigation sometimes required multiple presses because overlapping async page movement requests completed out of order.
5. After jumping far into a book, Space appeared to move by lines instead of pages because the segment window start and current page state were no longer aligned.

These failures share one theme: optimization changed timing and data flow without preserving the TXT reader's core invariants.

## Goals

- Keep TXT content visible for both transformed and untransformed text.
- Preserve measured, viewport-based pagination.
- Keep the user's current reading location stable when full-book page maps hydrate.
- Ensure keyboard and jump navigation apply only the latest movement request.
- Keep segment window state and current page state aligned after near and far navigation.
- Add regression tests that encode the known failures.
- Reduce unnecessary recomputation only inside those safety boundaries.

## Non-Goals

- No EPUB optimization.
- No Dashboard refactor.
- No broad TXT reader rewrite.
- No new runtime dependency.
- No aggressive prefetch or cache layer.
- No persisted progress schema change unless a narrow compatibility fix requires it.

## Recommendation

Use a stability-first optimization pass:

1. Add tests for the known TXT regressions.
2. Clarify the segment normalization contract.
3. Add guards around measured pagination and page-map promotion.
4. Make page movement latest-request-wins.
5. Apply only small memoization or recomputation reductions that do not change the reader model.

This is safer than a structural refactor because the current risk is state desynchronization, not missing abstractions.

## Architecture

The TXT reader pipeline should be treated as:

```text
/txt-segments response
  -> normalized display fragments
  -> segment window selection
  -> measured pagination from real viewport metrics
  -> current anchor mapping
  -> rendered page surfaces
```

Each stage has a clear contract.

### Segment normalization

`useTxtSegmentWindow.js` should normalize `/txt-segments` responses before the reader uses them.

Rules:

- If `display_fragments` exists and contains displayable content, it is the render source.
- If `display_fragments` is absent, fall back to `segments`.
- If both are empty, represent that as an empty document or normalization failure, not as a generic transport failure.
- Transform options must not decide whether `display_fragments` is allowed to render.

This contract prevents the "file contents failed to load" regression caused by ignoring valid display fragments.

### Measured pagination

`txtPageMetrics.js` and the measured pagination helpers must continue to use actual reader dimensions and typography settings:

- viewport width and height
- page padding and margins
- font family and font size
- line height and letter spacing
- single or dual layout constraints
- column or spread gap

Estimated or provisional maps may support temporary loading states, but they must not be promoted to authoritative rendered pages if measured viewport capacity is invalid or unstable.

This contract prevents pages with only one or two visible lines.

### Reading location

`TxtReader.jsx` should treat page index as a derived display coordinate, not the only source of truth.

The reader should preserve an anchor for the current location, such as a segment id plus source or display offset. When a full page map hydrates, the reader maps the anchor into the new page map instead of blindly reusing a stale page index.

Rules:

- Page-map hydration may improve total pages.
- Hydration must not move the user to the first page unless the current anchor genuinely resolves there.
- If the exact anchor is missing, land on the nearest valid page within the current or requested segment window.

This contract prevents provisional page totals from overwriting the user's actual position.

### Navigation concurrency

Keyboard movement, progress seeks, and distant jumps should use one movement path with latest-request-wins semantics.

Rules:

- Every async movement request receives a monotonic request id.
- A request may update state only if it is still the latest request when it completes.
- Older movement results must be ignored if a newer Space, arrow, seek, or jump request has started.
- Window hydration after a jump must align the loaded segment window and current page before keyboard navigation is re-enabled for that location.

This contract prevents stale navigation results from making Space or arrow keys appear unresponsive.

## Component Impact

### `frontend/src/hooks/useTxtSegmentWindow.js`

- Clarify or extract response normalization.
- Prefer `display_fragments` for rendering when present.
- Keep `segments` as fallback only.
- Expose enough stable metadata for anchor and window alignment.

### `frontend/src/components/TxtReader.jsx`

- Preserve current location through an anchor during page-map changes.
- Gate movement result application by latest request id.
- Avoid letting full-book hydration overwrite current location.
- Keep the reader's current page and segment window aligned after distant jumps.

### `frontend/src/lib/txtPageMetrics.js`

- Keep viewport-derived metrics as the source for authoritative pagination.
- Guard against invalid or implausibly small page capacity.
- Avoid promoting provisional metrics to stable pagination.

### Tests

Prefer small lib and hook tests when possible. Use `TxtReader.segmented.test.jsx` only for integration regressions that require the component.

## Error Handling

The reader should distinguish these states internally:

- API request failed.
- API succeeded but the document is empty.
- API succeeded but response normalization produced no displayable fragments.
- Viewport metrics are not ready.
- Measured pagination failed or produced no valid page.

The user-facing message can remain simple, but code paths must not collapse all of these into the same "load failed" condition. That distinction is what lets tests catch a normalization regression before it reaches the UI.

## Testing Strategy

Add or update tests for these contracts:

1. A `/txt-segments` response with `display_fragments` renders content even when transform options are disabled.
2. A response without `display_fragments` falls back to `segments`.
3. Pagination does not accept viewport metrics that would create one-line or two-line pages as stable authoritative pages.
4. Full page-map hydration preserves the current anchor instead of resetting to page one.
5. Fast repeated Space or arrow requests apply only the latest movement result.
6. Distant page jumps align the segment window start and current page before later keyboard movement.

Verification order:

1. Run targeted TXT lib and hook tests.
2. Run targeted TXT reader component tests.
3. Run the full frontend test suite with `npm run test`.

## Optimization Boundaries

Allowed optimizations:

- Avoid repeated normalization of identical segment responses.
- Memoize measured pagination inputs when viewport, typography, layout, and segment data are unchanged.
- Reduce duplicate page-map rebuilds during a single navigation request.
- Skip applying state updates that do not change the current anchor, page, or window.

Disallowed in this pass:

- Replacing measured pagination with character-count estimates.
- Introducing a new cache that can serve stale page maps across typography or viewport changes.
- Rewriting TXT rendering around a new data model.
- Changing EPUB, ZIP, or Dashboard behavior.
- Adding new dependencies.

## Rollout Plan

1. Capture current TXT test behavior and note any pre-existing failures.
2. Add regression tests for segment normalization and navigation/page-map invariants.
3. Implement the smallest code changes needed to satisfy those tests.
4. Add local memoization or recomputation guards only after the stability tests pass.
5. Re-run targeted TXT tests and the full frontend test suite.

## Risks

- Existing uncommitted changes touch TXT reader files, so implementation must preserve user work and avoid broad rewrites.
- Some viewport measurement behavior is difficult to test in JSDOM and may require deterministic helper seams.
- Anchor mapping can be ambiguous if a target segment is no longer in the loaded window.

## Mitigations

- Keep changes localized to TXT reader, TXT hooks, TXT metrics helpers, and related tests.
- Prefer pure helper tests for normalization and request ordering.
- Use nearest valid page fallback when exact anchor mapping is unavailable.
- Treat invalid metrics as "not ready" instead of producing a misleading page map.

## Decision

Proceed with a TXT-only stability-first optimization pass. The implementation should protect the five known regressions before making any performance-oriented changes.
