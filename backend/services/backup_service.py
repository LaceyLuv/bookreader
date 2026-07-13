from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import threading
import unicodedata
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from services.annotation_store import ANNOTATIONS_VERSION
from services.library_store import LIBRARY_VERSION
from services.reading_progress_store import STORE_VERSION as READING_PROGRESS_STORE_VERSION

from paths import (
    ANNOTATIONS_DATA_PATH,
    BACKUPS_DIR,
    BOOKS_DIR,
    DATA_DIR,
    DELETE_JOURNAL_PATH,
    FONTS_DIR,
    LIBRARY_DATA_PATH,
    READING_PROGRESS_DATA_PATH,
    RESTORE_JOURNAL_PATH,
    RESTORE_SESSIONS_DIR,
)

BACKUP_FORMAT = "bookreader-backup"
BACKUP_SCHEMA_VERSION = 1
APP_VERSION = "0.1.1"
CHUNK_SIZE = 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_CLIENT_STATE_BYTES = 512 * 1024
MAX_ARCHIVE_BYTES = int(os.getenv("BOOKREADER_MAX_BACKUP_ARCHIVE_BYTES", str(10 * 1024 * 1024 * 1024)))
MAX_UNCOMPRESSED_BYTES = int(os.getenv("BOOKREADER_MAX_BACKUP_UNCOMPRESSED_BYTES", str(12 * 1024 * 1024 * 1024)))
MAX_ENTRIES = int(os.getenv("BOOKREADER_MAX_BACKUP_ENTRIES", "20000"))
MAX_COMPRESSION_RATIO = 200
SESSION_TTL = timedelta(hours=2)
SESSION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
ALLOWED_FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}
FONT_SIGNATURES = {
    ".ttf": (b"\x00\x01\x00\x00", b"true", b"typ1"),
    ".otf": (b"OTTO",),
    ".woff": (b"wOFF",),
    ".woff2": (b"wOF2",),
}
STORE_ARCHIVES = {
    "stores/library.json": "library.json",
    "stores/annotations.json": "annotations.json",
    "stores/reading-progress.json": "reading-progress.json",
}
_OPERATION_LOCK = threading.RLock()
_RESTORE_IN_PROGRESS = False


class BackupValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class BackupPaths:
    data_dir: Path
    books_dir: Path
    fonts_dir: Path
    library_path: Path
    annotations_path: Path
    progress_path: Path
    delete_journal_path: Path
    restore_journal_path: Path
    backups_dir: Path
    sessions_dir: Path


@dataclass(frozen=True)
class ValidatedBackup:
    manifest: dict[str, Any]
    library: dict[str, Any]
    annotations: dict[str, Any]
    progress: dict[str, Any]
    client_state: dict[str, Any]
    warnings: list[str]


def default_paths() -> BackupPaths:
    return BackupPaths(
        data_dir=DATA_DIR,
        books_dir=BOOKS_DIR,
        fonts_dir=FONTS_DIR,
        library_path=LIBRARY_DATA_PATH,
        annotations_path=ANNOTATIONS_DATA_PATH,
        progress_path=READING_PROGRESS_DATA_PATH,
        delete_journal_path=DELETE_JOURNAL_PATH,
        restore_journal_path=RESTORE_JOURNAL_PATH,
        backups_dir=BACKUPS_DIR,
        sessions_dir=RESTORE_SESSIONS_DIR,
    )


def is_restore_in_progress() -> bool:
    return _RESTORE_IN_PROGRESS


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BackupValidationError(f"Unable to read data store: {path.name}") from exc
    if not isinstance(value, dict):
        raise BackupValidationError(f"Data store must be a JSON object: {path.name}")
    return value


