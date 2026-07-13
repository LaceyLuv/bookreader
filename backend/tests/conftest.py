import os
import shutil
import sys
import tempfile
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR_ENV = "BOOKREADER_DATA_DIR"
_PREVIOUS_DATA_DIR = os.environ.get(DATA_DIR_ENV)
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="bookreader-pytest-")).resolve()

# Configure isolation before test modules import paths.py and freeze its globals.
os.environ[DATA_DIR_ENV] = str(_TEST_DATA_DIR)

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def pytest_sessionfinish(session, exitstatus):
    del session, exitstatus
    if _PREVIOUS_DATA_DIR is None:
        os.environ.pop(DATA_DIR_ENV, None)
    else:
        os.environ[DATA_DIR_ENV] = _PREVIOUS_DATA_DIR
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
