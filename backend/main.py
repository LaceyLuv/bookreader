from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from paths import BOOKS_DIR, FONTS_DIR
from routers.annotations import router as annotations_router
from routers.books import router as books_router
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

app.include_router(books_router)
app.include_router(fonts_router)
app.include_router(annotations_router)
app.include_router(library_folders_router)


@app.get('/api/health')
async def health():
    return {'ok': True}


@app.get('/')
async def root():
    return {'message': 'Universal Book Reader API', 'docs': '/docs'}
