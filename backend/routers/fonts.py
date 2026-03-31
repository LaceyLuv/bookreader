import hashlib
import mimetypes
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from models import FontMeta
from paths import FONTS_DIR

router = APIRouter(prefix="/api/fonts", tags=["fonts"])

ALLOWED_FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}
FONT_ID_RE = re.compile(r"^[0-9a-f]{12}$")
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
UPLOAD_CHUNK_SIZE = 1024 * 1024


def _safe_name(name: str) -> str:
    cleaned = SAFE_NAME_RE.sub("-", name).strip("-.")
    return cleaned or "font"


def _font_meta(path: Path) -> dict:
    stem = path.stem
    font_id = stem.split("-", 1)[0]
    return {
        "id": font_id,
        "filename": path.name,
        "ext": path.suffix.lower().lstrip("."),
        "created_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
    }


def _list_font_files() -> list[Path]:
    if not FONTS_DIR.exists():
        return []
    return sorted(
        [f for f in FONTS_DIR.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_FONT_EXTS],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )


def _find_font_path(font_id: str) -> Path | None:
    if not FONT_ID_RE.fullmatch(font_id):
        return None
    for font_file in _list_font_files():
        if font_file.stem.split("-", 1)[0] == font_id:
            return font_file
    return None


@router.get("", response_model=List[FontMeta])
async def list_fonts():
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    return [_font_meta(path) for path in _list_font_files()]


@router.post("", response_model=FontMeta)
async def upload_font(file: UploadFile = File(...)):
    FONTS_DIR.mkdir(parents=True, exist_ok=True)

    original_name = Path(file.filename or "").name
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_FONT_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported font type. Allowed: .ttf, .otf, .woff, .woff2")

    temp_fd, temp_name = tempfile.mkstemp(prefix="font-upload-", suffix=ext, dir=FONTS_DIR)
    temp_path = Path(temp_name)
    hasher = hashlib.md5()
    total_bytes = 0

    try:
        with os.fdopen(temp_fd, "wb") as temp_file:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                hasher.update(chunk)
                temp_file.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Empty font file")

        font_id = hasher.hexdigest()[:12]
        existing = _find_font_path(font_id)
        if existing:
            temp_path.unlink(missing_ok=True)
            return _font_meta(existing)

        base_name = _safe_name(Path(original_name).stem)
        saved_name = f"{font_id}-{base_name}{ext}"
        destination = FONTS_DIR / saved_name
        temp_path.replace(destination)
        return _font_meta(destination)
    finally:
        await file.close()
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


@router.get("/{font_id}")
async def get_font(font_id: str):
    font_path = _find_font_path(font_id)
    if not font_path:
        raise HTTPException(status_code=404, detail="Font not found")

    media_type = mimetypes.guess_type(font_path.name)[0] or "application/octet-stream"
    return FileResponse(
        path=font_path,
        media_type=media_type,
        filename=font_path.name,
        headers={"Cache-Control": "public, max-age=3600"},
    )
