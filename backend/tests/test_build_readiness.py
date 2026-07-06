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
