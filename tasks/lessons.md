# Lessons Learned

## 2026-03-03
- When fixing a controlled `<select>` display issue, verify both:
  - visual font styling (`fontFamily`), and
  - `value` to `<option>` mapping consistency.
- If settings can contain legacy derived values (for example, stored `fontFamily` strings),
  normalize them to current option values before binding to `select.value`.
