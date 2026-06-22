# Performance And Package Size Plan

Last updated: 2026-05-19

This plan tracks performance and package-size work for the current BookReader architecture: React/Vite frontend, FastAPI backend, Tauri v2 desktop shell, and PyInstaller Python sidecar.

## Current Baseline

Recent local validation:

- Web build passed with Vite.
- Frontend tests passed: 16 files, 92 tests.
- Backend tests passed: 21 tests.
- Sidecar build passed.
- Packaged sidecar health smoke passed on a temporary local port.
- Sidecar binary: 19,615,633 bytes on Windows x64.
- NSIS installer: 21,926,267 bytes on Windows x64.

The largest package-size contributor remains the PyInstaller sidecar, not the Vite frontend.

## Current Architecture Constraints

- The backend still needs Python dependencies for FastAPI, Uvicorn, EPUB parsing, charset detection, BeautifulSoup, and related parsing libraries.
- Tauri desktop launches the Python sidecar and talks to it through localhost.
- EPUB assets and user fonts are served by the backend.
- TXT reader performance depends on segmented loading and measured pagination rather than loading one giant DOM.
- EPUB first-render performance depends on not blocking the first chapter on full-book page counting.

## Completed Improvements

- TXT uses segmented loading and measured pagination.
- TXT page-map hydration preserves reading anchors.
- EPUB page count work is deferred so first chapter rendering is prioritized.
- Uploads stream to disk and duplicate filename handling exists in backend/library flow.
- Reader settings/progress writes are debounced.
- EPUB caches are cleared after library mutations.
- PyInstaller output was reduced by removing local `books/` and `fonts/` data from bundled datas and removing an unused `wsproto_impl` import.
- Packaged runs now resolve mutable data to app data or `BOOKREADER_DATA_DIR`.
- Tauri CSP is explicit instead of disabled.
- Sidecar preflight now includes an executable health smoke.

## Open Performance Work

### P1. Build Metrics

Record metrics for every release-candidate build:

- `frontend/dist` size.
- Sidecar exe size.
- NSIS installer size.
- `npm run build` duration.
- `npm run desktop:sidecar` duration.
- `npm run desktop:build` duration.

Suggested command:

```powershell
cd C:\dev\bookreader\frontend
npm run perf:report
```

If that script is out of date, update it before relying on historical comparisons.

### P1. Sidecar Contents Review

Review whether the sidecar should package `books` and `fonts` as data. For releases, user data should usually be initialized in an app data directory rather than bundled into the installer.

Decision needed:

- Keep bundled folders as empty placeholders.
- Or remove them from PyInstaller `datas` and ensure runtime startup creates user-data folders.

Required validation:

- Fresh install can upload books and fonts.
- Existing local development data is not accidentally bundled.
- Desktop app still opens after install.

### P2. PyInstaller Trim

The spec should remain an allowlist. Any hidden import removal must be followed by:

```powershell
cd C:\dev\bookreader\frontend
cmd /c npm run desktop:sidecar
```

Then smoke:

```powershell
<sidecar exe> --host 127.0.0.1 --port <temp>
Invoke-RestMethod http://127.0.0.1:<temp>/api/health
```

Do not chase every PyInstaller warning. Many are optional, platform-specific, or from dependency plugin hooks. Treat warnings as actionable only when they correspond to an imported runtime path used by this app.

### P2. Desktop Startup Time

Measure:

- Time to Tauri window visible.
- Time to sidecar `/api/health`.
- Time to library list rendered.
- Time to first TXT/EPUB/ZIP content rendered.

Target direction:

- Keep first readable content fast even if background pagination or asset preparation continues.
- Avoid blocking startup on full-library scans, full-book EPUB measurement, or expensive cache warming.

### P3. Alternative Packaging Experiments

Only consider these after the baseline release path is stable:

- Compare PyInstaller `onefile` vs `onedir`.
- Move more desktop-only logic into Tauri/Rust commands.
- Replace the Python sidecar for select hot paths.

These are architecture decisions, not quick cleanup tasks.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Over-trimming PyInstaller imports | Desktop starts but fails on reader-specific paths | Rebuild sidecar and smoke TXT/EPUB/ZIP flows |
| Bundling local `books`/`fonts` data | Private/dev files can leak into installer | Inspect `datas`, release artifacts, and app-data initialization |
| Full-book pagination blocks first render | EPUB/TXT feels slow | Keep background page-map work cancellable/deferred |
| CSP too strict | EPUB assets or custom fonts fail to load | Test EPUB images/fonts and local API calls after CSP changes |
| CSP too loose | EPUB HTML can execute unsafe content | Keep sanitizer and CSP checks together |

## Release Gate

Before calling a desktop build ready:

- Backend tests pass.
- Frontend tests pass.
- Web build passes.
- `desktop:info` passes.
- `desktop:sidecar` passes.
- Packaged sidecar `/api/health` smoke passes.
- `desktop:build` passes.
- Installed app manually opens TXT, EPUB, and ZIP.
- App close terminates sidecar.
