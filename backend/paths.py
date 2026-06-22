import os
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
APP_DATA_DIR_NAME = "BookReader"
DATA_DIR_ENV = "BOOKREADER_DATA_DIR"


def _platform_app_data_dir() -> Path:
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if root:
            return Path(root) / APP_DATA_DIR_NAME

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DATA_DIR_NAME

    root = os.environ.get("XDG_DATA_HOME")
    if root:
        return Path(root) / APP_DATA_DIR_NAME
    return Path.home() / ".local" / "share" / APP_DATA_DIR_NAME


def _resolve_data_dir() -> Path:
    configured = os.environ.get(DATA_DIR_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return _platform_app_data_dir().resolve()
    return BASE_DIR


DATA_DIR = _resolve_data_dir()
BOOKS_DIR = (DATA_DIR / "books").resolve()
FONTS_DIR = (DATA_DIR / "fonts").resolve()
LIBRARY_DATA_PATH = (DATA_DIR / "library.json").resolve()
ANNOTATIONS_DATA_PATH = (DATA_DIR / "annotations.json").resolve()
