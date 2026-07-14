import base64
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PROVENANCE_SCRIPT = FRONTEND / "scripts" / "write-release-provenance.ps1"

FAULT_CASES = [
    "windows_host",
    "sidecar_present",
    "desktop_present",
    "unicode_launch_path",
    "long_data_root",
    "missing_sidecar_preflight",
    "authenticated_health",
    "unauthenticated_rejected",
    "isolated_store_initialization",
    "managed_book_path_240_to_250",
    "authenticated_long_path_api",
    "clean_process_tree_shutdown",
    "desktop_spawned_owned_sidecar",
    "desktop_sidecar_hash_matches_release_artifact",
    "desktop_isolated_store_initialization",
    "desktop_crash_watchdog_shutdown",
    "invalid_data_root_fails_closed",
]
MIGRATION_CASES = [
    "legacy_data_migration_is_allowlisted_verified_and_non_destructive",
    "legacy_data_migration_replaces_only_pristine_destination_scaffold",
    "legacy_data_migration_does_not_partially_clear_non_pristine_scaffold",
    "legacy_data_migration_rejects_conflicting_destination_data",
    "legacy_data_migration_rejects_same_size_staged_tampering",
    "legacy_data_migration_rejects_invalid_completed_marker",
]
READINESS_CHECKS = [
    "policy_version_semver",
    "policy_versions_aligned",
    "policy_product_name_frozen",
    "policy_main_binary_name_frozen",
    "policy_identifier_present",
    "policy_downgrades_blocked",
    "policy_install_scope_frozen",
    "policy_runtime_updater_disabled",
    "policy_command",
    "evidence_build_id",
    "evidence_source_commit",
    "evidence_source_branch",
    "evidence_worktree_clean",
    "artifact_shortcut_guide_resource_mapping",
    "artifact_shortcut_guide_source_exists",
    "artifact_shortcut_guide_exists",
    "artifact_sidecar_exists",
    "artifact_sidecar_fresh",
    "artifact_desktop_exists",
    "artifact_desktop_filename",
    "artifact_desktop_product_name",
    "artifact_desktop_fresh",
    "artifact_installer_exists",
    "artifact_installer_product_name",
    "artifact_installer_fresh",
    "artifact_shortcut_guide_hash_matches",
    "artifact_shortcut_guide_fresh",
    "windows_fault_report",
    "windows_fault_kind",
    "windows_fault_application_version",
    "windows_fault_build_id",
    "windows_fault_source_commit",
    "windows_fault_sidecar_sha256",
    "windows_fault_desktop_sha256",
    "windows_fault_fresh",
    "migration_fixtures_report",
    "migration_fixtures_kind",
    "migration_fixtures_application_version",
    "migration_fixtures_build_id",
    "migration_fixtures_source_commit",
    "migration_fixtures_migration_source_sha256",
    "migration_fixtures_desktop_sha256",
    "migration_fixtures_fresh",
    *[f"windows_fault_case_{name}" for name in FAULT_CASES],
    *[f"migration_fixtures_case_{name}" for name in MIGRATION_CASES],
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def _utc_iso(value: datetime | None = None) -> str:
    current = value or datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_unsigned_pe_fixture(path: Path, marker: bytes) -> None:
    data = bytearray(Path(sys.executable).read_bytes())
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    optional_header = pe_offset + 24
    magic = struct.unpack_from("<H", data, optional_header)[0]
    data_directories = optional_header + (96 if magic == 0x10B else 112)
    certificate_entry = data_directories + (8 * 4)
    certificate_offset, certificate_size = struct.unpack_from("<II", data, certificate_entry)
    struct.pack_into("<II", data, certificate_entry, 0, 0)
    if certificate_offset and certificate_offset + certificate_size == len(data):
        del data[certificate_offset:]
    data.extend(marker)
    path.write_bytes(data)


def _authenticode_status(path: Path) -> str:
    quoted_path = str(path).replace("'", "''")
    result = subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            f"(Get-AuthenticodeSignature -LiteralPath '{quoted_path}').Status.ToString()",
        ],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


