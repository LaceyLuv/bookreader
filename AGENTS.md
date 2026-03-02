# BookReader (project instructions for Codex)

## Project summary
- Local reader app for TXT / EPUB / ZIP(comics).
- Web: React 19 + Vite 6, Backend: FastAPI
- Desktop: Tauri v2 + Python backend sidecar (legacy, inactive)
- Status: Clean stack rebuild (2026-03-01). Legacy code preserved in `legacy/`.

## Critical paths / entrypoints
- backend: backend/run_server.py
- frontend: frontend/src/main.jsx
- legacy backend: legacy/backend_legacy/ (full previous implementation)
- legacy frontend: legacy/frontend_legacy/ (full previous implementation)

## Run commands (dev)
- backend:
  - cd backend
  - pip install -r requirements.txt
  - python run_server.py
  - → http://127.0.0.1:8000
- frontend:
  - cd frontend
  - npm install
  - npm run dev
  - → http://127.0.0.1:5174

## Non-negotiable conventions
- Upload endpoint: POST /api/books (prefix /api/books + @router.post(""))
- Web dev uses Vite proxy: /api -> http://127.0.0.1:8000
- Tauri spawns sidecar: bookreader-backend --host 127.0.0.1 --port 8000
- frontend/src/lib/apiBase.js decides API_BASE based on Tauri runtime

## Output preference
- Prefer minimal diffs.
- List changed files + rationale.
- Provide manual verification steps for both web + desktop paths.
- Avoid adding new runtime dependencies unless necessary; if needed, explain why.
