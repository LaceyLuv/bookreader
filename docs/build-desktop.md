# Desktop Build Guide (Windows)

This document describes how to run and build the Tauri desktop app, how the Python sidecar is produced, where outputs are written, and what to check after install.

## 1) Run desktop:dev

```powershell
cd C:\dev\bookreader\frontend
npm install
npm run desktop:dev
```

What this does:
- Starts Vite dev server.
- Starts backend Python server from `backend/run_server.py --host 127.0.0.1 --port 8000` via `scripts/tauri-wrapper.cjs`.
- Runs Tauri in dev mode (debug config).

Optional:
- Set `BOOKREADER_PYTHON` to force a specific Python executable.

## 2) Run desktop:build

```powershell
cd C:\dev\bookreader\frontend
npm run desktop:info
npm run desktop:build
```

Build pipeline:
- `beforeBuildCommand`: `npm run desktop:sidecar && npm run build:desktop`
- Rust release build
- Sidecar generation runs inside `beforeBuildCommand` via `npm run desktop:sidecar`
- NSIS installer bundling

## 3) Sidecar build flow

`backend/build_sidecar.ps1` does:
1. Picks Python executable:
- `backend\.venv\Scripts\python.exe` first, otherwise `python`
2. Runs PyInstaller with `backend/bookreader-backend.spec`
3. Produces `backend/dist-sidecar/bookreader-backend.exe`
4. Reads host triple using `rustc --print host-tuple`
5. Copies to:
- `frontend/src-tauri/binaries/bookreader-backend-<triple>.exe`

## 4) Where to find build outputs

Check host triple:

```powershell
rustc --print host-tuple
```

Outputs:
- Frontend dist: `frontend/dist/`
- Sidecar exe: `frontend/src-tauri/binaries/bookreader-backend-<triple>.exe`
- Desktop app exe: `frontend/src-tauri/target/release/bookreader_desktop.exe`
- NSIS installer: `frontend/src-tauri/target/release/bundle/nsis/*-setup.exe`

Example:

```powershell
Get-ChildItem C:\dev\bookreader\frontend\src-tauri\target\release\bundle\nsis
```

## 5) Post-install smoke test checklist

1. Run installer (`*-setup.exe`) and launch app.
2. Verify main window loads.
3. Upload/open a TXT file.
4. Upload/open an EPUB file and navigate TOC/chapters.
5. Upload/open a ZIP comic and navigate images.
6. While app is running, verify backend health:
- `http://127.0.0.1:8000/api/health`
7. Close app and verify sidecar process is terminated.

## 6) Common failures and fixes

### A) `tauri` command not found
Symptom:
- `'tauri' is not recognized as an internal or external command`

Fix:

```powershell
cd C:\dev\bookreader\frontend
npm install --save-dev @tauri-apps/cli@latest
```

### B) `beforeBuildCommand` fails with `spawn EPERM`
Symptom:
- `failed to load config ...`
- `Error: spawn EPERM`

Fix order:
1. Confirm script is `build:desktop` with `vite build --configLoader runner`.
2. Run in host Windows terminal (not restricted sandbox).
3. Check esbuild binary:

```powershell
cd C:\dev\bookreader\frontend
.\node_modules\.bin\esbuild --version
```

4. If esbuild command fails:

```powershell
npm rebuild esbuild --foreground-scripts
```

5. If still failing, do clean reinstall:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm ci
```

### C) Missing icon (`src-tauri/icons/icon.ico`)
Fix:

```powershell
cd C:\dev\bookreader\frontend
npm run tauri -- icon app-icon.svg
```

### D) Sidecar missing/copy failure
Symptoms:
- `resource path binaries\bookreader-backend-<triple>.exe doesn't exist`
- `sidecar output not found after copy`

Fix:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\bookreader\backend\build_sidecar.ps1
```

Then verify file exists in `frontend/src-tauri/binaries/`.

### E) Rust compile errors around dev-only APIs
Symptom example:
- `open_devtools` method compile error

Fix:
- Guard dev-only code with `#[cfg(debug_assertions)]` so release build does not compile that code path.
