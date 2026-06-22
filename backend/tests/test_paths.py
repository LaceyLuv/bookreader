from pathlib import Path

import paths


def test_resolve_data_dir_uses_explicit_environment_path(monkeypatch, tmp_path):
    monkeypatch.setenv(paths.DATA_DIR_ENV, str(tmp_path))
    monkeypatch.setattr(paths.sys, "frozen", True, raising=False)

    assert paths._resolve_data_dir() == tmp_path.resolve()


def test_resolve_data_dir_uses_backend_dir_for_source_runs(monkeypatch):
    monkeypatch.delenv(paths.DATA_DIR_ENV, raising=False)
    monkeypatch.setattr(paths.sys, "frozen", False, raising=False)

    assert paths._resolve_data_dir() == paths.BASE_DIR


def test_resolve_data_dir_uses_local_app_data_for_windows_frozen_runs(monkeypatch, tmp_path):
    monkeypatch.delenv(paths.DATA_DIR_ENV, raising=False)
    monkeypatch.setattr(paths.sys, "frozen", True, raising=False)
    monkeypatch.setattr(paths.os, "name", "nt", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    assert paths._resolve_data_dir() == (tmp_path / paths.APP_DATA_DIR_NAME).resolve()
