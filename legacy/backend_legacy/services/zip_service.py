import zipfile
import io
from natsort import natsorted
from typing import List

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def list_zip_images(file_path: str) -> dict:
    """List all image files in a ZIP archive, naturally sorted."""
    with zipfile.ZipFile(file_path, "r") as zf:
        all_names = zf.namelist()

    images = [
        name for name in all_names
        if not name.startswith("__MACOSX")
        and not name.startswith(".")
        and _is_image(name)
    ]
    images = natsorted(images)
    return {"images": images, "total": len(images)}


def get_zip_image(file_path: str, image_name: str) -> tuple:
    """Extract a single image from a ZIP archive. Returns (bytes, media_type)."""
    with zipfile.ZipFile(file_path, "r") as zf:
        data = zf.read(image_name)

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
