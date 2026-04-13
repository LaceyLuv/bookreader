# TXT Reader Layout Recovery Design

## Context

The current TXT reader regressed in two user-visible ways:

1. Opening a TXT file often shows only a single sentence on each visible page.
2. The reader UI no longer resembles the previous clean open-book layout with only a center crease. Instead, each visible sentence is rendered inside a boxed card.

The current implementation in `frontend/src/components/TxtReader.jsx` renders fetched TXT segments directly as viewport pages. That couples backend transport segments to the reading surface. It also styles each segment with its own border, radius, padding, and translucent card background, which produces the boxed layout regression.

## Goals

- Restore a viewport-based reading experience for TXT files.
- Ensure a visible page is filled with continuous text, not limited to a single fetched segment.
- Restore the clean open-book look for dual-page mode, with only the center crease separating the left and right pages.
- Keep search, annotations, resume, and progress consistent after the layout recovery.

## Non-Goals

- No redesign of EPUB or ZIP readers.
- No backend format changes unless a frontend-only recovery proves impossible.
- No unrelated reader toolbar or library UI refactor.

## Requirements

### Reading surface

- Single-page mode must render one continuous TXT page.
- Dual-page mode must render exactly two visible pages inside one shared book surface.
- Page content must flow naturally across segment boundaries.
- Short segments must not create mostly empty pages.
- Long segments may span multiple rendered pages.

### Visual layout

- Remove per-segment boxed card styling from the TXT reading surface.
- Apply page padding, paper styling, and layout framing at the page level, not the segment level.
- Restore a shared spread layout where the center crease is the only deliberate divider in dual-page mode.

### Navigation and state

- Previous/next navigation must operate on rendered viewport pages, not raw segment IDs.
- Space/page-turn navigation must move by the visible rendered page set.
- Progress bar, resume position, and bookmarks must track rendered page positions.
- Search and annotations may continue to store segment-based locators, but opening a result must resolve to the rendered page that contains that locator.

## Proposed Approaches

### Approach A: Visual-only rollback

Remove the segment card styles and keep using each fetched segment as a displayed page.

- Pros: smallest code change.
- Cons: does not solve the root cause of one-sentence pages; progress and navigation remain segment-driven.

### Approach B: Render-page reconstruction

Keep backend segments as fetch units, but rebuild visible TXT pages in the frontend based on the current viewport, typography, and layout settings.

- Pros: fixes the reading model and the empty-page problem at the correct boundary.
- Cons: requires changes to page calculation, navigation, progress, and locator resolution.

### Approach C: Render-page reconstruction plus spread layout restoration

Do everything in Approach B, and also restore the TXT surface to a true open-book spread with shared framing and a center crease.

- Pros: addresses both functional regression and UI regression together.
- Cons: slightly broader frontend change than Approach B alone.

## Recommendation

Adopt Approach C.

The regression is structural, not cosmetic. TXT transport segments are currently being treated as reader pages. A CSS-only rollback would leave the core pagination problem unresolved. Reconstructing viewport pages while restoring the spread layout returns the reader to the expected mental model: segments are implementation detail, pages are what the user reads.

## Design

### 1. Separate transport segments from rendered pages

`useTxtSegmentWindow` should continue to load a window of nearby TXT segments for performance. However, `TxtReader` must stop rendering each `visibleViewportSegment` as one page.

Instead, the reader should build rendered page models from the loaded segment buffer:

- input: loaded segments plus current typography/layout settings
- output: one or two rendered pages for the current viewport, each containing continuous text assembled from one or more segments

This makes backend segments a data source rather than a UI unit.

### 2. Rebuild page composition around viewport capacity

Rendered TXT pages should be composed according to available page capacity, derived from:

- current layout (`single` or `dual`)
- page width and height
- content font size and font family
- line height and letter spacing
- horizontal and vertical margins

The renderer should keep appending text across segment boundaries until the current page is full, then continue on the next rendered page. If a segment is too large, it can be split across multiple rendered pages. If a segment is short, the next segment should continue on the same rendered page.

### 3. Restore open-book layout

The TXT reading surface should be rendered as a single shared book wrapper:

- one page surface in single mode
- two page surfaces in dual mode
- a center crease in dual mode
- no border/radius/background around each source segment

Page-level padding belongs to the page surface. Segment-level card styling must be removed from the reading content.

### 4. Align navigation with rendered pages

The reader state should use rendered page indices for user-facing movement:

- `goNext` and `goPrev` move by visible rendered page set
- progress bar seeks by rendered page index
- bookmarks and resume store rendered page position

Internally, the reader may still map rendered pages back to segment offsets so the correct buffer window can be loaded when the user jumps.

### 5. Resolve search and annotations through page mapping

Search results and annotations can continue using segment-oriented locators because those locators are already compatible with backend search and persistence.

When opening a search result or annotation:

- locate the segment/offset target
- map it to the rendered page that contains that offset
- open that rendered page
- apply highlight inside the visible page content

This preserves current storage semantics while making the visible reader page-centric again.

## Component Impact

### `frontend/src/components/TxtReader.jsx`

- replace direct segment-as-page rendering
- render page surfaces derived from composed viewport pages
- move spread styling to page/surface wrapper level
- update navigation and displayed progress wiring

### Supporting hooks/utilities

Likely additions or refactors:

- TXT page composition helper for turning buffered segments into rendered pages
- mapping helper from segment locator to rendered page index
- optional viewport measurement helper if composition depends on live dimensions

### Tests

Update TXT tests so they verify the recovered behavior:

- multiple short segments can appear on the same visible page
- dual mode renders a shared spread with two visible pages
- visible page movement is based on rendered pages, not raw segment boundaries
- search and annotation jumps resolve to the page that contains the target
- segment card borders/backgrounds are no longer part of the TXT page content structure

## Error Handling

- If the segment buffer is temporarily incomplete for a requested rendered page, show the current loading state and hydrate the page once the required segments arrive.
- If locator mapping fails, fall back to the nearest rendered page containing the closest known segment offset.
- If live measurement is unavailable during first paint, use a deterministic provisional layout and recompose after measurement stabilizes.

## Verification Plan

- Open a TXT file composed of many short lines and confirm each page fills with continuous text.
- Switch between single and dual layout and confirm dual mode shows a shared spread with only a center crease.
- Use next/previous, space, and progress seek to verify navigation follows rendered pages.
- Jump from search results and annotations to confirm the correct rendered page opens and highlights remain visible.
- Confirm existing EPUB and ZIP behavior is unchanged.

## Risks

- Recomposition based on live layout settings can introduce flicker if measurement and rendering are not staged carefully.
- Progress migration from segment-based positions to rendered-page positions may require a fallback path for old saved positions.
- Search and annotation highlighting must remain stable when a target appears inside text stitched from multiple segments.

## Rollout Notes

- Keep the backend TXT segment windowing contract unchanged if possible.
- Land the recovery behind the existing TXT reader path without changing EPUB or ZIP codepaths.
- Prefer small focused helpers so the reader component does not absorb all pagination logic.
