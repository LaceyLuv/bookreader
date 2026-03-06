from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.books import router as books_router
from routers.fonts import router as fonts_router
from paths import BOOKS_DIR, FONTS_DIR


@asynccontextmanager
async def lifespan(app: FastAPI):
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Universal Book Reader API", version="1.0.0", lifespan=lifespan)

# CORS — allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(books_router)
app.include_router(fonts_router)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/")
async def root():
    return {"message": "Universal Book Reader API", "docs": "/docs"}
