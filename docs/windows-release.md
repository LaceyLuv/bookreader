# Windows release security and updater readiness

Last updated: 2026-07-13

Gyeol Reader (`글결`) currently ships by manual update. The runtime updater is intentionally not installed or configured. A public installer must be code-signed, fault-tested, and built through the fail-closed release command below; `desktop:build` remains an unsigned developer build.

Official references:

- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)

## Stable release identity

Before the first public signed beta, choose and keep all of these values stable:

- Tauri `identifier`
- `bundle.publisher`, matching the legal certificate subject and not equal to `productName`
- `productName`
- NSIS `currentUser` install scope

The repository intentionally does not invent the publisher identity. Public release policy fails until the chosen values are supplied through `BOOKREADER_RELEASE_IDENTIFIER` and `BOOKREADER_RELEASE_PUBLISHER` and match `tauri.conf.json`.

The installer policy explicitly sets `allowDowngrades: false` and `installMode: currentUser`. Changing either after release can break upgrade continuity or permit an older binary to open newer data.

The private-alpha brand is `글결`, with English name `Gyeol Reader` and main executable `Gyeol.exe`. The compatibility identifier remains `com.bookreader.desktop` so existing development data and WebView storage keep the same identity; it is not yet a promise of the final public publisher identity.

An older `BookReader` development install and a `글결` private-alpha install can coexist while sharing that data identity. Do not run both at the same time. Before switching, create a full in-app backup, close both the desktop and sidecar processes, uninstall the old development build without selecting app-data deletion, install `글결`, and verify the library, progress, annotations, fonts, and restore flow.

## Code-signing inputs

The included release build supports a certificate with a private key in `Cert:\CurrentUser\My`. Set these only in the release terminal or secret-backed CI environment:

```powershell
$env:BOOKREADER_RELEASE_IDENTIFIER = "com.example.bookreader"
$env:BOOKREADER_RELEASE_PUBLISHER = "Chosen Publisher"
$env:BOOKREADER_WINDOWS_CERTIFICATE_THUMBPRINT = "40_OR_64_HEX_DIGITS"
$env:BOOKREADER_WINDOWS_TIMESTAMP_URL = "https://your-ca-rfc3161-timestamp"
$env:TAURI_WINDOWS_SIGNTOOL_PATH = "C:\Program Files (x86)\Windows Kits\10\bin\...\x64\signtool.exe" # optional when discoverable
```

Do not commit a PFX, private updater key, certificate password, local release overlay, or `.env` containing these values. The script validates the certificate EKU, private key, expiry, signer thumbprint, Authenticode status, and trusted timestamp. It requires the desktop executable, PyInstaller sidecar, and NSIS installer to share the same signer.

Modern hardware- or cloud-held certificates may require a provider-specific Tauri `signCommand`. That path must be added deliberately and must still produce artifacts that pass `release-readiness.ps1`; do not weaken the verification gate.

## Commands

Safe configuration baseline:

```powershell
cd C:\dev\bookreader\frontend
npm run desktop:release:check
```

Migration fixtures and packaged desktop/sidecar fault smoke, using only isolated temporary data roots:

```powershell
npm run desktop:build
npm run desktop:migration-fixtures
npm run desktop:fault-smoke
```

Signed public build:

```powershell
npm run desktop:release:signed
```

The signed build creates a temporary Tauri config overlay, never writes certificate inputs into the repository, builds with Cargo `--locked`, runs the migration fixtures and Windows fault smoke, verifies all signatures and timestamps, and emits SHA-256-bound reports under `reports/release/`. It deletes the temporary overlay in `finally`.

`release-readiness.ps1` has four profiles:

- `Development`: versions, identifier shape, manual-updater state, downgrade policy, and install scope.
- `Candidate`: current build artifacts plus the complete required Windows fault matrix.
- `Public`: candidate gates, the exact migration fixture matrix, and valid, timestamped, single-publisher Authenticode signatures.
- `Updater`: public gates plus updater keys, HTTPS manifest, migration fixtures, and rollback-drill reports.

