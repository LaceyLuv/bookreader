from contextlib import asynccontextmanager

import hmac
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from paths import BOOKS_DIR, DELETE_JOURNAL_PATH, FONTS_DIR
from routers.annotations import router as annotations_router
from routers import books as books_router_module
from routers.fonts import router as fonts_router
from routers.library_folders import router as library_folders_router
from routers.reading_progress import router as reading_progress_router
from routers.data_backup import router as data_backup_router
from services.annotation_store import ensure_annotation_store
from services.library_store import ensure_library_store
from services.reading_progress_store import ensure_reading_progress_store
from services.delete_recovery import recover_pending_deletes
from services.backup_service import APP_VERSION, is_restore_in_progress, recover_interrupted_restore


@asynccontextmanager
async def lifespan(app: FastAPI):
    recover_interrupted_restore()
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_library_store()
    ensure_annotation_store()
    ensure_reading_progress_store()
    recover_pending_deletes(books_dir=BOOKS_DIR, journal_path=DELETE_JOURNAL_PATH)
    yield


app = FastAPI(title='Gyeol Reader API', version=APP_VERSION, lifespan=lifespan)

SIDECAR_NONCE = os.environ.get('BOOKREADER_SIDECAR_NONCE')
SIDECAR_ASSET_TOKEN = os.environ.get('BOOKREADER_SIDECAR_ASSET_TOKEN')


@app.middleware('http')
async def authenticate_sidecar_requests(request: Request, call_next):
    """Require a per-launch secret only in the packaged sidecar process."""
    if SIDECAR_NONCE and request.method != 'OPTIONS' and request.url.path.startswith('/api/'):
        supplied = request.headers.get('x-bookreader-nonce', '')
        binary_asset_path = (
            request.method == 'GET'
            and request.url.path.startswith('/api/books/')
            and ('/asset/' in request.url.path or '/image/' in request.url.path)
        )
        supplied_asset_token = request.query_params.get('asset_token', '') if binary_asset_path else ''
        asset_authorized = bool(
            binary_asset_path
            and SIDECAR_ASSET_TOKEN
            and hmac.compare_digest(supplied_asset_token, SIDECAR_ASSET_TOKEN)
        )
        if not hmac.compare_digest(supplied, SIDECAR_NONCE) and not asset_authorized:
            return JSONResponse({'detail': 'Unauthorized'}, status_code=401)
    return await call_next(request)


@app.middleware('http')
async def reject_requests_during_restore(request: Request, call_next):
    if is_restore_in_progress() and not request.url.path.startswith('/api/data/restores/'):
        return JSONResponse({'detail': 'Data restore in progress'}, status_code=503)
    return await call_next(request)


@app.middleware('http')
async def reject_oversized_book_uploads(request: Request, call_next):
    if request.method == 'POST' and request.url.path.rstrip('/') == '/api/books':
        raw_value = request.headers.get('content-length')
        if raw_value is not None:
            try:
                content_length = int(raw_value)
            except ValueError:
                content_length = 0
            if content_length > books_router_module.MAX_BOOK_UPLOAD_REQUEST_BYTES:
                return JSONResponse({'detail': 'Book file is too large'}, status_code=413)
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'tauri://localhost',
        'http://tauri.localhost',
        'https://tauri.localhost',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['Content-Type', 'X-BookReader-Nonce'],
)

app.include_router(books_router_module.router)
app.include_router(fonts_router)
app.include_router(annotations_router)
app.include_router(library_folders_router)
app.include_router(reading_progress_router)
app.include_router(data_backup_router)


@app.get('/api/health')
async def health():
    return {'ok': True, 'authenticated': bool(SIDECAR_NONCE)}


@app.get('/')
async def root():
    return {'message': 'Gyeol Reader API', 'docs': '/docs'}
