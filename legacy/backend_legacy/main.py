from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.books import router as books_router

app = FastAPI(title="Universal Book Reader API", version="1.0.0")

# CORS — allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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

# Ensure books directory exists on startup
BOOKS_DIR = Path(__file__).resolve().parent / "books"


@app.on_event("startup")
async def startup():
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/")
async def root():
    return {"message": "Universal Book Reader API", "docs": "/docs"}
