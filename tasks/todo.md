# BookReader ??Tasks Todo

## Clean Stack Migration (2026-03-01)
- [x] Legacy 諛깆뾽 (backend ??legacy/backend_legacy, frontend ??legacy/frontend_legacy)
- [x] ??FastAPI backend ?ㅼ펷?덊넠 ?앹꽦
- [x] ??React+Vite frontend ?ㅼ펷?덊넠 ?앹꽦
- [x] API 寃利?(/api/health, /api/books)
- [x] ?꾨줈?앺듃 臾몄꽌 ?뺣━ (AGENT_HANDOFF.md, AGENTS.md 媛깆떊)

## ?ㅼ쓬 留덉씠洹몃젅?댁뀡 (TODO)
- [ ] backend: models.py 蹂듭썝 (BookMeta, TxtContent, EpubToc, EpubChapter, ZipImageList)
- [ ] backend: routers/books.py 蹂듭썝 (CRUD + ?щ㎎蹂?API)
- [ ] backend: services/ 蹂듭썝 (txt_service, epub_service, zip_service)
- [ ] backend: requirements.txt??chardet, ebooklib, lxml, beautifulsoup4, natsort 異붽?
- [ ] frontend: react-router-dom ?ㅼ젙
- [ ] frontend: Dashboard ?섏씠吏
- [ ] frontend: TxtReader / EpubReader / ZipReader 而댄룷?뚰듃
- [ ] frontend: ReaderToolbar / ReaderProgressBar / ResumeToast
- [ ] frontend: hooks (useReaderSettings, useReadingProgress, useKeyboardNav)
- [ ] frontend: ?뚮쭏 ?쒖뒪??(themes.js, appChrome.js)
- [ ] frontend: apiBase.js (Tauri ?고???遺꾧린)
- [ ] frontend: i18n (?ㅺ뎅??吏??

## Review
- Legacy 肄붾뱶 蹂댁〈 ?꾨즺, ???ㅽ깮 ?숈옉 寃利??꾨즺
- AGENT_HANDOFF.md???꾩껜 援ъ“/API/?ㅼ젙 臾몄꽌???꾨즺

## Theme/EPUB/Font Work (2026-03-02)
- [ ] backend: EPUB asset endpoint (`GET /api/books/{book_id}/asset/{asset_path:path}`) 異붽?
- [ ] backend: EPUB chapter HTML/CSS URL rewrite + inline style ?⑹꽦
- [ ] backend: ?ъ슜???고듃 ?낅줈??議고쉶/?쒕튃 ?쇱슦??`/api/fonts`) 異붽?
- [ ] backend: startup ??`books/`, `fonts/` ?붾젆?좊━ ?앹꽦 蹂댁옣
- [ ] frontend: ReaderToolbar?먯꽌 old theme key 踰꾪듉 洹몃９ ?쒓굅 (Theme Presets only)
- [ ] frontend: ?ㅼ젙??`fontMode`, `fontFamily` 異붽? 諛????蹂듭썝
- [ ] frontend: ?고듃 紐⑸줉 議고쉶/?낅줈??UI + `@font-face` ?숈쟻 二쇱엯 ?곌껐
- [ ] frontend: Txt/Epub?먯꽌 fontMode蹂?font-family ?곸슜 遺꾧린
- [ ] frontend: EPUB ?대?吏/figure ?쒖떆 蹂댁젙 CSS 異붽?
- [ ] build 寃利?諛?寃곌낵 ?뺣━


## Theme/EPUB/Font Work Review (2026-03-02)
- [x] backend: EPUB asset endpoint (`GET /api/books/{book_id}/asset/{asset_path:path}`) 추가
- [x] backend: EPUB chapter HTML/CSS URL rewrite + inline style 합성
- [x] backend: 사용자 폰트 업로드/조회/서빙 라우터(`/api/fonts`) 추가
- [x] backend: startup 시 `books/`, `fonts/` 디렉토리 생성 보장
- [x] frontend: ReaderToolbar old theme key 버튼 제거 (Theme Presets only)
- [x] frontend: 설정에 `fontMode`, `fontFamily` 추가 및 저장/복원
- [x] frontend: 폰트 목록 조회/업로드 UI + `@font-face` 동적 주입 연결
- [x] frontend: Txt/Epub에서 fontMode별 font-family 적용 분기
- [x] frontend: EPUB 이미지/figure 표시 보정 CSS 추가
- [x] frontend: build 검증 완료

