# TXT Reader Selection And Pagination Stabilization Design

## Summary

This document defines the design for fixing three TXT reader regressions that appear to share the same structural cause:

1. Dragging text for highlights causes earlier text to become part of the selection and the selection UI flickers.
2. Text near the bottom of a page can be visually clipped when the available page height is awkward.
3. On initial load, TXT books often report an incorrect total page count, the space bar does not advance immediately, and repeated presses can skip forward by multiple pages at once.

The recommended fix is to replace the current character-count-driven TXT page model with a layout-measured page model, then make selection, progress, and keyboard navigation consume that single source of truth.

## Problem Statement

The current TXT reader mixes multiple incompatible ideas of "page":

- `composeRenderPages()` in `frontend/src/lib/txtRenderPages.js` groups segments by `maxCharactersPerPage`.
- The DOM renders those groups inside fixed-height page surfaces with `overflow: hidden`.
- Navigation, total pages, search jumps, annotation jumps, and persisted reading progress depend on render-page indexes that can change as transformed text or lazily loaded windows arrive.

This creates three failure modes:

- The rendered page can contain more text than fits vertically, so the bottom gets clipped.
- Page totals and current page can shift after initial load or after global page-map hydration, so keyboard navigation can lag and then jump.
- Selection can become unstable because the reader recomputes selection state during drag while other effects may still rewrite DOM for highlights or marks.

## Goals

- Use one page model for TXT rendering, page totals, progress, keyboard navigation, and locator jumps.
- Prevent clipped text at page bottoms.
- Keep selection stable while dragging and only show the selection menu once the selection has settled.
- Preserve existing TXT features: search, annotations, progress restore, dual-page spreads, whitespace compaction, and paragraph splitting.
- Avoid regressions in EPUB behavior.

## Non-Goals

- Rework EPUB pagination.
- Redesign the reader UI or annotation UX.
- Change persisted progress storage format unless needed for compatibility.

## Current Root Cause

### 1. Pagination is based on estimated character count, not rendered height

The TXT reader currently composes pages before layout using a constant `DEFAULT_TXT_RENDER_PAGE_SIZE`. This ignores:

- viewport height
- margins and padding
- current font family and font size
- line height and letter spacing
- single vs dual layout
- transformed display text from `trimSpaces` and `splitParagraphs`

As a result, a "page" in state is only an estimate and may not match what the user can actually see.

### 2. Page totals become temporarily inconsistent during lazy loading

The reader derives total pages from local render pages until the full-book page-start map is eventually built. That means:

- initial total pages can be wrong
- current viewport page can be remapped after hydration
- navigation can react to stale totals or stale page indexes

This explains the reported "starts at 4 pages", "space does nothing", and "third press jumps ahead multiple pages" behavior.

### 3. Selection is updated too eagerly during drag

`selectionchange` currently recomputes a full selection snapshot during drag and updates menu coordinates immediately. If selection spans changing line wraps or if any DOM-marking effect runs around the same time, the user sees flicker and unstable selection boundaries.

## Proposed Approach

### Recommendation

Adopt a layout-measured TXT pagination pipeline and treat it as the only valid page model in the TXT reader.

This design has two parts:

1. Replace character-count pagination with measured pagination.
2. Stabilize selection capture so the drag gesture is not competing with render updates.

## Architecture

### A. Introduce a measured TXT page map

Replace the current `composeRenderPages()` behavior with a measured paginator that:

- renders candidate TXT content into an off-screen measurement host
- applies the exact same typography, spacing, page padding, and layout constraints as the on-screen page
- appends segments in order until the measured content would exceed the available page height
- emits a page boundary before overflow

The produced page map becomes the single source of truth for:

- visible page surfaces
- total TXT pages
- current TXT page index
- keyboard next/previous navigation
- progress bar seeking
- search jump resolution
- annotation jump resolution
- persisted reading progress restoration

### B. Allow long segments to split inside a page

A single segment can be taller than the viewport. To avoid clipping, measured pagination must support splitting a segment into page slices.

The page map should therefore support entries like:

- `segmentId`
- `sliceStart`
- `sliceEnd`
- `sourceStartOffset`
- `sourceEndOffset`

This allows one logical segment to appear across multiple measured pages without relying on CSS clipping.

### C. Separate visible page calculation from global page hydration

The reader should maintain two related but distinct concepts:

- `visibleMeasuredPages`: the measured pages for the currently loaded TXT window
- `globalMeasuredPageIndex`: the optional full-book page-start index, loaded lazily for accurate totals and direct page seeking

Rule:

- Current visible page movement must always be driven by the currently measured visible pages.
- Global hydration may improve total page accuracy, but it must never retroactively jump the current reading position.

### D. Stabilize selection capture

Selection handling should move from "every `selectionchange` mutates reader state immediately" to a staged flow:

