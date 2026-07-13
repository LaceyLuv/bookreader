from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from services.backup_service import (
    APP_VERSION,
    MAX_ARCHIVE_BYTES,
    BackupValidationError,
    apply_restore_session,
    create_backup_bundle,
    create_restore_session,
    discard_restore_session,
)

router = APIRouter(prefix="/api/data", tags=["data"])


class BackupRequest(BaseModel):
    include_books: bool = False
    client_state: dict[str, Any] = Field(default_factory=dict)


class RestoreCommitRequest(BaseModel):
    current_client_state: dict[str, Any] = Field(default_factory=dict)


async def _save_upload(file: UploadFile) -> Path:
    fd, temp_name = tempfile.mkstemp(prefix="bookreader-restore-", suffix=".bookreader-backup")
    os.close(fd)
    destination = Path(temp_name)
    total = 0
    try:
        with destination.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ARCHIVE_BYTES:
                    raise BackupValidationError("Backup archive is too large")
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
        return destination
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.post("/backups")
async def export_backup(payload: BackupRequest):
    try:
        path, manifest = await run_in_threadpool(
            create_backup_bundle,
            client_state=payload.client_state,
            include_books=payload.include_books,
        )
    except BackupValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    filename = f"Gyeol-{manifest['kind']}-{manifest['created_at'][:10]}.bookreader-backup"
    return FileResponse(
        path,
        filename=filename,
        media_type="application/zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.post("/restores/preview")
async def preview_restore(file: UploadFile = File(...)):
    temp_path = None
    try:
        temp_path = await _save_upload(file)
        restore_id, validated = await run_in_threadpool(create_restore_session, temp_path)
        temp_path = None
        return {
            "restore_id": restore_id,
            "format": validated.manifest["format"],
            "schema_version": validated.manifest["schema_version"],
            "app_version": validated.manifest.get("app_version", APP_VERSION),
            "created_at": validated.manifest["created_at"],
            "kind": validated.manifest["kind"],
            "counts": validated.manifest.get("counts", {}),
            "warnings": validated.warnings,
        }
    except BackupValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@router.post("/restores/{restore_id}/commit")
async def commit_restore(restore_id: str, payload: RestoreCommitRequest):
    try:
        return await run_in_threadpool(
            apply_restore_session,
            restore_id,
            current_client_state=payload.current_client_state,
        )
    except BackupValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Backup restore failed; previous data was retained") from exc


@router.delete("/restores/{restore_id}")
async def cancel_restore(restore_id: str):
    try:
        await run_in_threadpool(discard_restore_session, restore_id)
    except BackupValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"detail": "Restore preview discarded"}
