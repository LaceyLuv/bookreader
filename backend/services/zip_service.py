import os
import posixpath
import re
from urllib.parse import unquote, urlsplit
import zipfile
from natsort import natsorted

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_ZIP_IMAGE_BYTES = int(os.getenv("BOOKREADER_MAX_ZIP_IMAGE_BYTES", str(64 * 1024 * 1024)))
MAX_ZIP_ENTRIES = int(os.getenv("BOOKREADER_MAX_ZIP_ENTRIES", "10000"))
MAX_ZIP_IMAGE_COUNT = int(os.getenv("BOOKREADER_MAX_ZIP_IMAGE_COUNT", "5000"))
MAX_ZIP_NAME_LENGTH = int(os.getenv("BOOKREADER_MAX_ZIP_NAME_LENGTH", "512"))
MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = int(os.getenv("BOOKREADER_MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES", str(512 * 1024 * 1024)))
MAX_ZIP_COMPRESSION_RATIO = int(os.getenv("BOOKREADER_MAX_ZIP_COMPRESSION_RATIO", "100"))


class ZipSafetyError(ValueError):
    pass


def _open_zip(file_path: str) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(file_path, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise ZipSafetyError("Invalid or unsupported ZIP archive") from exc


def list_zip_images(file_path: str) -> dict:
    """List all image files in a ZIP archive, naturally sorted."""
    with _open_zip(file_path) as zf:
        infos = zf.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        raise ZipSafetyError("ZIP archive has too many entries")
    _validate_archive_size(infos)

    images = [
        info.filename for info in infos
        if _is_safe_zip_member(info, require_image=True)
    ]
    if len(images) > MAX_ZIP_IMAGE_COUNT:
        raise ZipSafetyError("ZIP archive has too many images")
    images = natsorted(images)
    return {"images": images, "total": len(images)}


def _get_zip_info(zf: zipfile.ZipFile, image_name: str) -> zipfile.ZipInfo:
    try:
        return zf.getinfo(image_name)
    except KeyError as exc:
        raise FileNotFoundError(image_name) from exc


def _read_zip_member(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    try:
        return zf.read(info)
    except (RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
        raise ZipSafetyError("Invalid or unsupported ZIP archive") from exc


def get_zip_image(file_path: str, image_name: str) -> tuple:
    """Extract a single image from a ZIP archive. Returns (bytes, media_type)."""
    _validate_requested_member_name(image_name)
    with _open_zip(file_path) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise ZipSafetyError("ZIP archive has too many entries")
        _validate_archive_size(infos)
        info = _get_zip_info(zf, image_name)
        if not _is_safe_zip_member(info, require_image=True):
            raise ZipSafetyError("Invalid ZIP image member")
        if info.file_size > MAX_ZIP_IMAGE_BYTES:
            raise ZipSafetyError("ZIP image is too large")
        data = _read_zip_member(zf, info)
        if not _has_image_signature(image_name, data):
            raise ZipSafetyError("ZIP image content is not a supported image")

    ext = image_name.rsplit(".", 1)[-1].lower() if "." in image_name else "png"
    media_type_map = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
    }
    media_type = media_type_map.get(ext, "image/png")
    return data, media_type


def _is_image(filename: str) -> bool:
    """Check if a filename has an image extension."""
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS)


def _validate_archive_size(infos: list[zipfile.ZipInfo]) -> None:
    total_uncompressed = 0
    for info in infos:
        if info.is_dir():
            continue
        total_uncompressed += info.file_size
        if total_uncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES:
            raise ZipSafetyError("ZIP archive is too large when decompressed")
        compressed_size = max(info.compress_size, 1)
        if info.file_size > 0 and info.file_size / compressed_size > MAX_ZIP_COMPRESSION_RATIO:
            raise ZipSafetyError("ZIP archive compression ratio is too high")


def _normalize_member_name(name: str | None) -> str:
    if not name:
        return ""
    raw = str(name).strip()
    if not raw or len(raw) > MAX_ZIP_NAME_LENGTH:
        return ""
    decoded = unquote(raw).replace("\\", "/")
    if not decoded or decoded.startswith(("/", "\\")):
        return ""
    if re.match(r"^[A-Za-z]:[\\/]", decoded):
        return ""
    parsed = urlsplit(decoded)
    if parsed.scheme:
        return ""
    normalized = posixpath.normpath(decoded)
    if normalized in ("", ".", "..") or normalized.startswith("../"):
        return ""
    parts = [part for part in normalized.split("/") if part]
    if any(part == ".." for part in parts):
        return ""
    if any(part.startswith(".") or part == "__MACOSX" for part in parts):
        return ""
    return normalized


def _validate_requested_member_name(name: str | None) -> str:
    normalized = _normalize_member_name(name)
    if not normalized:
        raise ZipSafetyError("Invalid ZIP image member")
    return normalized


def _is_safe_zip_member(info: zipfile.ZipInfo, require_image: bool = False) -> bool:
    if info.is_dir():
        return False
    normalized = _normalize_member_name(info.filename)
    if not normalized:
        return False
    if require_image and not _is_image(normalized):
        return False
    return True


def _has_image_signature(filename: str, data: bytes) -> bool:
    lower = filename.lower()
    if lower.endswith((".jpg", ".jpeg")):
        return data.startswith(b"\xff\xd8\xff")
    if lower.endswith(".png"):
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if lower.endswith(".gif"):
        return data.startswith((b"GIF87a", b"GIF89a"))
    if lower.endswith(".webp"):
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if lower.endswith(".bmp"):
        return data.startswith(b"BM")
    return False
