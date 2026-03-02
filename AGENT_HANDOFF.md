# BookReader 작업자 전달 문서
> **최종 갱신**: 2026-03-01 — legacy 백업 & 클린 스택 재생성 완료

---

## 1) 프로젝트 정의

**BookReader**는 TXT / EPUB / ZIP(코믹) 파일을 업로드하고, 데스크톱 앱(Tauri) 또는 웹(Vite)에서 읽는 **로컬 리더 앱**이다.

**핵심 문제정의**: 다양한 전자책/문서 포맷을 하나의 UX(페이지 이동, 북마크, 진행률, 테마)로 통합해서 읽기 경험을 단순화한다.

---

## 2) 현재 상태 (2026-03-01)

기존 코드를 `legacy/`로 백업한 뒤, **최소 클린 스택**을 새로 생성한 상태이다.

| 경로 | 설명 |
|------|------|
| `backend/` | **새 백엔드** — FastAPI, `/api/health`, `/api/books`(빈 배열) |
| `frontend/` | **새 프론트엔드** — React 19 + Vite 6, `/api/books` fetch → 표시 |
| `legacy/backend_legacy/` | 기존 백엔드 전체 보존 (routers, services, models, books/) |
| `legacy/frontend_legacy/` | 기존 프론트엔드 전체 보존 (components, pages, hooks, Tauri, Tailwind 등) |

> ⚠️ 새 스택은 **빈 스켈레톤**이므로, 기능을 구현하려면 `legacy/` 코드를 참고하여 마이그레이션해야 한다.

---

## 3) 아키텍처 요약

```
[사용자] → 브라우저(127.0.0.1:5174) → Vite proxy(/api) → FastAPI(127.0.0.1:8000)
                                                            ↕
                                                      로컬 파일 시스템 (books/)
```

- **Backend**: FastAPI — 도서 CRUD + 포맷별 콘텐츠 API
- **Frontend**: React + Vite — Dashboard(도서 목록) + Reader(포맷별 리더)
- **Desktop** (legacy): Tauri v2 — Python backend sidecar(PyInstaller exe)로 앱 내장
- **데이터 흐름**: `파일 업로드 → backend/books 저장 → /api/books* 조회 → 리더 렌더 → 진행률/북마크 localStorage 저장`

---

## 4) 실행 방법

### 웹 개발 (현재 새 스택)
```powershell
# 터미널 1 — Backend
cd c:\dev\bookreader\backend
pip install -r requirements.txt
python run_server.py
# → http://127.0.0.1:8000

# 터미널 2 — Frontend
cd c:\dev\bookreader\frontend
npm install
npm run dev
# → http://127.0.0.1:5174
```

### 데스크톱 (legacy — 현재 비활성)
```powershell
cd frontend
npm run desktop:dev      # 개발
npm run desktop:build    # 빌드
```

---

## 5) API 엔드포인트 (legacy 기준, 재구현 대상)

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/health` | 헬스 체크 ✅ (새 스택에 구현됨) |
| `GET` | `/api/books` | 도서 목록 (새 스택: 빈 배열 반환) |
| `POST` | `/api/books` | 파일 업로드 |
| `DELETE` | `/api/books/{book_id}` | 도서 삭제 |
| `GET` | `/api/books/{book_id}/content` | TXT 텍스트 반환 (chardet 인코딩 감지) |
| `GET` | `/api/books/{book_id}/toc` | EPUB 목차 |
| `GET` | `/api/books/{book_id}/chapter/{idx}` | EPUB 챕터 HTML |
| `GET` | `/api/books/{book_id}/images` | ZIP 이미지 목록 |
| `GET` | `/api/books/{book_id}/image/{name}` | ZIP 개별 이미지 |

---

## 6) Legacy 코드 구조 (참조용)

### Backend (`legacy/backend_legacy/`)
```
main.py                    # FastAPI app, CORS, router 마운트
models.py                  # Pydantic 모델 (BookMeta, TxtContent, EpubToc, EpubChapter, ZipImageList)
routers/books.py           # 모든 API 엔드포인트 (CRUD + 포맷별 리더 API)
services/
  txt_service.py           # chardet 인코딩 감지 + 텍스트 반환
  epub_service.py           # ebooklib + BeautifulSoup으로 TOC/챕터 파싱
  zip_service.py            # natsort로 이미지 정렬 + 개별 이미지 서빙