Candidate readiness binds the fault report to the exact sidecar and desktop SHA-256 values, application version, report kind, required case names, and artifact build time. Public readiness additionally binds migration fixtures to the desktop SHA-256 and `lib.rs` SHA-256. Updater rollback evidence must match the installer SHA-256, current version, required case set, report kind, and build time. Older or generic `passed: true` JSON cannot satisfy these gates.

## Data directory and one-time migration

Packaged Tauri now passes its resolved `app_local_data_dir()` to the sidecar through `BOOKREADER_DATA_DIR`. Mutable data therefore lives under the Tauri application-data identity rather than beside installed binaries.

Older installs may have data mixed into `%LOCALAPPDATA%\BookReader`. Before starting the sidecar, the Rust shell:

1. copies only the data allowlist to a staging directory;
2. rejects symlinks and special files;
3. records every relative path, byte size, and SHA-256 in the pending journal;
4. verifies source, stage, and published manifests and flushes copied files;
5. atomically publishes each top-level allowlisted entry;
6. validates the completed marker before every skip and cleans verified journal residue; and
7. leaves the legacy source untouched.

An interrupted publish resumes only when the pending journal, source, and stage have the same manifest. If legacy and destination data both exist without a valid journal, startup fails closed instead of hiding or overwriting either side. Executables, the uninstaller, WebView files, and unknown entries are never copied. If migration cannot complete, the backend does not start and the UI explains that the original data was preserved.

## Automated Windows fault boundary

`windows-sidecar-fault-smoke.ps1` verifies:

- a Korean executable path;
- an isolated long data root and a managed book path between 240 and 250 characters;
- authenticated health and rejection without the launch nonce;
- library API access from that long path;
- clean process-tree shutdown;
- packaged-desktop forced termination followed by parent-watchdog cleanup of every captured sidecar process;
- missing-sidecar preflight; and
- fail-closed, nonzero startup when the configured data root is a file.

Normal app restart first requires verified sidecar tree cleanup. Separately, the packaged sidecar holds a Windows synchronization handle to its owning desktop and exits if the desktop crashes or is forcibly terminated, covering paths where Tauri cannot emit an exit event.

It never changes real ACLs, fills a disk, disables Defender, creates EICAR, or edits antivirus exclusions. Test actual Defender quarantine, SmartScreen reputation, access-denied ACLs, and offline WebView2 behavior only in a disposable clean VM.

## Updater remains blocked

Code-signing certificates and Tauri updater keys are separate trust systems. Tauri requires update signatures and does not allow disabling verification. Losing the private updater key strands installed clients, so keep two independently protected backups and test restoration before enabling it.

Do not add the updater plugin, capability, `createUpdaterArtifacts`, public key, or endpoint until all of these are true:

- every installed artifact is Authenticode-valid and timestamped;
- release identity and `currentUser` scope are frozen;
- `TAURI_SIGNING_PRIVATE_KEY` custody and recovery have been tested;
- the public key is embedded as content, not a path;
- the update endpoint and artifact URL are HTTPS;
- schema N/N-1/N-2 fixtures reject future stores without rewriting them;
- a verified data-only pre-update snapshot exists;
- upgrade and signed rollback drills pass on a clean VM; and
- the UX is manual opt-in, not an automatic startup check.

When those gates pass, use Tauri v2 artifacts (`createUpdaterArtifacts: true`, not `v1Compatible`) and publish `latest.json` last. Its version must exactly equal the release version, its artifact URL must be HTTPS, and its `signature` field contains non-placeholder literal `.sig` contents rather than a path or URL.

## Manual clean-VM matrix

Before publishing a public installer, record results for:

- Windows 10 and Windows 11, standard user;
- fresh install, same-version reinstall, and N-1 to N update;
- downgrade rejection;
- Korean install/user paths and the long-path fixture;
- online and offline WebView2 bootstrap behavior;
- Defender/SmartScreen and a deliberately missing or quarantined sidecar;
- normal close, in-app restart, and forced desktop termination with no sidecar descendant; and
- uninstall preserving the separate application-data directory unless the user explicitly selects data deletion.