## EPUB Page Count Bugfix Plan (2026-03-03)
- [x] Reproduce and inspect current EPUB bottom-bar/page metrics path (frontend + backend contract).
- [x] Identify root cause of `?` total pages and `3-page` ceiling behavior.
- [x] Implement minimal fix without adding dependencies and keep theme/settings structure unchanged.
- [x] Verify Web(Vite proxy) build and no regression in TXT/ZIP progress bars.
- [x] Write review notes (root cause, changed files, validation results).

## EPUB Page Count Bugfix Review (2026-03-03)
- Root cause 1: backend EPUB TOC parser only consumed top-level nav entries and skipped nested children.
- Root cause 2: frontend EPUB progress bar passed `totalPages={null}`, so bottom total was always shown as `?`.
- Fix summary:
  - backend/services/epub_service.py: add recursive TOC entry flattener and consume nested nav entries in `_toc_from_nav`.
  - frontend/src/components/EpubReader.jsx: initialize/update `totalChapters` from chapter API `total` and pass `totalPages={totalChapters}` + `onSeekPage` to `ReaderProgressBar`.
- Validation:
  - Web build (`npm.cmd run build`) succeeded with Vite.
  - No runtime dependency added.

## ReaderProgressBar UX Update Plan (2026-03-03)
- [x] Reduce vertical height of bottom progress bar without changing existing behavior.
- [x] Add top-center V-shaped collapse button on progress bar.
- [x] Add bottom-edge ^-shaped restore button when bar is collapsed (hover to reveal).
- [x] Verify Web(Vite proxy) build and basic TXT/EPUB/ZIP reader rendering.
- [x] Write review notes (files changed, validation result).

## ReaderProgressBar UX Update Review (2026-03-03)
- Changed file: frontend/src/components/ReaderProgressBar.jsx
- Applied minimal UI-only change:
  - Reduced bar vertical footprint (`py`, text sizes, slider/input heights) while preserving seek/page-input behavior.
  - Added top-center `V` collapse button to hide the bar.
  - Added collapsed bottom-edge hover trigger that reveals `^` restore button.
- Validation:
  - Web build (`npm.cmd run build`) succeeded with Vite.
  - No runtime dependency added.

## Font Select Display Bugfix Plan (2026-03-03)
- [x] Reproduce and locate why selected font field text is fixed to RIDIBatang.
- [x] Apply minimal fix so selected font field reflects currently selected font family.
- [x] Verify Web(Vite proxy) build and ensure no reader font regression.
- [x] Write review notes (root cause, changed files, validation).

## Font Select Display Bugfix Review (2026-03-03)
- Root cause: settings panel root style uses `SETTINGS_FONT_FAMILY` (RIDIBatang-first), and font select control had no overriding font style, so selected-value text always rendered as RIDIBatang.
- Fix summary:
  - frontend/src/components/ReaderToolbar.jsx:
    - added `selectedBuiltinFontFamily` and `selectedFontPreviewFamily` derived from current selected font.
    - applied `fontFamily: selectedFontPreviewFamily` to the font `<select>` style.
- Validation:
  - Web build (`npm.cmd run build`) succeeded with Vite.
  - No runtime dependency added.

## Font Select Display Follow-up Plan (2026-03-03)
- [x] Investigate remaining mismatch between selected font state and selected `<select>` display text.
- [x] Normalize selected value mapping for legacy/derived fontFamily values with minimal diff.
- [x] Verify Web(Vite proxy) build and font selection behavior.
- [x] Record review + lessons.

## Font Select Display Follow-up Review (2026-03-03)
- Root cause: `select.value` could be bound to a raw/legacy `fontFamily` string that did not match any `<option>` value, causing browser fallback to first option (`RIDIBatang`) in the selected-font field.
- Fix summary:
  - frontend/src/components/ReaderToolbar.jsx:
    - detect when `fontFamily` equals one of builtin family strings and normalize it to builtin option value (`__builtin:...`).
    - use normalized `selectedFontValue` for controlled `<select>` binding.
    - keep preview `fontFamily` logic while using normalized selected state.
