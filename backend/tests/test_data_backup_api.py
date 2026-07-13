from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import data_backup


def test_export_endpoint_streams_generated_bundle(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle.bookreader-backup"
    bundle.write_bytes(b"verified bundle")
    manifest = {"kind": "data", "created_at": "2026-07-13T00:00:00+00:00"}
    monkeypatch.setattr(data_backup, "create_backup_bundle", lambda **_kwargs: (bundle, manifest))
    app = FastAPI()
    app.include_router(data_backup.router)

    with TestClient(app) as client:
        response = client.post("/api/data/backups", json={"include_books": False, "client_state": {}})

    assert response.status_code == 200
    assert response.content == b"verified bundle"
    assert "BookReader-data-2026-07-13.bookreader-backup" in response.headers["content-disposition"]
    assert not bundle.exists()


def test_preview_then_commit_uses_restore_id_without_second_upload(monkeypatch):
    validated = type(
        "Validated",
        (),
        {
            "manifest": {
                "format": "bookreader-backup",
                "schema_version": 1,
                "app_version": "0.1.1",
                "created_at": "2026-07-13T00:00:00+00:00",
                "kind": "data",
                "counts": {"books": 1},
            },
            "warnings": [],
        },
    )()
    seen_paths: list[Path] = []

    def create_session(path):
        seen_paths.append(path)
        path.unlink(missing_ok=True)
        return "a" * 32, validated

    monkeypatch.setattr(data_backup, "create_restore_session", create_session)
    monkeypatch.setattr(
        data_backup,
        "apply_restore_session",
        lambda restore_id, **_kwargs: {"ok": True, "restore_id": restore_id, "client_state": {}},
    )
    app = FastAPI()
    app.include_router(data_backup.router)

    with TestClient(app) as client:
        preview = client.post(
            "/api/data/restores/preview",
            files={"file": ("backup.bookreader-backup", b"bundle", "application/zip")},
        )
        committed = client.post(
            f"/api/data/restores/{'a' * 32}/commit",
            json={"current_client_state": {"settings": {"theme": "dark"}}},
        )

    assert preview.status_code == 200
    assert preview.json()["restore_id"] == "a" * 32
    assert committed.status_code == 200
    assert committed.json()["restore_id"] == "a" * 32
    assert len(seen_paths) == 1
