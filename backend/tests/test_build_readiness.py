import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


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