run_server.py               # uvicorn 실행 엔트리
build_sidecar.ps1           # PyInstaller → Tauri sidecar 바이너리 빌드
books/                      # 업로드된 파일 저장 디렉터리
requirements.txt            # fastapi, uvicorn, chardet, ebooklib, lxml, beautifulsoup4, natsort
```

### Frontend (`legacy/frontend_legacy/`)
```
index.html                  # Boot watchdog 스크립트 포함
package.json                # React 19, Vite 7, Tauri v2, TailwindCSS 3, react-router-dom 7
vite.config.js              # proxy, Tauri 빌드 설정
tailwind.config.js / postcss.config.js
src/
  main.jsx                  # React 초기화 + BrowserRouter
  App.jsx                   # 라우팅: / (Dashboard), /read/txt/:id, /read/epub/:id, /read/zip/:id
  pages/
    Dashboard.jsx            # 도서 목록 + 업로드 UI
  components/
    TxtReader.jsx            # CSS column 기반 가로 페이지네이션 + scroll snap
    EpubReader.jsx           # 챕터 단위 + 챕터 내부 컬럼 페이지네이션
    ZipReader.jsx            # 단일/양면 이미지 뷰
    ReaderToolbar.jsx        # 읽기 설정 (폰트, 여백, 테마 등)
    ReaderProgressBar.jsx    # 진행률 표시
    TitleBar.jsx             # 타이틀바 (Tauri 커스텀 윈도우)
    ResumeToast.jsx          # 이어읽기 안내 토스트
  hooks/
    useReaderSettings.js     # 리더 설정 (폰트 크기, margin, lineHeight 등 localStorage)
    useReadingProgress.js    # 진행률 저장/복원 (localStorage, bookId별 관리)
    useKeyboardNav.js        # 키보드 페이지 이동 (좌우 화살표, 스페이스)
  lib/
    apiBase.js               # IS_TAURI_RUNTIME → API_BASE 결정 (Tauri: 절대 URL, 웹: 상대 경로)
    appChrome.js             # 테마 CSS 변수 적용, 타이틀바 높이 제어
  constants/
    themes.js                # 6종 테마 프리셋 (소프트 화이트, 세피아, 미드나잇 다크 등)
  i18n.js                    # 다국어 지원 (한국어/영어)
scripts/
  tauri-wrapper.cjs          # CARGO_TARGET_DIR 우회 스크립트
  vite-dev.cjs               # Vite dev 서버 래퍼
src-tauri/                   # Tauri v2 Rust 코드
  src/lib.rs                 # sidecar spawn/kill, 앱 윈도우 설정
  tauri.conf.json            # 앱 설정 (identifier, CSP, externalBin)
  capabilities/default.json  # 권한 (shell:allow-spawn 등)
  binaries/                  # sidecar 바이너리 (bookreader-backend-*.exe)
```

---

## 7) 핵심 설정 포인트 / 함정

| 주제 | 주의사항 |
|------|----------|
| **API 경로** | 업로드는 `POST /api/books` (`@router.post("")` + prefix `/api/books`) |
| **Vite proxy** | 웹 개발 시 `/api` → `http://127.0.0.1:8000` (vite.config.js) |
| **Tauri sidecar** | `bookreader-backend-<target-triple>.exe` 이름 규칙 필수 |
| **CARGO_TARGET_DIR** | `tauri-wrapper.cjs`가 `%LOCALAPPDATA%\bookreader-tauri-target`으로 우회 |
| **Book ID** | `md5(filename)[:12]` 해시 — 같은 파일명이면 같은 ID |
| **진행률 저장** | `localStorage` key: `bookreader_progress` / `bookreader_settings` |
| **테마** | CSS 변수 `--app-bg`, `--app-fg`로 런타임 적용 |
| **인코딩** | TXT는 `chardet`로 자동 감지, fallback 체인 있음 |

