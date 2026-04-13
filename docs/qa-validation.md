# TXT Compatibility QA Validation

This note covers TXT compatibility QA and final verification for the reader, including the TXT recovery work from Task 5.

## Verification context

Run the TXT compatibility validation with the backend command from the repository root, then run the frontend checks and production build from `frontend/`:

```powershell
python -m pytest backend/tests/test_txt_transform_service.py backend/tests/test_books_txt_manifest_api.py backend/tests/test_search_service.py -v
cmd /c npx vitest run src/lib/txtDisplayMapper.test.js src/components/TxtReader.segmented.test.jsx src/components/TxtReader.anchor.test.jsx
cmd /c npm run build
```

## TXT recovery manual QA

Use a large `.txt` file so the recovered paged-reader behavior is easy to see.

1. Open the TXT book and confirm the first screen lands inside a single paged viewport instead of a scrollable document.
1. Open the TXT book and confirm the initial page total does not briefly inflate to an obviously wrong count before settling.
1. Hide the bottom bar and show it again, then confirm the visible paragraph stays anchored and the reader returns to the same page.
1. Click the bottom progress slider once so it is the most recently used control, then press `Space`, and confirm the reader advances to the next TXT page instead of leaving the slider or button highlighted.
1. Press `Space` repeatedly from the first TXT page and confirm each key press advances exactly one page with no delayed multi-page jump.
1. Open the TXT file again and confirm the first page appears quickly and the first page-turn or search interaction responds normally without an obvious multi-second stall while the reader recovers the initial render page.
1. Switch TXT layout from `single` to `dual` and confirm the view becomes a true two-page spread.
1. Use the bottom progress slider or a typed page number to jump and confirm the visible TXT text and progress bar move together to the same target viewport page.
1. Open TXT search results and annotation items and confirm each jump lands on the expected visible viewport page.
1. For a far search result, confirm the reader stays on the target page even if the full-book page map is still loading in the background.
1. Drag-select text near the top and bottom of a TXT page and confirm the selection menu appears only after the drag settles, without earlier text being pulled into the selection or the highlight UI flickering.
1. Open a TXT page where the last paragraph sits close to the bottom edge and confirm the final visible line moves onto the next page instead of being clipped.

## TXT compatibility mode

1. Open a dense TXT file with repeated inline spaces and confirm `공백 정리` visibly collapses space runs without changing the logical reading position.
1. Open a TXT file with three or more consecutive blank lines and confirm the behavior is validated with `공백 정리` / trim-spaces enabled, since `remove-empty-lines` is coupled to that toggle and reduces them to a single paragraph break without creating duplicate empty pages.
1. Open a dense single-block paragraph with minimal manual line breaks and confirm `문단 나누기` inserts readable breaks while the same search result, annotation jump, and bookmark still land in the correct visible place.
1. Toggle compatibility options on and off while staying in the same reading area and confirm the reader remains near the same logical position instead of jumping to an unrelated section.
1. Run TXT search after toggling each compatibility option and confirm highlight placement matches the transformed text currently shown in the reader.