def _normalize_client_state(value: Any, *, include_progress: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    normalized = {
        "settings": value.get("settings") if isinstance(value.get("settings"), dict) else {},
        "folder_colors": value.get("folder_colors") if isinstance(value.get("folder_colors"), dict) else {},
    }
    if include_progress:
        normalized["progress"] = value.get("progress") if isinstance(value.get("progress"), dict) else {}
    encoded = _json_bytes(normalized)
    if len(encoded) > MAX_CLIENT_STATE_BYTES:
        raise BackupValidationError("Client settings are too large")
    return normalized


def _timestamp(value: Any) -> float:
    if not isinstance(value, str):
        return float("-inf")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return float("-inf")


def _merge_client_progress(library: dict[str, Any], progress: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    merged = dict(progress.get("progress") if isinstance(progress.get("progress"), dict) else {})
    aliases: dict[str, str] = {}
    for raw in library.get("books", []):
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        book_id = str(raw["id"])
        aliases[book_id] = book_id
        if raw.get("legacy_id"):
            aliases[str(raw["legacy_id"])] = book_id
    for raw_id, entry in local.items():
        canonical_id = aliases.get(str(raw_id))
        if canonical_id is None or not isinstance(entry, dict):
            continue
        if canonical_id not in merged or _timestamp(entry.get("updatedAt")) > _timestamp(merged[canonical_id].get("updatedAt")):
            merged[canonical_id] = dict(entry)
    return {"version": 1, "progress": merged}


def _safe_basename(value: Any, *, label: str) -> str:
    text = str(value or "")
    if not text or Path(text).name != text or "/" in text or "\\" in text:
        raise BackupValidationError(f"Unsafe {label}: {text}")
    return text


def _validate_store_version(value: dict[str, Any], supported: int, label: str) -> int:
    version = value.get("version", 1)
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise BackupValidationError(f"Invalid {label} store version")
    if version > supported:
        raise BackupValidationError(
            f"{label.title()} store version {version} is newer than supported version {supported}"
        )
    return version


def _validate_library(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("books", []), list) or not isinstance(value.get("folders", []), list):
        raise BackupValidationError("Invalid library store")
    _validate_store_version(value, LIBRARY_VERSION, "library")
    book_ids: set[str] = set()
    stored_names: set[str] = set()
    for raw in value.get("books", []):
        if not isinstance(raw, dict) or not raw.get("id"):
            raise BackupValidationError("Invalid library book record")
        book_id = str(raw["id"])
        stored = _safe_basename(raw.get("stored_filename"), label="stored filename")
        if book_id in book_ids or stored.casefold() in stored_names:
            raise BackupValidationError("Duplicate book id or stored filename")
        if Path(stored).suffix.lower() not in {".txt", ".epub", ".zip"}:
            raise BackupValidationError(f"Unsupported book in backup: {stored}")
        book_ids.add(book_id)
        stored_names.add(stored.casefold())
    return value


def _validate_annotations(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("annotations", []), list):
        raise BackupValidationError("Invalid annotation store")
    _validate_store_version(value, ANNOTATIONS_VERSION, "annotation")
    return value


def _validate_progress(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("progress", {}), dict):
        raise BackupValidationError("Invalid reading progress store")
    _validate_store_version(value, READING_PROGRESS_STORE_VERSION, "reading progress")
    return value


def _add_bytes(zf: zipfile.ZipFile, archive_path: str, payload: bytes) -> dict[str, Any]:
    zf.writestr(archive_path, payload)
    return {"path": archive_path, "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


def _add_file(zf: zipfile.ZipFile, archive_path: str, source: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    with source.open("rb") as input_handle, zf.open(archive_path, "w", force_zip64=True) as output_handle:
        while True:
            chunk = input_handle.read(CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
            output_handle.write(chunk)
    return {"path": archive_path, "size": size, "sha256": digest.hexdigest()}


def create_backup_bundle(
    *,
    client_state: dict[str, Any] | None = None,
    include_books: bool = False,
    destination: Path | None = None,
    paths: BackupPaths | None = None,
) -> tuple[Path, dict[str, Any]]:
    paths = paths or default_paths()
    client = _normalize_client_state(client_state or {}, include_progress=True)
    with _OPERATION_LOCK:
        library = _validate_library(_read_json(paths.library_path, {"version": 4, "books": [], "folders": []}))
        annotations = _validate_annotations(_read_json(paths.annotations_path, {"version": 1, "annotations": []}))
        progress = _validate_progress(_read_json(paths.progress_path, {"version": 1, "progress": {}}))
        progress = _merge_client_progress(library, progress, client.pop("progress", {}))

        sources: list[tuple[str, Path]] = []
        fonts = []
        if paths.fonts_dir.exists():
            for font in sorted(paths.fonts_dir.iterdir(), key=lambda item: item.name.casefold()):
                if font.is_symlink() or not font.is_file() or font.suffix.lower() not in ALLOWED_FONT_EXTENSIONS:
                    continue
                safe_name = _safe_basename(font.name, label="font filename")
                sources.append((f"fonts/{safe_name}", font))
                fonts.append(font)

        if include_books:
            for record in library.get("books", []):
                stored = _safe_basename(record.get("stored_filename"), label="stored filename")
                source = paths.books_dir / stored
                if not source.is_file() or source.is_symlink():
                    raise BackupValidationError(f"Full backup is missing a managed book: {stored}")
                sources.append((f"books/{stored}", source))

        owns_destination = destination is None
        if destination is None:
            fd, temp_name = tempfile.mkstemp(prefix="bookreader-backup-", suffix=".bookreader-backup")
            os.close(fd)
            destination = Path(temp_name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
        files: list[dict[str, Any]] = []
        completed = False
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
                files.append(_add_bytes(zf, "stores/library.json", _json_bytes(library)))
                files.append(_add_bytes(zf, "stores/annotations.json", _json_bytes(annotations)))
                files.append(_add_bytes(zf, "stores/reading-progress.json", _json_bytes(progress)))
                files.append(_add_bytes(zf, "frontend/state.json", _json_bytes(client)))
                for archive_path, source in sources:
                    files.append(_add_file(zf, archive_path, source))
                manifest = {
                    "format": BACKUP_FORMAT,
                    "schema_version": BACKUP_SCHEMA_VERSION,
                    "kind": "full" if include_books else "data",
                    "app_version": APP_VERSION,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "file_count": len(files),
                    "files": files,
                    "counts": {
                        "books": len(library.get("books", [])),
                        "annotations": len(annotations.get("annotations", [])),
                        "progress": len(progress.get("progress", {})),
                        "fonts": len(fonts),
                    },
                }
                zf.writestr("manifest.json", _json_bytes(manifest))
            with temporary.open("r+b") as handle:
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
            completed = True
            return destination, manifest
        finally:
            temporary.unlink(missing_ok=True)
            if owns_destination and not completed:
                destination.unlink(missing_ok=True)


def _safe_archive_name(name: str) -> str:
    if not name or "\\" in name or "\x00" in name:
        raise BackupValidationError("Unsafe archive path")
    candidate = PurePosixPath(name)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise BackupValidationError(f"Unsafe archive path: {name}")
    return candidate.as_posix()


def _validate_font(zf: zipfile.ZipFile, info: zipfile.ZipInfo) -> None:
    ext = Path(info.filename).suffix.lower()
    if ext not in ALLOWED_FONT_EXTENSIONS:
        raise BackupValidationError(f"Unsupported font in backup: {info.filename}")
    with zf.open(info) as handle:
        prefix = handle.read(4)
    if not any(prefix.startswith(signature) for signature in FONT_SIGNATURES[ext]):
        raise BackupValidationError(f"Invalid font signature: {info.filename}")


def inspect_backup_bundle(bundle_path: Path) -> ValidatedBackup:
    if bundle_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise BackupValidationError("Backup archive is too large")
    try:
        with zipfile.ZipFile(bundle_path, "r") as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ENTRIES:
                raise BackupValidationError("Backup contains too many files")
            names: set[str] = set()
            normalized_names: set[str] = set()
            info_by_name: dict[str, zipfile.ZipInfo] = {}
            total_size = 0
            for info in infos:
                name = _safe_archive_name(info.filename)
                normalized = unicodedata.normalize("NFC", name).casefold()
                if name in names or normalized in normalized_names:
                    raise BackupValidationError(f"Duplicate archive path: {name}")
                mode = info.external_attr >> 16
                file_type = stat.S_IFMT(mode)
                if info.is_dir() or file_type == stat.S_IFLNK or file_type not in {0, stat.S_IFREG}:
                    raise BackupValidationError(f"Non-regular archive member: {name}")
                if info.flag_bits & 0x1:
                    raise BackupValidationError("Encrypted backups are not supported")
                if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise BackupValidationError("Unsupported backup compression")
                if info.file_size and info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                    raise BackupValidationError("Suspicious backup compression ratio")
                total_size += info.file_size
                names.add(name)
                normalized_names.add(normalized)
                info_by_name[name] = info
            if total_size > MAX_UNCOMPRESSED_BYTES:
                raise BackupValidationError("Backup expands beyond the safety limit")
            manifest_info = info_by_name.get("manifest.json")
            if manifest_info is None or manifest_info.file_size > MAX_MANIFEST_BYTES:
                raise BackupValidationError("Backup manifest is missing or too large")
            manifest = json.loads(zf.read(manifest_info).decode("utf-8"))
            if (
                not isinstance(manifest, dict)
                or manifest.get("format") != BACKUP_FORMAT
                or manifest.get("schema_version") != BACKUP_SCHEMA_VERSION
                or manifest.get("kind") not in {"data", "full"}
                or not isinstance(manifest.get("files"), list)
            ):
                raise BackupValidationError("Unsupported backup manifest")
            expected = {str(item.get("path")): item for item in manifest["files"] if isinstance(item, dict)}
            if len(expected) != len(manifest["files"]) or set(info_by_name) != set(expected) | {"manifest.json"}:
                raise BackupValidationError("Backup file list does not match its manifest")
            if manifest.get("file_count") != len(expected):
                raise BackupValidationError("Backup file count does not match its manifest")
            required = set(STORE_ARCHIVES) | {"frontend/state.json"}
            if not required.issubset(expected):
                raise BackupValidationError("Backup is missing required data")
            for name, entry in expected.items():
                _safe_archive_name(name)
                if not (name in required or name.startswith("fonts/") or name.startswith("books/")):
                    raise BackupValidationError(f"Unexpected backup file: {name}")
                if manifest["kind"] == "data" and name.startswith("books/"):
                    raise BackupValidationError("Data backup cannot contain book files")
                info = info_by_name.get(name)
                if info is None or entry.get("size") != info.file_size:
                    raise BackupValidationError(f"Backup size mismatch: {name}")
                digest = hashlib.sha256()
                with zf.open(info) as handle:
                    while True:
                        chunk = handle.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        digest.update(chunk)
                if digest.hexdigest() != entry.get("sha256"):
                    raise BackupValidationError(f"Backup checksum mismatch: {name}")
                if name.startswith("fonts/"):
                    _safe_basename(name.removeprefix("fonts/"), label="font filename")
                    _validate_font(zf, info)
                if name.startswith("books/"):
                    _safe_basename(name.removeprefix("books/"), label="book filename")

            library = _validate_library(json.loads(zf.read("stores/library.json").decode("utf-8")))
            annotations = _validate_annotations(json.loads(zf.read("stores/annotations.json").decode("utf-8")))
            progress = _validate_progress(json.loads(zf.read("stores/reading-progress.json").decode("utf-8")))
            client_state = _normalize_client_state(json.loads(zf.read("frontend/state.json").decode("utf-8")), include_progress=False)
            book_ids = {str(item["id"]) for item in library.get("books", [])}
            warnings = []
            orphan_annotations = sum(
                1 for item in annotations.get("annotations", []) if isinstance(item, dict) and str(item.get("book_id")) not in book_ids
            )
            orphan_progress = sum(1 for book_id in progress.get("progress", {}) if str(book_id) not in book_ids)
            if orphan_annotations:
                warnings.append(f"{orphan_annotations} annotation(s) refer to books outside the backup")
            if orphan_progress:
                warnings.append(f"{orphan_progress} progress record(s) refer to books outside the backup")
            expected_books = {f"books/{item['stored_filename']}" for item in library.get("books", [])}
            archive_books = {name for name in expected if name.startswith("books/")}
            if manifest["kind"] == "full" and expected_books != archive_books:
                raise BackupValidationError("Full backup book files do not match the library")
            return ValidatedBackup(manifest, library, annotations, progress, client_state, warnings)
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile, UnicodeError, json.JSONDecodeError, KeyError) as exc:
        if isinstance(exc, BackupValidationError):
            raise
        raise BackupValidationError("Backup archive is damaged or invalid") from exc


def _session_path(paths: BackupPaths, restore_id: str) -> Path:
    if not SESSION_ID_RE.fullmatch(restore_id):
        raise BackupValidationError("Invalid restore session")
    return paths.sessions_dir / restore_id


def _prune_sessions(paths: BackupPaths) -> None:
    if not paths.sessions_dir.exists():
        return
    cutoff = datetime.now(timezone.utc).timestamp() - SESSION_TTL.total_seconds()
    for candidate in paths.sessions_dir.iterdir():
        try:
            if candidate.is_dir() and candidate.stat().st_mtime < cutoff:
                shutil.rmtree(candidate)
        except OSError:
            continue


def create_restore_session(bundle_path: Path, *, paths: BackupPaths | None = None) -> tuple[str, ValidatedBackup]:
    paths = paths or default_paths()
    validated = inspect_backup_bundle(bundle_path)
    with _OPERATION_LOCK:
        _prune_sessions(paths)
        restore_id = uuid4().hex
        session = _session_path(paths, restore_id)
        session.mkdir(parents=True)
        destination = session / "bundle.bookreader-backup"
        shutil.move(str(bundle_path), destination)
        (session / "session.json").write_bytes(_json_bytes({"created_at": datetime.now(timezone.utc).isoformat()}))
    return restore_id, validated


def discard_restore_session(restore_id: str, *, paths: BackupPaths | None = None) -> None:
    paths = paths or default_paths()
    with _OPERATION_LOCK:
        shutil.rmtree(_session_path(paths, restore_id), ignore_errors=True)


def _copy_member(zf: zipfile.ZipFile, archive_path: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.extracting")
    try:
        with zf.open(archive_path) as source, temporary.open("wb") as output:
            shutil.copyfileobj(source, output, CHUNK_SIZE)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _prepare_stage(bundle: Path, validated: ValidatedBackup, stage: Path, paths: BackupPaths) -> None:
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    with zipfile.ZipFile(bundle, "r") as zf:
        for archive_path, filename in STORE_ARCHIVES.items():
            _copy_member(zf, archive_path, stage / filename)
        fonts_stage = stage / "fonts"
        fonts_stage.mkdir()
        for entry in validated.manifest["files"]:
            archive_path = entry["path"]
            if archive_path.startswith("fonts/"):
                _copy_member(zf, archive_path, fonts_stage / archive_path.removeprefix("fonts/"))
        books_stage = stage / "books"
        if validated.manifest["kind"] == "full":
            books_stage.mkdir()
            for entry in validated.manifest["files"]:
                archive_path = entry["path"]
                if archive_path.startswith("books/"):
                    _copy_member(zf, archive_path, books_stage / archive_path.removeprefix("books/"))

    if validated.manifest["kind"] == "data":
        current_library = _validate_library(_read_json(paths.library_path, {"version": 4, "books": [], "folders": []}))
        current_annotations = _validate_annotations(_read_json(paths.annotations_path, {"version": 1, "annotations": []}))
        current_progress = _validate_progress(_read_json(paths.progress_path, {"version": 1, "progress": {}}))
        current_by_id = {str(item["id"]): item for item in current_library.get("books", []) if isinstance(item, dict) and item.get("id")}
        restored_ids: set[str] = set()
        merged_books = list(current_library.get("books", []))
        merged_index = {str(item["id"]): index for index, item in enumerate(merged_books) if isinstance(item, dict) and item.get("id")}
        for backup_record in validated.library.get("books", []):
            book_id = str(backup_record["id"])
            current = current_by_id.get(book_id)
            if current is None:
                raise BackupValidationError(f"Data-only restore cannot match book: {backup_record.get('filename') or book_id}")
            backup_fingerprint = backup_record.get("content_fingerprint")
            current_fingerprint = current.get("content_fingerprint")
            if backup_fingerprint and current_fingerprint and backup_fingerprint != current_fingerprint:
                raise BackupValidationError(f"Book content changed since this backup: {backup_record.get('filename') or book_id}")
            stored = _safe_basename(current.get("stored_filename"), label="stored filename")
            if not (paths.books_dir / stored).is_file():
                raise BackupValidationError(f"Managed book is missing: {stored}")
            restored = dict(backup_record)
            for key in ("id", "filename", "stored_filename", "size", "content_fingerprint", "content_fingerprint_size", "content_fingerprint_mtime_ns"):
                if key in current:
                    restored[key] = current[key]
            restored["file_missing"] = False
            merged_books[merged_index[book_id]] = restored
            restored_ids.add(book_id)
        folders_by_id = {
            str(item.get("id")): item for item in current_library.get("folders", []) if isinstance(item, dict) and item.get("id")
        }
        for folder in validated.library.get("folders", []):
            if isinstance(folder, dict) and folder.get("id"):
                folders_by_id[str(folder["id"])] = folder
        merged_library = {"version": 4, "books": merged_books, "folders": list(folders_by_id.values())}
        backup_annotations = [item for item in validated.annotations.get("annotations", []) if str(item.get("book_id")) in restored_ids]
        kept_annotations = [item for item in current_annotations.get("annotations", []) if str(item.get("book_id")) not in restored_ids]
        backup_annotation_ids = {str(item.get("id")) for item in backup_annotations if item.get("id")}
        if any(str(item.get("id")) in backup_annotation_ids for item in kept_annotations if item.get("id")):
            raise BackupValidationError("Annotation id conflict during data restore")
        merged_progress = dict(current_progress.get("progress", {}))
        for book_id in restored_ids:
            if book_id in validated.progress.get("progress", {}):
                merged_progress[book_id] = validated.progress["progress"][book_id]
            else:
                merged_progress.pop(book_id, None)
        (stage / "library.json").write_bytes(_json_bytes(merged_library))
        (stage / "annotations.json").write_bytes(_json_bytes({"version": 1, "annotations": kept_annotations + backup_annotations}))
        (stage / "reading-progress.json").write_bytes(_json_bytes({"version": 1, "progress": merged_progress}))


def _write_restore_journal(paths: BackupPaths, payload: dict[str, Any]) -> None:
    paths.restore_journal_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = paths.restore_journal_path.with_name(f".{paths.restore_journal_path.name}.tmp")
    with temporary.open("wb") as handle:
        handle.write(_json_bytes(payload))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, paths.restore_journal_path)


def _remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def recover_interrupted_restore(*, paths: BackupPaths | None = None) -> bool:
    paths = paths or default_paths()
    if not paths.restore_journal_path.exists():
        return False
    with _OPERATION_LOCK:
        try:
            journal = json.loads(paths.restore_journal_path.read_text(encoding="utf-8"))
            restore_id = str(journal["restore_id"])
            phase = journal["phase"]
            kind = journal["kind"]
            original_missing = journal.get("original_missing", {})
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise BackupValidationError("Restore journal is damaged") from exc
        session = _session_path(paths, restore_id)
        old_root = session / "old"
        targets = {
            "library.json": paths.library_path,
            "annotations.json": paths.annotations_path,
            "reading-progress.json": paths.progress_path,
            "fonts": paths.fonts_dir,
        }
        if kind == "full":
            targets["books"] = paths.books_dir
        if phase != "committed":
            for name, live in targets.items():
                old = old_root / name
                if old.exists():
                    _remove_path(live)
                    old.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(old, live)
                elif original_missing.get(name):
                    _remove_path(live)
        shutil.rmtree(session, ignore_errors=True)
        paths.restore_journal_path.unlink(missing_ok=True)
        return True


def apply_restore_session(
    restore_id: str,
    *,
    current_client_state: dict[str, Any] | None = None,
    paths: BackupPaths | None = None,
) -> dict[str, Any]:
    global _RESTORE_IN_PROGRESS
    paths = paths or default_paths()
    with _OPERATION_LOCK:
        if paths.delete_journal_path.exists():
            raise BackupValidationError("Finish pending book deletion before restoring a backup")
        if paths.restore_journal_path.exists():
            recover_interrupted_restore(paths=paths)
        session = _session_path(paths, restore_id)
        bundle = session / "bundle.bookreader-backup"
        if not bundle.is_file():
            raise BackupValidationError("Restore session expired or does not exist")
        try:
            created = datetime.fromisoformat(json.loads((session / "session.json").read_text(encoding="utf-8"))["created_at"])
        except (OSError, json.JSONDecodeError, KeyError, ValueError) as exc:
            raise BackupValidationError("Restore session is invalid") from exc
        if datetime.now(timezone.utc) - created > SESSION_TTL:
            discard_restore_session(restore_id, paths=paths)
            raise BackupValidationError("Restore session expired")
        validated = inspect_backup_bundle(bundle)
        stage = session / "stage"
        _prepare_stage(bundle, validated, stage, paths)

        paths.backups_dir.mkdir(parents=True, exist_ok=True)
        snapshot_name = f"pre-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{restore_id[:8]}.bookreader-backup"
        snapshot_path = paths.backups_dir / snapshot_name
        try:
            create_backup_bundle(client_state=current_client_state or {}, include_books=True, destination=snapshot_path, paths=paths)
        except BackupValidationError:
            snapshot_name = f"pre-restore-data-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{restore_id[:8]}.bookreader-backup"
            snapshot_path = paths.backups_dir / snapshot_name
            create_backup_bundle(client_state=current_client_state or {}, include_books=False, destination=snapshot_path, paths=paths)

        targets = {
            "library.json": paths.library_path,
            "annotations.json": paths.annotations_path,
            "reading-progress.json": paths.progress_path,
            "fonts": paths.fonts_dir,
        }
        if validated.manifest["kind"] == "full":
            targets["books"] = paths.books_dir
        original_missing = {name: not live.exists() for name, live in targets.items()}
        journal = {
            "version": 1,
            "restore_id": restore_id,
            "kind": validated.manifest["kind"],
            "phase": "prepared",
            "original_missing": original_missing,
        }
        _write_restore_journal(paths, journal)
        old_root = session / "old"
        old_root.mkdir()
        _RESTORE_IN_PROGRESS = True
        try:
            for name, live in targets.items():
                old = old_root / name
                old.parent.mkdir(parents=True, exist_ok=True)
                if live.exists():
                    os.replace(live, old)
                replacement = stage / name
                if replacement.exists():
                    os.replace(replacement, live)
            _validate_library(_read_json(paths.library_path, {}))
            _validate_annotations(_read_json(paths.annotations_path, {}))
            _validate_progress(_read_json(paths.progress_path, {}))
            journal["phase"] = "committed"
            _write_restore_journal(paths, journal)
        except Exception:
            recover_interrupted_restore(paths=paths)
            raise
        finally:
            _RESTORE_IN_PROGRESS = False

        shutil.rmtree(session, ignore_errors=True)
        paths.restore_journal_path.unlink(missing_ok=True)
        return {
            "ok": True,
            "kind": validated.manifest["kind"],
            "snapshot_filename": snapshot_name,
            "client_state": validated.client_state,
        }
