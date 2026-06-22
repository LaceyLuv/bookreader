# QA Validation

Last updated: 2026-06-22

This document lists the validation steps for build-readiness and reader regression checks.

## Automated Baseline

Run from the repository root unless noted.

```powershell
cd C:\dev\bookreader\backend
pip install -r requirements-dev.txt

cd C:\dev\bookreader
python -m pytest backend/tests -q

cd C:\dev\bookreader\frontend
cmd /c npm run test
cmd /c npm run build
cmd /c npm run desktop:info
cmd /c npm run desktop:sidecar
```

For a release candidate, also run:

```powershell
cd C:\dev\bookreader\frontend
cmd /c npm run desktop:build
```

## Packaged Sidecar Smoke

After `desktop:sidecar`, run the copied binary on a temporary port and verify `/api/health`.

```powershell
cd C:\dev\bookreader
$exe = Resolve-Path "frontend/src-tauri/binaries/bookreader-backend-x86_64-pc-windows-msvc.exe"
$proc = Start-Process -FilePath $exe -ArgumentList @("--host","127.0.0.1","--port","8765") -WorkingDirectory (Resolve-Path "backend") -WindowStyle Hidden -PassThru
Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/health"
Stop-Process -Id $proc.Id -Force
```

## TXT Manual QA

Use a large `.txt` file.

1. Confirm the first screen is paged, not a scroll document.
2. Confirm page count does not briefly show an obviously wrong total.
3. Hide and restore the bottom bar; the visible text should stay anchored.
4. Press `Space` after interacting with the progress bar; the reader should advance.
5. Press `Space` rapidly; each press should move forward without stale jumps.
6. Switch between single and dual layout; visible text and progress should stay aligned.
7. Use progress seek, typed page seek, search result click, bookmark, and annotation jump.
8. Toggle TXT compatibility options and confirm search highlights match transformed text.
9. Check a page with a paragraph near the bottom edge; no final line should be clipped.

## EPUB Manual QA

Use an EPUB containing images, styles, and multiple chapters.

1. Open TOC and navigate between chapters.
2. Confirm image and font assets load through `/api/books/{book_id}/asset/...`.
3. Confirm custom reader font mode and embedded font mode both work.
4. Search within the EPUB and verify result jumps/highlights.
5. Create, edit, recolor, and delete an annotation.
6. Confirm unsafe chapter HTML does not execute scripts or event handlers.
7. Confirm pagination and progress remain coherent after changing font size, margins, line height, and layout.

## ZIP Manual QA

Use a ZIP comic/image archive.

1. Confirm images are sorted naturally.
2. Navigate next/previous in single layout.
3. Switch to dual layout and confirm image pairing is stable.
4. Confirm progress and typed page seek match the visible image.

## Desktop Install Smoke

After `desktop:build`:

1. Install with the NSIS installer.
2. Launch the app and confirm the main window loads.
3. Confirm backend health at `http://127.0.0.1:8000/api/health`.
4. Open TXT, EPUB, and ZIP books.
5. Close the app and confirm no sidecar process remains.

## Installed App API Smoke

Use an isolated `BOOKREADER_DATA_DIR` so the installed app and sidecar run normally without mutating the user's real app data. Verify:

1. `/api/health` returns `ok: true`.
2. TXT, EPUB, ZIP, and a custom font upload successfully.
3. TXT content, transformed manifest/segments, and search return expected data.
4. EPUB TOC, chapter HTML, search, and at least one rewritten asset URL return expected data.
5. ZIP image listing and first image bytes return expected data.
6. Annotation create, patch, list, delete, and empty-after-delete all persist.
7. Font list and font download return expected data.
8. Normal window close leaves no `bookreader-backend` process.

Latest installed API smoke result, 2026-06-20:
- Books listed: 3 (`txt,epub,zip`).
- TXT: 688,013 chars, 15,302 transformed segments, search query `서장` returned 2 results.
- EPUB: 219 TOC items/chapters, search query `주의사항` returned 1 result, asset response returned 5,679,660 bytes.
- ZIP: 608 images, first image response returned 49,655 bytes.
- Font upload/download returned 58,920 bytes.
- Annotation delete left 0 annotations.
- Normal close left 0 backend processes.

Latest installed visual WebView smoke result, 2026-06-22:
- Dashboard loaded in the installed Tauri WebView and listed 4 books.
- TXT reader opened a large UTF-16 sample, rendered paged dual-column text, and showed coherent progress controls.
- TXT search panel opened with the expected in-book search input and empty-query state.
- Reader settings opened with language, font family, font upload count, embedded-font mode, weight, colors, theme preset, and spacing controls.
- EPUB reader opened an EPUB sample and rendered the cover image through the app WebView with toolbar controls present.
- ZIP reader opened a 608-image archive and rendered a dual-page comic spread with progress controls.
