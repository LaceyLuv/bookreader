# BookReader Todo

Last updated: 2026-07-13

This file tracks current build-readiness work only. Old clean-stack migration notes were removed because the app now has working backend, web frontend, Tauri desktop, sidecar packaging, TXT/EPUB/ZIP readers, annotations, search, custom fonts, and reader settings.

## Recently Completed

- [x] Large TXT reading is bounded-memory, uses sparse byte/character indexes, and preserves segmented search/jump behavior.
- [x] Locator v2 and quote-based re-anchoring cover TXT, EPUB, and ZIP while retaining legacy fallbacks.
- [x] Delete recovery journals books, annotations, and reading progress; backup/restore validates hashes and store schemas.
- [x] In-book search is cancellable; TXT encoding preview/override and no-newline files are covered.
- [x] EPUB/ZIP validation reports actionable archive diagnostics and rejects unsafe or oversized entries.
- [x] Reader layout/settings share `ReaderShell`; keyboard navigation is suspended while dialogs and panels own focus.
- [x] Annotation Markdown/JSON export preserves exact text and locators without exposing local file paths.
- [x] Future store versions fail closed without rewriting the primary file or recovering from an older backup.
- [x] Packaged data moved away from the NSIS install directory with a resumable, allowlisted, source-preserving migration.
- [x] PyInstaller UTF-8 bootloader mode works from a Korean executable path; managed filenames stay within Windows component limits.
- [x] Sidecar termination, restart diagnostics, random-port nonce authentication, verified process-tree cleanup, and forced-desktop-exit watchdog are covered.
- [x] Authenticode, release identity, downgrade, report kind/version/case/freshness/hash binding, and updater prerequisites are enforced by fail-closed profiles.

## Build-Readiness Checklist

- [x] Backend tests: 212 passed with `python -m pytest backend/tests -q`
- [x] Frontend tests: 228 passed across 40 files with `cd frontend && npm test -- --run`
- [x] Web build: `cd frontend && cmd /c npm run build`
- [x] Rust tests/check: 13 library tests plus `cargo check --release`
- [x] Development release policy: 7/7 checks passed
- [x] Migration fixtures: 4/4 cases passed against the final desktop and `lib.rs` SHA-256 values
- [x] Windows desktop/sidecar fault smoke: 15/15 cases passed against the final sidecar and desktop SHA-256 values
- [x] Candidate readiness: 34/34 checks passed; stale or incomplete fault reports are rejected
- [x] Desktop bundle build: `cd frontend && cmd /c npm run desktop:build`
- [x] Public readiness fails closed for the intentionally unsigned developer artifacts

## Current Follow-Ups

- [ ] Choose and freeze the legal publisher and final Tauri identifier.
- [ ] Acquire a trusted Windows code-signing certificate and HTTPS RFC 3161 timestamp service, then run `npm run desktop:release:signed`.
- [ ] Run the clean-VM Windows 10/11 matrix, including Defender/SmartScreen, WebView2 offline behavior, upgrade, downgrade rejection, and uninstall data preservation.
- [ ] Keep the runtime updater disabled until updater-key recovery, N/N-1/N-2 migration fixtures, a verified pre-update snapshot, and a signed rollback drill all pass for version 0.1.1.

## Latest Artifact Sizes

- Sidecar exe: 20,746,123 bytes.
- Tauri app exe: 10,944,000 bytes.
- NSIS installer: 23,160,950 bytes.

## Useful Commands

```powershell
cd C:\dev\bookreader
python -m pytest backend/tests -q

cd C:\dev\bookreader\frontend
cmd /c npm run test
cmd /c npm run build
cmd /c npm run desktop:info
cmd /c npm run desktop:sidecar
cmd /c npm run desktop:migration-fixtures
cmd /c npm run desktop:fault-smoke
cmd /c npm run desktop:release:check
```
