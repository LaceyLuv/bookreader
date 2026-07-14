# Desktop Build Guide (Windows)

Last updated: 2026-07-14

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

`desktop:build` is an unsigned developer build. Do not publish it. Public builds must use `npm run desktop:release:signed` and satisfy [windows-release.md](windows-release.md).

Build pipeline:
- `beforeBuildCommand`: `npm run desktop:sidecar && npm run build:desktop`
- Rust release build
- Sidecar generation runs inside `beforeBuildCommand` via `npm run desktop:sidecar`
- NSIS installer bundling
- `scripts/package-shortcut-guide.mjs` copies the bundled shortcut guide beside the installer with the application version in its filename

## 3) Sidecar build flow

`backend/build_sidecar.ps1` does:
1. Picks Python executable:
- `backend\.venv\Scripts\python.exe` first, otherwise `python`
2. Runs PyInstaller with `backend/bookreader-backend.spec`
3. Produces `backend/dist-sidecar/bookreader-backend.exe`
4. Reads host triple using `rustc --print host-tuple`, with a `rustc -Vv` `host:` fallback for older Rust toolchains
5. Copies to:
- `frontend/src-tauri/binaries/bookreader-backend-<triple>.exe`

Runtime data:
- Source/dev runs use `backend/books`, `backend/fonts`, `backend/library.json`, and `backend/annotations.json`.
- Tauri packaged runs explicitly pass `app_local_data_dir()` as `BOOKREADER_DATA_DIR`; mutable data never belongs beside installed binaries.
- Standalone sidecar smokes must always set an isolated `BOOKREADER_DATA_DIR`.
- Existing `%LOCALAPPDATA%\BookReader` data is allowlist-copied through a resumable, source-preserving one-time migration with a per-file SHA-256 journal. A destination containing only the backend's exact empty default stores is safely cleared before migration; real conflicting data or invalid journals fail closed.
- Local `books/` and `fonts/` folders are not bundled into the sidecar.

## 4) Where to find build outputs

Check host triple:

```powershell
rustc --print host-tuple
```

If `host-tuple` is unavailable, use:

```powershell
rustc -Vv
```

and read the `host:` value.

Outputs:
- Frontend dist: `frontend/dist/`
- Sidecar exe: `frontend/src-tauri/binaries/bookreader-backend-<triple>.exe`
- Desktop app exe: `frontend/src-tauri/target/release/Gyeol.exe`
- NSIS installer: `frontend/src-tauri/target/release/bundle/nsis/*-setup.exe`
- Separately distributed shortcut guide: `frontend/src-tauri/target/release/bundle/nsis/글결_<version>_단축키_안내.txt`

The canonical UTF-8 guide is `frontend/src-tauri/resources/글결_단축키_안내.txt`. Tauri includes that file in the installed application resources, while the packaging script makes an exact versioned copy beside the NSIS installer. Edit only the canonical file; never maintain the release copy by hand.

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
6. Confirm the UI does not show a backend diagnostic and can list/open books.
7. Confirm the versioned shortcut guide exists beside the installer and opens as Korean UTF-8 text.
8. Close app and verify sidecar process is terminated.

Packaged builds use a random loopback port and a per-launch nonce. Port `8000` is debug-only; do not expose or log the release nonce just to probe the installed app. Build the desktop first, then use `npm run desktop:migration-fixtures` and `npm run desktop:fault-smoke` for authenticated, migration, and forced-exit checks.

The Windows sidecar is a PyInstaller onefile process tree. Desktop exit cleanup must terminate the launched sidecar and its worker process; checking only the direct child can miss a leftover backend.

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
npm run tauri -- icon src-tauri/icons/gyeol-icon-master.png
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

### F) Windows signing or updater readiness fails

Run `npm run desktop:release:check`, then follow `docs/windows-release.md`. Never bypass failed signature, timestamp, migration, or rollback checks with `--no-sign` for a public artifact.
