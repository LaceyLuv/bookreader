import hashlib
import os
import posixpath
import re
import stat
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
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
_SUPPORTED_COMPRESSION_TYPES = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
_MANIFEST_CACHE_SIZE = int(os.getenv("BOOKREADER_ZIP_MANIFEST_CACHE_SIZE", "16"))
_MANIFEST_SCHEMA = "zip-manifest-v1"


class ZipSafetyError(ValueError):
    """A stable, user-safe ZIP failure with backwards-compatible text."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "invalid_archive",
        stage: str = "preflight",
        retryable: bool = False,
        member_name: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.retryable = retryable
        self.member_name = member_name

    def to_problem(self) -> dict:
        return {
            "code": self.code,
            "message": str(self),
            "severity": "error",
            "stage": self.stage,
            "retryable": self.retryable,
            "recovery": "retry" if self.retryable else "choose_another_file",
            "member_name": self.member_name,
            "context": {"member_name": self.member_name},
        }


@dataclass(frozen=True)
class _ZipMember:
    name: str
    file_size: int
    compress_size: int


@dataclass
class _ZipManifest:
    archive_revision: str
    entries_total: int
    skipped_entries: int
    images: tuple[str, ...]
    members_by_name: dict[str, _ZipMember]
    diagnostics: tuple[dict, ...]


def _zip_error(
    message: str,
    code: str,
    *,
    stage: str = "preflight",
    retryable: bool = False,
    member_name: str | None = None,
) -> ZipSafetyError:
    return ZipSafetyError(
        message,
        code=code,
        stage=stage,
        retryable=retryable,
        member_name=member_name,
    )


def _open_zip(file_path: str) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(file_path, "r")
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise _zip_error("Invalid or unsupported ZIP archive", "invalid_archive") from exc


def _archive_revision(file_path: str, size: int, mtime_ns: int) -> str:
    payload = f"{_MANIFEST_SCHEMA}\0{file_path}\0{size}\0{mtime_ns}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _manifest_cache_key(file_path: str) -> tuple[str, int, int]:
    try:
        resolved = str(Path(file_path).resolve(strict=True))
        metadata = os.stat(resolved)
    except OSError as exc:
        raise _zip_error("Invalid or unsupported ZIP archive", "invalid_archive") from exc
    return resolved, metadata.st_size, metadata.st_mtime_ns


def _special_member_error(info: zipfile.ZipInfo) -> ZipSafetyError | None:
    if info.create_system != 3:
        return None
    mode = (info.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(mode)
    if file_type == stat.S_IFLNK:
        return _zip_error(
            "ZIP archive contains a symbolic link",
            "symlink_member",
            member_name=info.filename,
        )
    if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
        return _zip_error(
            "ZIP archive contains a special file",
            "special_member",
            member_name=info.filename,
        )
    return None


def _collision_key(name: str) -> str:
    normalized = _normalize_member_name(name)
    candidate = normalized or str(name).replace("\\", "/")
    return unicodedata.normalize("NFC", candidate).casefold()


def _validate_archive_info(infos: list[zipfile.ZipInfo]) -> None:
    if len(infos) > MAX_ZIP_ENTRIES:
        raise _zip_error("ZIP archive has too many entries", "too_many_entries")

    total_uncompressed = 0
    exact_names: set[str] = set()
    canonical_names: dict[str, str] = {}
    for info in infos:
        if info.is_dir():
            continue

        if info.filename in exact_names:
            raise _zip_error(
                "ZIP archive contains duplicate member names",
                "duplicate_member",
                member_name=info.filename,
            )
        exact_names.add(info.filename)

        collision_key = _collision_key(info.filename)
        previous_name = canonical_names.get(collision_key)
        if previous_name is not None and previous_name != info.filename:
            raise _zip_error(
                "ZIP archive contains colliding member names",
                "member_name_collision",
                member_name=info.filename,
            )
        canonical_names[collision_key] = info.filename

        if info.flag_bits & 0x1:
            raise _zip_error(
                "Encrypted ZIP members are not supported",
                "encrypted_member",
                member_name=info.filename,
            )
        if info.compress_type not in _SUPPORTED_COMPRESSION_TYPES:
            raise _zip_error(
                "ZIP member uses an unsupported compression method",
                "unsupported_compression",
                member_name=info.filename,
            )
        special_error = _special_member_error(info)
        if special_error is not None:
            raise special_error

        total_uncompressed += info.file_size
        if total_uncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES:
            raise _zip_error("ZIP archive is too large when decompressed", "archive_too_large")
        compressed_size = max(info.compress_size, 1)
        if info.file_size > 0 and info.file_size / compressed_size > MAX_ZIP_COMPRESSION_RATIO:
            raise _zip_error(
                "ZIP archive compression ratio is too high",
                "compression_ratio_too_high",
                member_name=info.filename,
            )


def _diagnostic(code: str, message: str, count: int, sample_members: list[str]) -> dict:
    return {
        "code": code,
        "message": message,
        "stage": "preflight",
        "severity": "warning",
        "retryable": False,
        "recovery": "none",
        "count": count,
        "sample_members": sample_members[:3],
        "context": {"count": count, "sample_members": sample_members[:3]},
    }


def _copy_diagnostic(item: dict) -> dict:
    copied = dict(item)
    copied["sample_members"] = list(item.get("sample_members", []))
    return copied


@lru_cache(maxsize=_MANIFEST_CACHE_SIZE)
def _build_manifest_cached(file_path: str, size: int, mtime_ns: int) -> _ZipManifest:
    try:
        with _open_zip(file_path) as zf:
            infos = zf.infolist()
    except ZipSafetyError:
        raise
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise _zip_error("Invalid or unsupported ZIP archive", "invalid_archive") from exc

    _validate_archive_info(infos)

    images: list[str] = []
    members_by_name: dict[str, _ZipMember] = {}
    unsafe_members: list[str] = []
    oversized_images: list[str] = []
    image_candidates = 0
    for info in infos:
        if info.is_dir():
            continue
        member = _ZipMember(info.filename, info.file_size, info.compress_size)
        members_by_name[info.filename] = member
        if not _is_safe_zip_member(info, require_image=False):
            unsafe_members.append(info.filename)
            continue
        if not _is_image(_normalize_member_name(info.filename)):
            continue
        image_candidates += 1
        if image_candidates > MAX_ZIP_IMAGE_COUNT:
            raise _zip_error("ZIP archive has too many images", "too_many_images")
        if info.file_size > MAX_ZIP_IMAGE_BYTES:
            oversized_images.append(info.filename)
            continue
        images.append(info.filename)

    diagnostics: list[dict] = []
    if unsafe_members:
        diagnostics.append(
            _diagnostic(
                "unsafe_member",
                "Unsafe ZIP members were skipped",
                len(unsafe_members),
                unsafe_members,
            )
        )
    if oversized_images:
        diagnostics.append(
            _diagnostic(
                "image_too_large",
                "Oversized ZIP images were skipped",
                len(oversized_images),
                oversized_images,
            )
        )

    sorted_images = tuple(natsorted(images))
    try:
        final_metadata = os.stat(file_path)
    except OSError as exc:
        raise _zip_error(
            "ZIP archive changed during validation",
            "archive_changed",
            retryable=True,
        ) from exc
    if final_metadata.st_size != size or final_metadata.st_mtime_ns != mtime_ns:
        raise _zip_error(
            "ZIP archive changed during validation",
            "archive_changed",
            retryable=True,
        )
    revision = _archive_revision(file_path, size, mtime_ns)
    return _ZipManifest(
        archive_revision=revision,
        entries_total=len(infos),
        skipped_entries=len(infos) - len(sorted_images),
        images=sorted_images,
        members_by_name=members_by_name,
        diagnostics=tuple(diagnostics),
    )


def _manifest_for_path(file_path: str) -> _ZipManifest:
    return _build_manifest_cached(*_manifest_cache_key(file_path))


def clear_zip_caches() -> None:
    _build_manifest_cached.cache_clear()


def list_zip_images(file_path: str) -> dict:
    """Return a cached, safely preflighted ZIP image manifest."""
    manifest = _manifest_for_path(file_path)
    return {
        "images": list(manifest.images),
        "total": len(manifest.images),
        "archive_revision": manifest.archive_revision,
        "entries_total": manifest.entries_total,
        "skipped_entries": manifest.skipped_entries,
        "diagnostics": [_copy_diagnostic(item) for item in manifest.diagnostics],
    }


def _get_zip_info(zf: zipfile.ZipFile, image_name: str) -> zipfile.ZipInfo:
    try:
        return zf.getinfo(image_name)
    except KeyError as exc:
        raise FileNotFoundError(image_name) from exc


def _read_zip_member(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    try:
        return zf.read(info)
    except zipfile.BadZipFile as exc:
        message = str(exc).lower()
        code = "crc_mismatch" if "crc" in message else "corrupt_member"
        public_message = "ZIP image checksum does not match" if code == "crc_mismatch" else "Invalid or unsupported ZIP archive"
        raise _zip_error(
            public_message,
            code,
            stage="member_read",
            member_name=info.filename,
        ) from exc
    except NotImplementedError as exc:
        raise _zip_error(
            "ZIP member uses an unsupported compression method",
            "unsupported_compression",
            stage="member_read",
            member_name=info.filename,
        ) from exc
    except RuntimeError as exc:
        code = "encrypted_member" if "password" in str(exc).lower() or "encrypted" in str(exc).lower() else "corrupt_member"
        raise _zip_error(
            "Encrypted ZIP members are not supported" if code == "encrypted_member" else "Invalid or unsupported ZIP archive",
            code,
            stage="member_read",
            member_name=info.filename,
        ) from exc
    except (OSError, EOFError, ValueError) as exc:
        raise _zip_error(
            "Invalid or unsupported ZIP archive",
            "corrupt_member",
            stage="member_read",
            member_name=info.filename,
        ) from exc


def _read_manifest_image(file_path: str, manifest: _ZipManifest, image_name: str) -> tuple[bytes, str]:
    _validate_requested_member_name(image_name)
    member = manifest.members_by_name.get(image_name)
    if member is None:
        raise FileNotFoundError(image_name)
    if not _is_image(_normalize_member_name(image_name)):
        raise _zip_error(
            "Invalid ZIP image member",
            "invalid_member",
            stage="member_read",
            member_name=image_name,
        )
    if member.file_size > MAX_ZIP_IMAGE_BYTES:
        raise _zip_error(
            "ZIP image is too large",
            "image_too_large",
            stage="member_read",
            member_name=image_name,
        )

    with _open_zip(file_path) as zf:
        info = _get_zip_info(zf, image_name)
        data = _read_zip_member(zf, info)
    if not _has_image_signature(image_name, data):
        raise _zip_error(
            "ZIP image content is not a supported image",
            "invalid_image_signature",
            stage="signature",
            member_name=image_name,
        )

    ext = image_name.rsplit(".", 1)[-1].lower() if "." in image_name else "png"
    media_type_map = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
    }
    return data, media_type_map.get(ext, "image/png")


def get_zip_image(file_path: str, image_name: str) -> tuple:
    """Extract one image using the same cached manifest as the image list."""
    return _read_manifest_image(file_path, _manifest_for_path(file_path), image_name)


def diagnose_zip(file_path: str, member_name: str | None = None) -> dict:
    """Return a non-throwing ZIP support diagnosis for UI and support tooling."""
    try:
        manifest = _manifest_for_path(file_path)
    except ZipSafetyError as exc:
        return {
            "format": "zip",
            "status": "unsupported_or_corrupt",
            "issues": [exc.to_problem()],
            "stats": {
                "entries_total": 0,
                "images_total": 0,
                "skipped_entries": 0,
            },
        }

    issues = [_copy_diagnostic(item) for item in manifest.diagnostics]
    stats = {
        "archive_revision": manifest.archive_revision,
        "entries_total": manifest.entries_total,
        "images_total": len(manifest.images),
        "skipped_entries": manifest.skipped_entries,
    }
    if member_name is not None:
        stats["member_name"] = member_name
        try:
            data, media_type = _read_manifest_image(file_path, manifest, member_name)
            stats["member_bytes"] = len(data)
            stats["media_type"] = media_type
        except FileNotFoundError:
            issues.append(
                _zip_error(
                    "Image not found",
                    "image_not_found",
                    stage="member_read",
                    member_name=member_name,
                ).to_problem()
            )
        except ZipSafetyError as exc:
            issues.append(exc.to_problem())

    return {
        "format": "zip",
        "status": "degraded" if issues else "supported",
        "issues": issues,
        "stats": stats,
    }


def _is_image(filename: str) -> bool:
    """Check if a filename has an image extension."""
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS)


def _validate_archive_size(infos: list[zipfile.ZipInfo]) -> None:
    """Compatibility helper retained for service-level callers and tests."""
    _validate_archive_info(infos)


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
    try:
        parsed = urlsplit(decoded)
    except ValueError:
        return ""
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
        raise _zip_error(
            "Invalid ZIP image member",
            "invalid_member",
            stage="member_read",
            member_name=name,
        )
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
