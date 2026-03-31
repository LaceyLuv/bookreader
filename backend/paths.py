from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
BOOKS_DIR = (BASE_DIR / "books").resolve()
FONTS_DIR = (BASE_DIR / "fonts").resolve()
LIBRARY_DATA_PATH = (BASE_DIR / "library.json").resolve()
ANNOTATIONS_DATA_PATH = (BASE_DIR / "annotations.json").resolve()
