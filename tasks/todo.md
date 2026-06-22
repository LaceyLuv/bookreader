# BookReader Todo

Last updated: 2026-06-22

This file tracks current build-readiness work only. Old clean-stack migration notes were removed because the app now has working backend, web frontend, Tauri desktop, sidecar packaging, TXT/EPUB/ZIP readers, annotations, search, custom fonts, and reader settings.

## Recently Completed

- [x] TXT measured pagination uses viewport-derived metrics instead of fixed character/page chunks.
- [x] TXT search/result jumps preserve the target render page and highlight, including far segment jumps before the full page map finishes hydrating.
- [x] TXT tests run serially to avoid shared jsdom/browser mock interference across test files.
- [x] EPUB chapter HTML is sanitized before visible rendering and offscreen measurement.
- [x] Tauri CSP is no longer `null`; executable content, frames, objects, and base URL injection are blocked.
- [x] Sidecar packaging preflight succeeds and the packaged backend responds to `/api/health`.
- [x] Removed stale `uvicorn.protocols.websockets.wsproto_impl` hidden import from the PyInstaller spec.
- [x] TXT segmented tests no longer print the expected 404 navigation mock error.
- [x] Packaged sidecar data now resolves to app data or `BOOKREADER_DATA_DIR`; local `books/` and `fonts/` are no longer bundled.
- [x] Full desktop build produces `BookReader_0.1.1_x64-setup.exe`.
- [x] Installed desktop smoke verifies `/api/health` and normal window close terminates the PyInstaller sidecar process tree.
- [x] Installed desktop API smoke with isolated `BOOKREADER_DATA_DIR` covers TXT, EPUB, ZIP, search, annotations, custom font upload/download, and close-process cleanup.
- [x] Defer Tauri package updates for this release-candidate pass; keep `2.10.x` stable until the visual WebView smoke is complete.
- [x] Added a small EPUB reader component regression test for TOC/chapter loading and sanitized chapter rendering.
- [x] Visual WebView smoke on the installed desktop app covers dashboard rendering, TXT body/search/settings/font controls, EPUB image rendering, and ZIP dual-page image rendering.

## Build-Readiness Checklist

- [x] Backend tests: `python -m pytest backend/tests -q`
- [x] Frontend tests: `cd frontend && cmd /c npm run test`
- [x] Web build: `cd frontend && cmd /c npm run build`
- [x] Tauri environment check: `cd frontend && cmd /c npm run desktop:info`
- [x] Sidecar build: `cd frontend && cmd /c npm run desktop:sidecar`
- [x] Packaged sidecar smoke: run `bookreader-backend-<triple>.exe --host 127.0.0.1 --port <temp>` and verify `/api/health`
- [x] Desktop bundle build: `cd frontend && cmd /c npm run desktop:build`

## Current Follow-Ups

- [ ] Optional release pass: repeat visual WebView smoke from a fresh app-data directory before publishing an installer.

## Latest Artifact Sizes

- Sidecar exe: 19,615,633 bytes.
- Tauri app exe: 10,843,136 bytes.
- NSIS installer: 21,929,388 bytes.

## Useful Commands

```powershell
cd C:\dev\bookreader
python -m pytest backend/tests -q

cd C:\dev\bookreader\frontend
cmd /c npm run test
cmd /c npm run build
cmd /c npm run desktop:info
cmd /c npm run desktop:sidecar
```