def _create_provenance_fixture(tmp_path: Path) -> dict:
    repo = tmp_path / "release-source"
    repo.mkdir()
    (repo / ".gitignore").write_text("evidence/\n", encoding="utf-8")
    migration_source = repo / "frontend" / "src-tauri" / "src" / "lib.rs"
    migration_source.parent.mkdir(parents=True)
    migration_source.write_text("pub fn migration_fixture_marker() {}\n", encoding="utf-8")
    tauri_cli = repo / "frontend" / "scripts" / "tauri-cli.cjs"
    tauri_cli.parent.mkdir(parents=True)
    tauri_cli.write_text("console.log('tauri-cli-test 1.0.0')\n", encoding="utf-8")

    _git(repo, "init")
    _git(repo, "branch", "-M", "main")
    _git(repo, "config", "user.email", "release-test@example.invalid")
    _git(repo, "config", "user.name", "Release Test")
    _git(repo, "add", ".gitignore", "frontend/src-tauri/src/lib.rs", "frontend/scripts/tauri-cli.cjs")
    _git(repo, "commit", "-m", "release fixture")
    commit = _git(repo, "rev-parse", "HEAD")

    evidence = repo / "evidence"
    evidence.mkdir()
    sidecar = evidence / "bookreader-backend-test.exe"
    desktop = evidence / "Gyeol.exe"
    installer = evidence / "Gyeol-test-setup.exe"
    started_at = _utc_iso(datetime.now(timezone.utc) - timedelta(minutes=1))
    _write_unsigned_pe_fixture(sidecar, b"sidecar-fixture")
    _write_unsigned_pe_fixture(desktop, b"desktop-fixture")
    _write_unsigned_pe_fixture(installer, b"installer-fixture")
    artifacts_completed_at = _utc_iso()
    tool_names = ["powershell", "git", "node", "npm", "python", "pyinstaller", "rustc", "cargo", "tauri"]
    build_environment = {
        "captured_at": artifacts_completed_at,
        "host": {"os": "Windows test fixture", "version": "1", "architecture": "AMD64"},
        "tools": {name: {"path": f"C:/fixture/{name}.exe", "version": "1.0.0", "sha256": None} for name in tool_names},
        "scripts": {
            "orchestrator_sha256": _sha256(FRONTEND / "scripts" / "build-windows-release.ps1"),
            "provenance_finalizer_sha256": _sha256(PROVENANCE_SCRIPT),
        },
    }
    build_environment_base64 = base64.b64encode(
        json.dumps(build_environment, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")

    build_id = str(uuid4())
    application_version = "1.2.3"
    source = {"commit": commit, "branch": "main"}
    generated_at = _utc_iso()
    fault_report = evidence / "fault.json"
    migration_report = evidence / "migration.json"
    readiness_report = evidence / "readiness.json"
    output = evidence / "provenance.json"

    artifact_entries = []
    for name, path in (("sidecar", sidecar), ("desktop", desktop), ("installer", installer)):
        artifact_entries.append(
            {
                "name": name,
                "path": str(path.resolve()),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
                "built_at": _utc_iso(datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)),
            }
        )

    _write_json(
        fault_report,
        {
            "schema_version": 1,
            "kind": "bookreader-windows-fault-smoke",
            "application_version": application_version,
            "build_id": build_id,
            "source": source,
            "generated_at": generated_at,
            "passed": True,
            "sidecar_sha256": _sha256(sidecar),
            "desktop_sha256": _sha256(desktop),
            "cases": [{"name": name, "passed": True, "detail": "fixture"} for name in FAULT_CASES],
            "failure": None,
        },
    )
    _write_json(
        migration_report,
        {
            "schema_version": 1,
            "kind": "bookreader-windows-migration-fixtures",
            "application_version": application_version,
            "build_id": build_id,
            "source": source,
            "generated_at": generated_at,
            "passed": True,
            "migration_source_sha256": _sha256(migration_source),
            "desktop_sha256": _sha256(desktop),
            "cases": [{"name": name, "passed": True, "detail": "fixture"} for name in MIGRATION_CASES],
            "failure": None,
        },
    )
    _write_json(
        readiness_report,
        {
            "schema_version": 1,
            "kind": "bookreader-windows-release-readiness",
            "application_version": application_version,
            "profile": "candidate",
            "build_id": build_id,
            "source": source,
            "generated_at": generated_at,
            "passed": True,
            "checks": [{"name": name, "passed": True, "detail": "fixture"} for name in READINESS_CHECKS],
            "artifacts": artifact_entries,
        },
    )

    return {
        "repo": repo,
        "commit": commit,
        "branch": "main",
        "build_id": build_id,
        "application_version": application_version,
        "started_at": started_at,
        "artifacts_completed_at": artifacts_completed_at,
        "build_environment": build_environment,
        "build_environment_base64": build_environment_base64,
        "migration_source": migration_source,
        "sidecar": sidecar,
        "desktop": desktop,
        "installer": installer,
        "fault_report": fault_report,
        "migration_report": migration_report,
        "readiness_report": readiness_report,
        "sidecar_sha256": _sha256(sidecar),
        "desktop_sha256": _sha256(desktop),
        "installer_sha256": _sha256(installer),
        "fault_report_sha256": _sha256(fault_report),
        "migration_report_sha256": _sha256(migration_report),
        "readiness_report_sha256": _sha256(readiness_report),
        "output": output,
    }


def _run_provenance(fixture: dict, *, expected_commit: str | None = None) -> subprocess.CompletedProcess[str]:
    command = [
        shutil.which("powershell") or "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(PROVENANCE_SCRIPT),
        "-Profile",
        "Candidate",
        "-BuildId",
        fixture["build_id"],
        "-ExpectedGitCommit",
        expected_commit or fixture["commit"],
        "-ExpectedGitBranch",
        fixture["branch"],
        "-BuildStartedAtUtc",
        fixture["started_at"],
        "-ArtifactsCompletedAtUtc",
        fixture["artifacts_completed_at"],
        "-BuildEnvironmentBase64",
        fixture["build_environment_base64"],
        "-SidecarPath",
        str(fixture["sidecar"]),
        "-DesktopPath",
        str(fixture["desktop"]),
        "-InstallerPath",
        str(fixture["installer"]),
        "-ExpectedSidecarSha256",
        fixture["sidecar_sha256"],
        "-ExpectedDesktopSha256",
        fixture["desktop_sha256"],
        "-ExpectedInstallerSha256",
        fixture["installer_sha256"],
        "-FaultReportPath",
        str(fixture["fault_report"]),
        "-ExpectedFaultReportSha256",
        fixture["fault_report_sha256"],
        "-MigrationReportPath",
        str(fixture["migration_report"]),
        "-ExpectedMigrationReportSha256",
        fixture["migration_report_sha256"],
        "-ReadinessReportPath",
        str(fixture["readiness_report"]),
        "-ExpectedReadinessReportSha256",
        fixture["readiness_report_sha256"],
        "-OutputPath",
        str(fixture["output"]),
        "-RepositoryRoot",
        str(fixture["repo"]),
        "-ApplicationVersion",
        fixture["application_version"],
    ]
    return subprocess.run(
        command,
        cwd=fixture["repo"],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def test_sidecar_build_detects_rust_target_with_version_fallback():
    script = read_text(BACKEND / "build_sidecar.ps1")

    assert "rustc --print host-tuple" in script
    assert "rustc -Vv" in script
    assert "host:" in script
    assert "Failed to detect Rust target triple" in script


def test_backend_build_and_dev_requirements_are_reproducible():
    build_requirements = read_text(BACKEND / "requirements-build.txt").lower()
    dev_requirements = read_text(BACKEND / "requirements-dev.txt").lower()
    recreate_venv = read_text(BACKEND / "recreate_venv.ps1")

    assert "pyinstaller" in build_requirements
    assert "pytest" in dev_requirements
    assert "httpx" in dev_requirements
    assert "requirements-build.txt" in recreate_venv
    assert "requirements-dev.txt" in recreate_venv
    assert "pyinstaller==6.19.0" in build_requirements


def test_sidecar_build_enforces_the_pinned_pyinstaller_version():
    script = read_text(BACKEND / "build_sidecar.ps1")

    assert "requirements-build.txt must pin pyinstaller" in script
    assert "$pyInstallerVersionExitCode = $LASTEXITCODE" in script
    assert "PyInstaller version mismatch" in script


def test_frontend_perf_report_scripts_have_an_implementation():
    package_json = json.loads(read_text(FRONTEND / "package.json"))
    scripts = package_json["scripts"]
    metrics_script = FRONTEND / "scripts" / "collect-build-metrics.ps1"

    assert metrics_script.exists()
    assert "collect-build-metrics.ps1" in scripts["perf:report"]
    assert "collect-build-metrics.ps1" in scripts["perf:report:web"]
    assert "collect-build-metrics.ps1" in scripts["perf:report:desktop"]


def test_tauri_external_bin_matches_sidecar_build_output_name():
    tauri_config = json.loads(read_text(FRONTEND / "src-tauri" / "tauri.conf.json"))
    build_script = read_text(BACKEND / "build_sidecar.ps1")

    assert tauri_config["bundle"]["externalBin"] == ["binaries/bookreader-backend"]
    assert '"bookreader-backend-" + $targetTriple + ".exe"' in build_script
    assert "bookreader-backend.exe" in build_script


def test_pyinstaller_spec_includes_backend_entrypoints_and_router_imports():
    spec = read_text(BACKEND / "bookreader-backend.spec")

    for import_name in [
        '"main"',
        '"paths"',
        '"models"',
        '"routers.annotations"',
        '"routers.books"',
        '"routers.fonts"',
        '"routers.library_folders"',
        '"services.annotation_store"',
        '"services.annotation_export_service"',
        '"services.library_store"',
        '"services.search_service"',
        '"services.txt_transform_service"',
        '"services.txt_service"',
        '"services.epub_service"',
        '"services.zip_service"',
    ]:
        assert import_name in spec


def test_windows_sidecar_script_documents_platform_limit():
    script = read_text(BACKEND / "build_sidecar.ps1")

    assert "Windows" in script
    assert "PowerShell" in script
    assert "Tauri externalBin" in script


def test_pyinstaller_forces_utf8_before_python_initializes_in_unicode_paths():
    spec = read_text(BACKEND / "bookreader-backend.spec")

    assert '("X utf8", None, "OPTION")' in spec
    assert "interpreter_options" in spec


def test_windows_bundle_policy_blocks_downgrades_and_freezes_current_user_scope():
    config = json.loads(read_text(FRONTEND / "src-tauri" / "tauri.conf.json"))
    windows = config["bundle"]["windows"]

    assert windows["allowDowngrades"] is False
    assert windows["nsis"]["installMode"] == "currentUser"
    assert "updater" not in config.get("plugins", {})
    assert "createUpdaterArtifacts" not in config["bundle"]


def test_tauri_startup_window_is_fitted_before_it_is_shown():
    config = json.loads(read_text(FRONTEND / "src-tauri" / "tauri.conf.json"))
    source = read_text(FRONTEND / "src-tauri" / "src" / "lib.rs")
    main_window = config["app"]["windows"][0]

    assert main_window["width"] == 1200
    assert main_window["height"] == 720
    assert main_window["visible"] is False
    assert "monitor.work_area()" in source
    setup = source[source.index(".setup(|app|"):source.index(".build(tauri::generate_context!())")]
    assert setup.index("fit_startup_window_to_work_area") < setup.index("main_window.show()")


def test_private_alpha_brand_keeps_the_existing_data_identity():
    config = json.loads(read_text(FRONTEND / "src-tauri" / "tauri.conf.json"))
    source = read_text(FRONTEND / "src-tauri" / "src" / "lib.rs")

    assert config["productName"] == "글결"
    assert config["mainBinaryName"] == "Gyeol"
    assert config["identifier"] == "com.bookreader.desktop"
    assert config["app"]["windows"][0]["title"] == "글결"
    assert config["bundle"]["windows"]["nsis"]["installerIcon"] == "icons/icon.ico"
    assert "icons/icon.ico" in config["bundle"]["icon"]
    assert 'LEGACY_DATA_DIR_NAME: &str = "BookReader"' in source


def test_windows_validation_scripts_resolve_the_branded_binary_from_tauri_config():
    for script_name in [
        "release-readiness.ps1",
        "windows-migration-fixtures.ps1",
        "windows-sidecar-fault-smoke.ps1",
    ]:
        script = read_text(FRONTEND / "scripts" / script_name)
        assert "mainBinaryName" in script
        assert "bookreader_desktop.exe" not in script


def test_release_commands_fail_closed_and_verify_all_windows_artifacts():
    package = json.loads(read_text(FRONTEND / "package.json"))
    release_build = read_text(FRONTEND / "scripts" / "build-windows-release.ps1")
    readiness = read_text(FRONTEND / "scripts" / "release-readiness.ps1")
    migration_fixtures = read_text(FRONTEND / "scripts" / "windows-migration-fixtures.ps1")
    policy = read_text(FRONTEND / "scripts" / "release-policy.mjs")

    assert "desktop:release:check" in package["scripts"]
    assert "desktop:release:signed" in package["scripts"]
    assert "bookreader-release-overlay-" in release_build
    assert "finally" in release_build
    assert "--locked" in release_build
    assert "--no-sign" not in release_build
    assert "Get-AuthenticodeSignature" in readiness
    assert "TimeStamperCertificate" in readiness
    assert "sidecar_sha256" in readiness
    assert "desktop_sha256" in readiness
    assert "application_version" in readiness
    assert "bookreader-windows-migration-fixtures" in readiness
    assert "MigrationReportPath" in release_build
    assert "windows-migration-fixtures.ps1" in release_build
    assert "desktop:migration-fixtures" in package["scripts"]
    assert "migration_source_sha256" in migration_fixtures
    assert "--locked" in migration_fixtures
    assert "desktop_isolated_store_initialization" in readiness
    for artifact in ["sidecar", "desktop", "installer"]:
        assert f'"{artifact}"' in readiness
    assert "runtime_updater_disabled" in policy
    assert "TAURI_SIGNING_PRIVATE_KEY" in policy


def test_release_candidate_emits_git_bound_atomic_provenance():
    package = json.loads(read_text(FRONTEND / "package.json"))
    release_build = read_text(FRONTEND / "scripts" / "build-windows-release.ps1")

    assert PROVENANCE_SCRIPT.exists()
    provenance = read_text(PROVENANCE_SCRIPT)
    assert "desktop:release:candidate" in package["scripts"]
    assert "build-windows-release.ps1" in package["scripts"]["desktop:release:candidate"]
    assert "-Profile Candidate" in package["scripts"]["desktop:release:candidate"]
    assert "ValidateSet" in release_build
    assert '"Candidate"' in release_build
    assert '"Public"' in release_build

    for token in [
        "rev-parse",
        "status",
        "--porcelain",
        "write-release-provenance.ps1",
        "-ExpectedGitCommit",
        "-ExpectedGitBranch",
        "-BuildStartedAtUtc",
        "-ArtifactsCompletedAtUtc",
        "-BuildEnvironmentBase64",
        "-SidecarPath",
        "-DesktopPath",
        "-InstallerPath",
        "-ExpectedSidecarSha256",
        "-ExpectedDesktopSha256",
        "-ExpectedInstallerSha256",
        "-FaultReportPath",
        "-ExpectedFaultReportSha256",
        "-MigrationReportPath",
        "-ExpectedMigrationReportSha256",
        "-ReadinessReportPath",
        "-ExpectedReadinessReportSha256",
        "-OutputPath",
    ]:
        assert token in release_build

    for parameter in [
        "Profile",
        "BuildId",
        "ExpectedGitCommit",
        "ExpectedGitBranch",
        "BuildStartedAtUtc",
        "ArtifactsCompletedAtUtc",
        "BuildEnvironmentBase64",
        "SidecarPath",
        "DesktopPath",
        "InstallerPath",
        "ExpectedSidecarSha256",
        "ExpectedDesktopSha256",
        "ExpectedInstallerSha256",
        "FaultReportPath",
        "ExpectedFaultReportSha256",
        "MigrationReportPath",
        "ExpectedMigrationReportSha256",
        "ReadinessReportPath",
        "ExpectedReadinessReportSha256",
        "OutputPath",
        "RepositoryRoot",
        "ApplicationVersion",
    ]:
        assert f"${parameter}" in provenance

    for token in [
        "Get-FileHash",
        "Get-AuthenticodeSignature",
        "bookreader-windows-fault-smoke",
        "bookreader-windows-migration-fixtures",
        "bookreader-windows-release-readiness",
        "clean_at_start",
        "clean_at_end",
        "artifacts_completed_at",
        "verification_completed_at",
        "build_id",
        "sha256",
        "bytes",
    ]:
        assert token in provenance
    assert ".tmp" in provenance or "GetRandomFileName" in provenance
    assert "[IO.File]::Move" in provenance
    assert "UTF8Encoding($false)" in provenance

    for producer_name in [
        "windows-sidecar-fault-smoke.ps1",
        "windows-migration-fixtures.ps1",
        "release-readiness.ps1",
    ]:
        producer = read_text(FRONTEND / "scripts" / producer_name)
        for token in ["$BuildId", "$SourceCommit", "$SourceBranch", "build_id", "source"]:
            assert token in producer

    readiness = read_text(FRONTEND / "scripts" / "release-readiness.ps1")
    assert "bookreader-windows-release-readiness" in readiness
    assert "legacy_data_migration_replaces_only_pristine_destination_scaffold" in readiness
    assert "legacy_data_migration_does_not_partially_clear_non_pristine_scaffold" in readiness
    assert "target\\release\\bookreader-backend.exe" in release_build
    assert "IsPathRooted" in release_build
    assert "Invoke-NativeToHost" in release_build
    assert "BuildEnvironmentBase64" in release_build
    assert "desktop_sidecar_hash_matches_release_artifact" in readiness
    assert "Assert-RequiredCaseMatrix" in provenance
    assert "Assert-RequiredReadinessChecks" in provenance
    assert '@("NotSigned", "Valid")' in provenance


def test_windows_fault_smoke_is_isolated_authenticated_and_non_destructive():
    script = read_text(FRONTEND / "scripts" / "windows-sidecar-fault-smoke.ps1")

    assert "BOOKREADER_DATA_DIR" in script
    assert "BOOKREADER_DESKTOP_FAULT_SMOKE_DATA_DIR" in script
    assert "desktop_isolated_store_initialization" in script
    assert "$env:LOCALAPPDATA =" not in script
    assert "$env:APPDATA =" not in script
    assert "BOOKREADER_SIDECAR_NONCE" in script
    assert "GetTempPath" in script
    assert "managed_book_path_240_to_250" in script
    assert "invalid_data_root_fails_closed" in script
    assert "$null -ne $failureExitCode" in script
    assert "$failureProcess.Handle" in script
    assert "desktop_crash_watchdog_shutdown" in script
    assert "desktop_sidecar_hash_matches_release_artifact" in script
    assert "Get-ProcessTreeSnapshot" in script
    assert "CreationTicks" in script
    assert "taskkill.exe" in script
    assert "Defender" not in script
    assert "EICAR" not in script


def test_tauri_runtime_uses_separate_data_root_and_reports_early_exit():
    source = read_text(FRONTEND / "src-tauri" / "src" / "lib.rs")

    assert 'env("BOOKREADER_DATA_DIR"' in source
    assert 'env("BOOKREADER_PARENT_PID"' in source
    assert "BOOKREADER_DESKTOP_FAULT_SMOKE_DATA_DIR" in source
    assert "resolve_fault_smoke_data_dir" in source
    assert "app_local_data_dir" in source
    assert "LEGACY_MIGRATION_PENDING" in source
    assert "source_preserved: true" in source
    assert "MigrationFileRecord" in source
    assert "collect_pending_migration_manifest" in source
    assert '"sidecar_stop_failed"' in source
    assert "CommandEvent::Terminated" in source
    assert '"sidecar_exited"' in source
    assert "restart_application" in source
    restart_body = source[source.index("fn restart_application"):source.index("fn reserve_loopback_listener")]
    assert restart_body.index("cleanup_backend_runtime") < restart_body.index("app.restart()")


def test_tauri_node_wrappers_do_not_spawn_cmd_through_a_shell():
    cli = read_text(FRONTEND / "scripts" / "tauri-cli.cjs")
    wrapper = read_text(FRONTEND / "scripts" / "tauri-wrapper.cjs")

    for script in [cli, wrapper]:
        assert '"@tauri-apps"' in script
        assert '"tauri.js"' in script
        assert "shell: false" in script


@pytest.mark.skipif(
    os.name != "nt" or shutil.which("powershell") is None or shutil.which("git") is None,
    reason="Windows PowerShell and Git are required for provenance integration tests",
)
def test_release_provenance_records_exact_candidate_evidence(tmp_path):
    fixture = _create_provenance_fixture(tmp_path)

    result = _run_provenance(fixture)

    assert result.returncode == 0, result.stdout + result.stderr
    assert not fixture["output"].read_bytes().startswith(b"\xef\xbb\xbf")
    manifest = json.loads(fixture["output"].read_text(encoding="utf-8-sig"))
    assert manifest["schema_version"] == 1
    assert manifest["kind"] == "bookreader-windows-release-provenance"
    assert manifest["application_version"] == fixture["application_version"]
    assert manifest["profile"] == "candidate"
    assert manifest["passed"] is True
    assert manifest["source"] == {
        "commit": fixture["commit"],
        "branch": fixture["branch"],
        "detached": False,
        "clean_at_start": True,
        "clean_at_end": True,
    }
    assert manifest["build"]["id"] == fixture["build_id"]
    assert _parse_utc(manifest["build"]["started_at"]) == _parse_utc(fixture["started_at"])
    assert _parse_utc(manifest["build"]["artifacts_completed_at"]) == _parse_utc(fixture["artifacts_completed_at"])
    assert manifest["build"]["verification_completed_at"]
    assert manifest["build"]["host"]
    assert manifest["build"]["tools"]

    artifacts = {entry["name"]: entry for entry in manifest["artifacts"]}
    expected_artifacts = {
        "sidecar": fixture["sidecar"],
        "desktop": fixture["desktop"],
        "installer": fixture["installer"],
    }
    assert set(artifacts) == set(expected_artifacts)
    for name, path in expected_artifacts.items():
        assert artifacts[name]["bytes"] == path.stat().st_size
        assert artifacts[name]["sha256"] == _sha256(path)
        assert artifacts[name]["authenticode"]["status"] == "NotSigned"
        assert artifacts[name]["authenticode"]["certificate_table_present"] is False
        assert artifacts[name]["authenticode"]["timestamped"] is False

    expected_reports = {
        "fault": fixture["fault_report"],
        "migration": fixture["migration_report"],
        "readiness": fixture["readiness_report"],
    }
    assert set(manifest["reports"]) == set(expected_reports)
    for name, path in expected_reports.items():
        assert manifest["reports"][name]["bytes"] == path.stat().st_size
        assert manifest["reports"][name]["sha256"] == _sha256(path)
        assert manifest["reports"][name]["passed"] is True
    assert manifest["reports"]["fault"]["binds"] == {
        "sidecar_sha256": _sha256(fixture["sidecar"]),
        "desktop_sha256": _sha256(fixture["desktop"]),
    }
    assert manifest["reports"]["migration"]["binds"] == {
        "desktop_sha256": _sha256(fixture["desktop"]),
        "migration_source_sha256": _sha256(fixture["migration_source"]),
    }
    assert manifest["reports"]["readiness"]["binds"] == {
        "sidecar_sha256": _sha256(fixture["sidecar"]),
        "desktop_sha256": _sha256(fixture["desktop"]),
        "installer_sha256": _sha256(fixture["installer"]),
    }


@pytest.mark.skipif(
    os.name != "nt" or shutil.which("powershell") is None or shutil.which("git") is None,
    reason="Windows PowerShell and Git are required for provenance integration tests",
)
def test_release_provenance_rejects_a_damaged_authenticode_candidate(tmp_path):
    fixture = _create_provenance_fixture(tmp_path)
    signed_system_binary = Path(sys.executable)
    if not signed_system_binary.is_file():
        pytest.skip("A signed Windows system binary is unavailable")
    if _authenticode_status(signed_system_binary) != "Valid":
        pytest.skip("The active Python executable is not Authenticode-valid")

    damaged = bytearray(signed_system_binary.read_bytes())
    pe_offset = struct.unpack_from("<I", damaged, 0x3C)[0]
    optional_header = pe_offset + 24
    magic = struct.unpack_from("<H", damaged, optional_header)[0]
    data_directories = optional_header + (96 if magic == 0x10B else 112)
    certificate_offset, certificate_size = struct.unpack_from("<II", damaged, data_directories + (8 * 4))
    if not certificate_offset or not certificate_size:
        pytest.skip("The active Python executable is catalog-signed rather than embedded-signed")
    optional_header_size = struct.unpack_from("<H", damaged, pe_offset + 20)[0]
    first_section = pe_offset + 24 + optional_header_size
    raw_size = struct.unpack_from("<I", damaged, first_section + 16)[0]
    raw_pointer = struct.unpack_from("<I", damaged, first_section + 20)[0]
    damaged[raw_pointer + min(16, raw_size - 1)] ^= 0x01
    fixture["installer"].write_bytes(damaged)
    status = _authenticode_status(fixture["installer"])
    assert status != "Valid", "The PE mutation unexpectedly preserved a valid signature"

    fixture["installer_sha256"] = _sha256(fixture["installer"])
    readiness = json.loads(fixture["readiness_report"].read_text(encoding="utf-8"))
    installer = next(item for item in readiness["artifacts"] if item["name"] == "installer")
    installer["bytes"] = fixture["installer"].stat().st_size
    installer["sha256"] = fixture["installer_sha256"]
    installer["built_at"] = _utc_iso(datetime.fromtimestamp(fixture["installer"].stat().st_mtime, timezone.utc))
    _write_json(fixture["readiness_report"], readiness)
    fixture["readiness_report_sha256"] = _sha256(fixture["readiness_report"])

    result = _run_provenance(fixture)

    assert result.returncode != 0, result.stdout + result.stderr
    assert not fixture["output"].exists()


@pytest.mark.skipif(
    os.name != "nt" or shutil.which("powershell") is None or shutil.which("git") is None,
    reason="Windows PowerShell and Git are required for provenance integration tests",
)
@pytest.mark.parametrize(
    "failure_mode",
    [
        "dirty_worktree",
        "head_mismatch",
        "artifact_changed_after_build",
        "fault_report_changed_after_producer",
        "empty_fault_cases",
        "failed_readiness_check",
    ],
)
def test_release_provenance_fails_closed_without_a_manifest(tmp_path, failure_mode):
    fixture = _create_provenance_fixture(tmp_path)
    expected_commit = None
    if failure_mode == "dirty_worktree":
        migration_source = fixture["repo"] / "frontend" / "src-tauri" / "src" / "lib.rs"
        migration_source.write_text("pub fn tracked_change_after_build() {}\n", encoding="utf-8")
    elif failure_mode == "head_mismatch":
        expected_commit = "0" * 40
    elif failure_mode == "artifact_changed_after_build":
        fixture["sidecar"].write_bytes(fixture["sidecar"].read_bytes() + b"changed-after-build")
    elif failure_mode == "fault_report_changed_after_producer":
        fault = json.loads(fixture["fault_report"].read_text(encoding="utf-8"))
        fault["sidecar_sha256"] = "0" * 64
        _write_json(fixture["fault_report"], fault)
    elif failure_mode == "empty_fault_cases":
        fault = json.loads(fixture["fault_report"].read_text(encoding="utf-8"))
        fault["cases"] = []
        _write_json(fixture["fault_report"], fault)
        fixture["fault_report_sha256"] = _sha256(fixture["fault_report"])
    else:
        readiness = json.loads(fixture["readiness_report"].read_text(encoding="utf-8"))
        readiness["checks"][0]["passed"] = False
        _write_json(fixture["readiness_report"], readiness)
        fixture["readiness_report_sha256"] = _sha256(fixture["readiness_report"])

    result = _run_provenance(fixture, expected_commit=expected_commit)

    assert result.returncode != 0, result.stdout + result.stderr
    assert not fixture["output"].exists()