---

## 8) 포맷별 렌더링 동작

| 포맷 | Backend 처리 | Frontend 렌더링 |
|------|-------------|-----------------|
| **TXT** | chardet 인코딩 감지 → 전체 텍스트 반환 | CSS column 가로 페이지네이션 + scroll snap |
| **EPUB** | spine 순서 TOC + 이미지 base64 inline | 챕터 단위 + 챕터 내부 컬럼 페이지네이션 |
| **ZIP** | 이미지 파일만 natsort 정렬 | 단일/양면(dual) 이미지 뷰 |

**공통**: `single/spread/dual` 레이아웃 + `columnGap`, margin, lineHeight, letterSpacing

---

## 9) Known Issues / TODO

- [ ] 일부 UI 텍스트/아이콘 깨짐 (인코딩/문자 치환 이슈)
- [ ] 동일 파일명 업로드 시 기존 파일 overwrite (중복 처리 정책 필요)
- [ ] EPUB `dangerouslySetInnerHTML` → sanitize 정책 미정
- [ ] `index.html` boot watchdog 스크립트가 크고 공격적 (디버깅 유리/유지보수 복잡)
- [ ] 새 스택에 기존 기능 마이그레이션 필요 (업로드, 리더, 테마, 설정 등)

---

## 10) CONTEXT_JSON (새 세션 붙여넣기용)

```json
{
  "project": "bookreader",
  "status": "clean-stack-rebuild (2026-03-01)",
  "stack": {
    "backend": "FastAPI (Python 3.x)",
    "frontend": "React 19 + Vite 6",
    "desktop": "Tauri v2 + sidecar (legacy, 비활성)"
  },
  "current_state": {
    "backend": "최소 스켈레톤 (/api/health, /api/books 빈 배열)",
    "frontend": "최소 스켈레톤 (fetch /api/books → 표시)",
    "legacy": "legacy/backend_legacy + legacy/frontend_legacy에 전체 보존"
  },
  "entrypoints": {
    "backend": "backend/run_server.py (127.0.0.1:8000)",
    "frontend": "npm run dev (127.0.0.1:5174)",
    "legacy_backend": "legacy/backend_legacy/run_server.py",
    "legacy_frontend": "legacy/frontend_legacy/"
  },
  "api": {
    "base_dev_web": "relative (/api via Vite proxy)",
    "base_tauri": "http://127.0.0.1:8000",
    "books_prefix": "/api/books",
    "endpoints_to_implement": [
      "POST /api/books",
      "DELETE /api/books/{book_id}",
      "GET /api/books/{book_id}/content",
      "GET /api/books/{book_id}/toc",
      "GET /api/books/{book_id}/chapter/{chapter_index}",
      "GET /api/books/{book_id}/images",
      "GET /api/books/{book_id}/image/{image_name:path}"
    ]
  },
  "run_commands": {
    "web_backend": "cd backend && pip install -r requirements.txt && python run_server.py",
    "web_frontend": "cd frontend && npm install && npm run dev"
  },
  "reader_modes": ["single", "spread", "dual"],
  "progress_storage": {
    "settings_key": "bookreader_settings",
    "progress_key": "bookreader_progress"
  },
  "known_issues": [
    "UI 문자열/아이콘 깨짐",
    "동일 파일명 업로드 시 overwrite",
    "EPUB HTML sanitize 정책 미정"
  ]
}
```