- Validation:
  - Web build (`npm.cmd run build`) succeeded with Vite.
  - Added correction pattern to `tasks/lessons.md`.

## Tauri Init Plan (2026-03-03)
- [x] Initialize Tauri v2 structure in current Vite repo (`frontend/src-tauri` + wrapper script).
- [x] Configure `tauri.conf.json` with `beforeDevCommand`, `beforeBuildCommand`, `beforeBundleCommand`, `devUrl`, `frontendDist`, `externalBin`.
- [x] Add `desktop:dev`, `desktop:build`, `desktop:info` scripts in frontend `package.json`.
- [x] Ensure sidecar build hook target exists (`backend/build_sidecar.ps1`, spec file).
- [x] Verify resulting structure and summarize run steps.

## Tauri Init Review (2026-03-03)
- Added Tauri v2 project structure under `frontend/src-tauri` (Cargo, Rust entrypoints, capabilities, configs, binaries placeholder).
- Added `frontend/scripts/tauri-wrapper.cjs` to run Tauri with stable `CARGO_TARGET_DIR`.
- Updated `frontend/package.json` scripts:
  - `desktop:dev`
  - `desktop:build`
  - `desktop:info`
- `tauri.conf.json` now includes:
  - `beforeDevCommand`
  - `beforeBuildCommand`
  - `beforeBundleCommand`
  - `devUrl`
  - `frontendDist`
  - `bundle.externalBin`
- Added sidecar prebundle hook targets:
  - `backend/build_sidecar.ps1`
  - `backend/bookreader-backend.spec`
- Validation:
  - Web build (`npm.cmd run build`) succeeded with Vite.
  - file/config presence verified.
  - `npm run desktop:info` command path verified (script invoked), but full Tauri execution timed out in current environment (CLI not locally resolved during run).

## Sidecar Build Script Plan (2026-03-03)
- [x] Add `backend/.venv` recreation script for deterministic backend build env.
- [x] Keep/verify `bookreader-backend.spec` in backend.
- [x] Ensure `build_sidecar.ps1` executes PyInstaller and uses backend venv first.
- [x] Ensure output is copied to `frontend/src-tauri/binaries/bookreader-backend-<target-triple>.exe`.
- [x] Validate script/config consistency and record review.

## Sidecar Build Script Review (2026-03-03)
- Added `backend/recreate_venv.ps1`:
  - recreates `backend/.venv` (`-Force` supported),
  - installs `requirements.txt`,
  - installs `pyinstaller`.
- Verified `backend/bookreader-backend.spec` exists and targets `run_server.py` -> `bookreader-backend.exe`.
- Updated `backend/build_sidecar.ps1` python resolution order:
  - `backend/.venv` first,
  - then root `.venv`,
  - then `py -3`, `python`.
- Confirmed output copy target in `build_sidecar.ps1`:
  - `frontend/src-tauri/binaries/bookreader-backend-<target-triple>.exe`
- Validation:
  - both PowerShell scripts parse successfully (`[scriptblock]::Create(...)`).


## Optimization Plan (2026-03-07)
- [x] Defer non-critical EPUB total-page measurement so initial chapter render is prioritized.
- [x] Stream backend file uploads and block silent duplicate filename overwrites.
- [x] Clear EPUB service caches when library files change.
- [x] Reduce synchronous `localStorage` write pressure from reader progress/settings updates.
- [x] Remove low-value EPUB debug/runtime drift and verify web build.

## Optimization Review (2026-03-07)
- EPUB reader:
  - delayed background full-book page counting with idle scheduling so first chapter render wins.
  - removed frontend debug overlay/log snapshot path.
- Backend uploads:
  - books now stream to disk and reject duplicate filenames with HTTP 409 instead of silent overwrite.
  - font uploads now hash/write incrementally through a temp file instead of reading full content into memory.
  - EPUB caches are cleared when EPUB library files are added/removed.
  - backend EPUB temp debug log writes now stay off unless `BOOKREADER_EPUB_DEBUG=1`.
- Reader state:
  - debounced settings/progress persistence and flush on `pagehide`.
  - normalized legacy `spread` layout to current `dual`.
  - removed redundant TXT delayed re-measure path.
- Validation:
  - `python -m compileall backend` succeeded.
  - `cmd /c npm run build` succeeded.