1. Track whether a pointer drag is currently active inside the TXT content root.
2. Ignore transient `selectionchange` updates while drag is still in progress.
3. On `pointerup` or a short idle boundary, read a final selection snapshot once.
4. Render `ReaderSelectionMenu` only from that settled snapshot.

This prevents the menu from chasing every drag-frame update and reduces visual flicker.

## Data Model Changes

Introduce a TXT measured page shape similar to:

```js
{
  page: 12,
  slices: [
    {
      segmentId: 44,
      sliceStart: 0,
      sliceEnd: 180,
      sourceStartOffset: 1200,
      sourceEndOffset: 1380,
      text: "..."
    },
    {
      segmentId: 45,
      sliceStart: 0,
      sliceEnd: 90,
      sourceStartOffset: 1381,
      sourceEndOffset: 1471,
      text: "..."
    }
  ],
  firstSegmentId: 44,
  firstSourceOffset: 1200,
  lastSegmentId: 45,
  lastSourceOffset: 1471
}
```

This shape should replace the assumption that a page is just an array of whole segments.

## Component Responsibilities

### `TxtReader.jsx`

- Stop treating `renderPages` as a simple character-bucket result.
- Consume measured page slices.
- Keep current page stable while background totals are hydrating.
- Derive progress and keyboard navigation from the measured page model only.
- Delay settled selection snapshot updates until drag completion.

### `txtRenderPages.js`

- Replace character-count composition with measurement-driven pagination helpers.
- Add support for segment slicing.
- Provide locator helpers that map annotations and search hits to measured page indexes.

### `annotationSelection.js`

- Continue returning normalized selection metadata, but selection should be captured only after the drag settles.
- When selection is inside a sliced segment, compute offsets against the original segment offsets rather than the visible slice text only.

### `useTxtSegmentWindow.js`

- Continue loading segment windows, but do not let lazy window loads redefine the current visible page unexpectedly.
- Expose enough information for the reader to rebuild a measured page map safely after window changes.

### `useReadingProgress.js`

- No storage-schema change is required initially.
- Progress writes should continue storing page index and total pages, but page updates must only occur after measured pagination has stabilized for the current book state.

## Navigation Rules

### Initial load

- Load manifest and initial TXT window.
- Build measured pages for the visible window before enabling user-visible page counts and keyboard page movement.
- If a saved position exists, resolve it against the measured page model first.
- If a full-book measured index is still loading, keep the current position stable and mark totals as provisional internally.

### Space bar / next page

- Space bar must always advance exactly one measured page from the current visible page.
- If the next measured page is outside the current segment window, load the required window, rebuild measured pages, and advance once.
- Repeated key presses must not queue stale page indexes from a provisional total.

### Search and annotation jumps

- Search results and annotations should resolve to the measured page containing the target source offset.
- After a jump, the reader may continue hydrating the global page index, but must not remap the user away from the landed page.

## Selection Rules

- Only TXT reader selection logic changes.
- Existing annotation and search marks must not rewrite the DOM during an active text drag.
- The selection menu must anchor to the final selection rect after drag settlement.
- If the user changes page, opens panels, or commits a note/highlight, selection clears as it does today.

## Error Handling

- If measured pagination fails, fall back to a safe whole-segment page grouping rather than rendering clipped overflow silently.
- If a locator cannot be resolved exactly, land on the nearest measured page containing the target segment.
- If a saved progress position points beyond the rebuilt measured page count, clamp to the last valid page without jumps.

## Testing Strategy

Add or update TXT reader tests to cover:

1. Initial load uses measured page totals and does not report provisional multi-page counts that later collapse.
2. Space bar advances one measured page per press from first load.
3. Repeated presses cannot jump multiple pages due to late page-map hydration.
4. Bottom-of-page content is paginated onto the next page instead of being clipped.
5. A long single segment splits into multiple measured pages without content loss.
6. Dragging a highlight does not expand backward into previously rendered text during selection.
7. `trimSpaces` and `splitParagraphs` rebuild measured pagination without desynchronizing progress and current page.
8. Search and annotation jumps land on the correct measured page and keep progress state aligned.

## Rollout Plan

1. Build measured pagination primitives and tests in isolation.
2. Integrate measured pages into `TxtReader`.
3. Switch keyboard navigation and progress to the new page model.
4. Stabilize selection capture and prevent drag-time DOM churn.
5. Re-run TXT reader regression tests for search, annotations, progress restore, and dual layout.

## Risks

- Measurement-driven pagination is more complex than the current character-bucket model.
- Segment slicing introduces new locator and annotation edge cases.
- JSDOM-based tests may need deterministic measurement helpers or mocking to keep pagination tests stable.

## Mitigations

- Keep the measured paginator in a small dedicated module with pure helpers around page metadata.
- Add targeted tests around slice boundaries and locator mapping.
- Isolate DOM measurement behind a wrapper so tests can stub measured heights.

## Decision

Proceed with a measured TXT page model plus settled-selection capture. This is the smallest design that plausibly fixes all three reported regressions without leaving the TXT reader split across incompatible pagination rules.
