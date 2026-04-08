# QA Validation Guide

This guide captures the minimum reproducible QA flow for the current web and desktop build paths.

## Scope

- Web: verify frontend production build and record generated artifact sizes.
- Desktop: verify Tauri CLI availability, inspect config via `desktop:info`, and optionally run the full desktop build.
- Output: write logs and summary files under `output/qa/<timestamp>/`.

## Prerequisites

```powershell
cd C:\dev\bookreader\frontend
npm install
```

Expected local binaries after install:
- `frontend/node_modules/.bin/vite.cmd`
- `frontend/node_modules/.bin/tauri.cmd`

If either binary is missing, the QA script fails early with an actionable message instead of proceeding to a less clear build error.

## Run

Web build plus desktop info:

```powershell
cd C:\dev\bookreader\frontend
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\qa-validate.ps1
```

Full run including desktop build:

```powershell
cd C:\dev\bookreader\frontend
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\qa-validate.ps1 -IncludeDesktopBuild
```

## Output files

- `output/qa/<timestamp>/summary.txt`
- `output/qa/<timestamp>/web-build.log`
- `output/qa/<timestamp>/desktop-info.log`
- `output/qa/<timestamp>/desktop-build.log` when `-IncludeDesktopBuild` is used

## Review checklist

- Web
  - `npm run build` exits `0`
  - `frontend/dist/` exists
  - `summary.txt` lists the largest generated files for quick size review
- Desktop
  - `npm run desktop:info` exits `0`
  - `npm run desktop:build` is only considered valid when explicitly run with `-IncludeDesktopBuild`
  - Sidecar and installer presence should be checked in `frontend/src-tauri/target/` after a successful desktop build

## Current known blockers

- If `npm install` has not been run in `frontend`, both web and desktop validation fail before meaningful build verification starts.
- In this environment, `CI=1` causes `tauri build` to fail with `invalid value '1' for '--ci'`; the current Tauri CLI expects `true` or `false`.
- Desktop validation also depends on the local Rust/Tauri toolchain and Python sidecar prerequisites documented in [build-desktop.md](/C:/dev/bookreader/.climpire-worktrees/54ee3095/docs/build-desktop.md).
## Large TXT segmented-reader checklist

- Open a TXT file larger than 5 MB and confirm the first visible text appears without locking the UI.
- Search for a word with many hits and click a result near the end of the list; expected result is a direct jump without a whole-page freeze.
- Add a highlight on a searched segment, reload the page, and confirm the annotation still lands on the same text.
- Toggle `trimSpaces` and `splitParagraphs` after several search jumps; expected result is no full-document stutter and the visible segment remains stable.
