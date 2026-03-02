# BookReader ??Tasks Todo

## Clean Stack Migration (2026-03-01)
- [x] Legacy 諛깆뾽 (backend ??legacy/backend_legacy, frontend ??legacy/frontend_legacy)
- [x] ??FastAPI backend ?ㅼ펷?덊넠 ?앹꽦
- [x] ??React+Vite frontend ?ㅼ펷?덊넠 ?앹꽦
- [x] API 寃利?(/api/health, /api/books)
- [x] ?꾨줈?앺듃 臾몄꽌 ?뺣━ (AGENT_HANDOFF.md, AGENTS.md 媛깆떊)

## ?ㅼ쓬 留덉씠洹몃젅?댁뀡 (TODO)
- [ ] backend: models.py 蹂듭썝 (BookMeta, TxtContent, EpubToc, EpubChapter, ZipImageList)
- [ ] backend: routers/books.py 蹂듭썝 (CRUD + ?щ㎎蹂?API)
- [ ] backend: services/ 蹂듭썝 (txt_service, epub_service, zip_service)
- [ ] backend: requirements.txt??chardet, ebooklib, lxml, beautifulsoup4, natsort 異붽?
- [ ] frontend: react-router-dom ?ㅼ젙
- [ ] frontend: Dashboard ?섏씠吏
- [ ] frontend: TxtReader / EpubReader / ZipReader 而댄룷?뚰듃
- [ ] frontend: ReaderToolbar / ReaderProgressBar / ResumeToast
- [ ] frontend: hooks (useReaderSettings, useReadingProgress, useKeyboardNav)
- [ ] frontend: ?뚮쭏 ?쒖뒪??(themes.js, appChrome.js)
- [ ] frontend: apiBase.js (Tauri ?고???遺꾧린)
- [ ] frontend: i18n (?ㅺ뎅??吏??

## Review
- Legacy 肄붾뱶 蹂댁〈 ?꾨즺, ???ㅽ깮 ?숈옉 寃利??꾨즺
- AGENT_HANDOFF.md???꾩껜 援ъ“/API/?ㅼ젙 臾몄꽌???꾨즺

## Theme/EPUB/Font Work (2026-03-02)
- [ ] backend: EPUB asset endpoint (`GET /api/books/{book_id}/asset/{asset_path:path}`) 異붽?
- [ ] backend: EPUB chapter HTML/CSS URL rewrite + inline style ?⑹꽦
- [ ] backend: ?ъ슜???고듃 ?낅줈??議고쉶/?쒕튃 ?쇱슦??`/api/fonts`) 異붽?
- [ ] backend: startup ??`books/`, `fonts/` ?붾젆?좊━ ?앹꽦 蹂댁옣
- [ ] frontend: ReaderToolbar?먯꽌 old theme key 踰꾪듉 洹몃９ ?쒓굅 (Theme Presets only)
- [ ] frontend: ?ㅼ젙??`fontMode`, `fontFamily` 異붽? 諛????蹂듭썝
- [ ] frontend: ?고듃 紐⑸줉 議고쉶/?낅줈??UI + `@font-face` ?숈쟻 二쇱엯 ?곌껐
- [ ] frontend: Txt/Epub?먯꽌 fontMode蹂?font-family ?곸슜 遺꾧린
- [ ] frontend: EPUB ?대?吏/figure ?쒖떆 蹂댁젙 CSS 異붽?
- [ ] build 寃利?諛?寃곌낵 ?뺣━


## Theme/EPUB/Font Work Review (2026-03-02)
- [x] backend: EPUB asset endpoint (`GET /api/books/{book_id}/asset/{asset_path:path}`) 추가
- [x] backend: EPUB chapter HTML/CSS URL rewrite + inline style 합성
- [x] backend: 사용자 폰트 업로드/조회/서빙 라우터(`/api/fonts`) 추가
- [x] backend: startup 시 `books/`, `fonts/` 디렉토리 생성 보장
- [x] frontend: ReaderToolbar old theme key 버튼 제거 (Theme Presets only)
- [x] frontend: 설정에 `fontMode`, `fontFamily` 추가 및 저장/복원
- [x] frontend: 폰트 목록 조회/업로드 UI + `@font-face` 동적 주입 연결
- [x] frontend: Txt/Epub에서 fontMode별 font-family 적용 분기
- [x] frontend: EPUB 이미지/figure 표시 보정 CSS 추가
- [x] frontend: build 검증 완료
