import os
import zipfile
from natsort import natsorted

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_ZIP_IMAGE_BYTES = int(os.getenv("BOOKREADER_MAX_ZIP_IMAGE_BYTES", str(64 * 1024 * 1024)))
MAX_ZIP_ENTRIES = int(os.getenv("BOOKREADER_MAX_ZIP_ENTRIES", "10000"))
MAX_ZIP_IMAGE_COUNT = int(os.getenv("BOOKREADER_MAX_ZIP_IMAGE_COUNT", "5000"))
MAX_ZIP_NAME_LENGTH = int(os.getenv("BOOKREADER_MAX_ZIP_NAME_LENGTH", "512"))


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

    images = [
        info.filename for info in infos
        if len(info.filename) <= MAX_ZIP_NAME_LENGTH
        and not info.filename.startswith("__MACOSX")
        and not info.filename.startswith(".")
        and _is_image(info.filename)
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
    with _open_zip(file_path) as zf:
        info = _get_zip_info(zf, image_name)
        if info.file_size > MAX_ZIP_IMAGE_BYTES:
            raise ZipSafetyError("ZIP image is too large")
        data = _read_zip_member(zf, info)

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
