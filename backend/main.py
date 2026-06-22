from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from paths import BOOKS_DIR, FONTS_DIR
from routers.annotations import router as annotations_router
from routers import books as books_router_module
from routers.fonts import router as fonts_router
from routers.library_folders import router as library_folders_router
from services.annotation_store import ensure_annotation_store
from services.library_store import ensure_library_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_library_store()
    ensure_annotation_store()
    yield


app = FastAPI(title='Universal Book Reader API', version='1.0.0', lifespan=lifespan)


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
    allow_headers=['*'],
)

app.include_router(books_router_module.router)
app.include_router(fonts_router)
app.include_router(annotations_router)
app.include_router(library_folders_router)


@app.get('/api/health')
async def health():
    return {'ok': True}


@app.get('/')
async def root():
    return {'message': 'Universal Book Reader API', 'docs': '/docs'}
