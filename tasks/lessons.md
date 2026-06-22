# Lessons Learned

## 2026-03-03
- When fixing a controlled `<select>` display issue, verify both:
  - visual font styling (`fontFamily`), and
  - `value` to `<option>` mapping consistency.
- If settings can contain legacy derived values (for example, stored `fontFamily` strings),
  normalize them to current option values before binding to `select.value`.

## 2026-04-22
- When changing TXT readers to consume `display_fragments`, verify pagination with real viewport dimensions, not only character-count heuristics in unit tests.
- For reader regressions, test both the data contract and the rendered page density so fixes do not accidentally explode page counts.
- If TXT next/prev navigation depends on a full-book page map, preload it on first open or let edge navigation trigger the same loading path without requiring a progress-bar seek first.
