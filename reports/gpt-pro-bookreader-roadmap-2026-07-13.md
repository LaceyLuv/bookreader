# GPT Pro BookReader 심층 검토 원문

- 실행일: 2026-07-13
- 모델: ChatGPT Pro
- 세션: `01KXCHQ2Q5P907ZWTACTSFBJNE`
- 대화: https://chatgpt.com/c/6a54406f-ce5c-83ee-8be8-73ec524104b6
- 기준 브랜치: `codex/reader-settings-panel`
- 기준 커밋: `7c238dd43f4a9b671df32e6f0090a40f6605b76b`

---

# BookReader Windows Local‑First Desktop Reader

## 6개월 제품·기술·UX·QA 결정안

## 1. 근거 장부

### 1.1 검토 기준과 접근 범위

현재 상태는 `master`가 아니라 다음을 기준으로 삼았다.

* 현재 제품 브랜치: [`codex/reader-settings-panel`](https://github.com/LaceyLuv/bookreader/tree/codex/reader-settings-panel)
* 기준 커밋: [`7c238dd43f4a9b671df32e6f0090a40f6605b76b`](https://github.com/LaceyLuv/bookreader/commit/7c238dd43f4a9b671df32e6f0090a40f6605b76b)
* [`master...codex/reader-settings-panel` 비교](https://github.com/LaceyLuv/bookreader/compare/master...codex/reader-settings-panel) 결과: 브랜치가 `master`보다 12커밋 앞서고 뒤처진 커밋은 없으며, 브랜치 HEAD가 기준 커밋과 일치했다.

GitHub 전체 아카이브를 로컬로 내려받는 작업은 실행 환경의 DNS 제한으로 실패했다. 대신 GitHub Contents API를 사용해 **모든 핵심 파일을 기준 SHA에서 직접 열었다.** 첨부 ZIP은 구조·QA·빌드 기록의 보조 근거로만 사용했다. 이 환경에서는 테스트와 설치 빌드를 다시 실행하지 않았으므로, 통과 여부는 “첨부 문서가 보고한 결과”와 “코드에 존재하는 테스트”를 구분해서 기술한다.

`backend/tests/test_library_store.py` 경로는 GitHub에서 404가 반환되어 읽지 못했다. 이 파일이 다른 경로에도 없다고 단정하지 않는다.

### 1.2 실제로 연 파일

**백엔드**

`backend/main.py`, `backend/paths.py`, `backend/models.py`, `backend/routers/books.py`, `backend/routers/reading_progress.py`, `backend/services/library_store.py`, `backend/services/annotation_store.py`, `backend/services/reading_progress_store.py`, `backend/services/delete_recovery.py`, `backend/services/txt_service.py`, `backend/services/txt_transform_service.py`, `backend/services/epub_service.py`, `backend/services/zip_service.py`, `backend/services/search_service.py`

**백엔드 테스트**

`backend/tests/test_txt_service.py`, `backend/tests/test_search_service.py`

**프런트엔드·Tauri**

`frontend/package.json`, `frontend/src/App.jsx`, `frontend/src/pages/Dashboard.jsx`, `frontend/src/components/DashboardSettingsPanel.jsx`, `frontend/src/components/TxtReader.jsx`, `frontend/src/components/EpubReader.jsx`, `frontend/src/components/ZipReader.jsx`, `frontend/src/components/ReaderToolbar.jsx`, `frontend/src/hooks/useReadingProgress.js`, `frontend/src/hooks/useTxtSegmentWindow.js`, `frontend/src/lib/txtMeasuredPagination.js`, `frontend/src/lib/epubSanitizer.js`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/src/main.rs`, `frontend/src-tauri/src/lib.rs`

`README.md`도 열었지만 제품 판단은 README만으로 하지 않았다.

**첨부 ZIP에서 직접 읽은 보조 문서**

`AGENT_HANDOFF.md`, `docs/qa-validation.md`, `docs/performance-size-plan.md`, `tasks/todo.md`

### 1.3 코드·문서로 확인된 사실

1. **기술 스택과 패키징은 사용자 기준선과 일치한다.** 프런트엔드는 React 19, Vite 6, Vitest를 사용하며 Tauri CLI 2 계열과 NSIS 번들을 구성한다. Tauri 설정에는 외부 sidecar 바이너리와 명시적 CSP가 있다.

2. **패키지 sidecar는 단순히 고정 포트 8000을 여는 구조가 아니다.** 릴리스 빌드에서는 빈 루프백 포트를 예약하고, 실행마다 nonce와 asset token을 생성해 Python sidecar에 전달한다. 인증된 health check를 수행하고 Windows 종료 시 `taskkill /T /F`로 하위 프로세스까지 정리한다.

3. **백엔드는 시작할 때 라이브러리·주석·진행률 저장소를 확인하고 미완료 삭제 저널을 복구한다.** 패키지 sidecar에서는 모든 `/api/` 요청에 실행별 nonce를 요구하며 EPUB asset에는 별도 token 경로가 있다.

4. **JSON 저장을 단순한 비원자적 파일 쓰기로 취급해서는 안 된다.** 라이브러리, 주석, 진행률 저장소 모두 임시 파일 쓰기, flush/fsync, 원자적 교체, `.bak` 복구를 갖고 있다. 라이브러리는 버전 4이며 누락 파일 레코드, content fingerprint, 태그, 컬렉션, 시리즈, 중복 관련 필드를 보존한다.

5. **현재 라이브러리는 이미 단순 파일 목록 이상이다.** 제목·저자·태그·컬렉션·독서 상태·즐겨찾기·고정·시리즈·논리 폴더·중복 그룹·버전 정보를 편집하고 필터링하는 UI가 있다. 현재 “폴더”는 외부 파일 시스템 폴더 감시가 아니라 `library_folder_id` 기반 논리적 조직이다.

6. **TXT 프런트엔드는 실제로 구간 로딩을 한다.** 기본 40개 segment, 최대 5개 window cache, 일반 window 128KiB, pagination window 1MiB 제한을 둔다. 측정 페이지네이션은 변환된 display index를 원문 source offset으로 다시 매핑하고 surrogate pair를 자르지 않는다.

7. **그러나 TXT 백엔드는 아직 bounded-memory 원문 처리 구조가 아니다.** 처음 64KiB로 인코딩을 추정한 다음 `file.read()`로 파일 전체를 메모리에 올리고, 전체 Unicode 문자열과 모든 segment range를 만든다. source cache 상한이 256MiB여도, cache에 넣기 전 전체 파일을 이미 읽고 디코딩한다.

8. **줄바꿈이 거의 없는 TXT는 한 개의 거대한 source segment가 된다.** 현재 source segment 경계는 기본적으로 빈 줄 `\n\n`이다. 이후 프런트 측정 페이지네이션에서 잘라 표시할 수는 있지만, 원문 로딩과 source index 비용은 이미 발생한다.

9. **책 내부 검색은 TXT와 EPUB에 이미 구현되어 있으나, 대용량 경로는 아직 비효율적이다.** TXT prewarm cache는 전체 텍스트를 읽으며, 실제 변환 대응 검색은 prewarm 결과를 사용하지 않고 다시 전체 manifest와 fragment를 순회한다. EPUB 검색도 모든 spine chapter의 텍스트를 메모리에 구성한다. 결과 반환은 100개로 제한하지만 전체 match 수를 끝까지 센다.

10. **EPUB과 ZIP에는 상당한 안전장치가 있다.** EPUB은 entry 수, member 크기, 전체 비압축 크기, 압축률, chapter·CSS 크기를 제한한다. ZIP도 10,000개 entry, 5,000개 이미지, 512MiB 비압축 합계, 압축률, 이미지 signature와 member path를 검사한다.

11. **EPUB HTML은 프런트에서 다시 sanitize된다.** script, iframe, object, form 등을 차단하고 URL·CSS를 제한하며 스타일 selector를 `.epub-content` 아래로 scope한다. 반대로 SVG와 Math 요소도 차단하므로, 보안성은 높지만 일부 정상 EPUB의 수식·도형·고급 레이아웃은 보존되지 않는다.

12. **진행률은 이미 이중 저장과 locator를 사용한다.** `localStorage`와 백엔드 JSON을 `updatedAt`으로 비교하고, pagination이 준비된 뒤 locator를 현재 position으로 다시 해석한다. 저장은 180ms debounce와 `pagehide`/unmount flush를 사용한다.

13. **현재 locator는 형식별로 이미 다르지만 하나의 표준 모델로 정리되지 않았다.** 공통 hook은 locator에 `version: 1`을 추가하고, EPUB은 chapter href/index/page, ZIP은 member name/page를 사용한다. 주석 저장소는 별도로 locator 문자열과 page/chapter/segment/offset 필드를 병렬 저장한다.

14. **정상 UI 삭제와 비정상 종료 후 삭제 복구의 불변조건이 다르다.** 정상 Dashboard 경로는 백엔드 삭제가 성공한 뒤 `removeBookProgress()`를 호출한다. 그러나 삭제 저널 재생은 책 레코드와 주석만 지우고 진행률은 지우지 않는다. 저널 자체가 손상되면 `_read()`가 예외를 내며 별도 백업·격리 경로가 없다.

15. **첨부 QA 문서는 프런트 92개, 백엔드 21개 테스트, web build, packaged sidecar health, NSIS, 설치 후 TXT/EPUB/ZIP API 및 WebView smoke가 통과했다고 보고한다.** 이는 이번 검토 환경에서 재실행한 결과가 아니다. 현재 직접 읽은 테스트에는 TXT segment 안정성, dense paragraph cursor, source offset 보존, transform index 재사용, 검색 locator·Unicode whitespace 검증이 있다.

### 1.4 합리적 추론

1. **수백 MiB TXT에서 sidecar의 peak memory와 첫 페이지 시간이 급증할 가능성이 높다.** 전체 byte buffer, 디코딩된 Python 문자열, segment range, 변환 결과가 일시적으로 공존할 수 있기 때문이다. 이는 코드 구조에서 강하게 예상되지만 실제 Windows RSS 수치는 측정이 필요하다.

2. **“분할 로딩 지원”을 곧바로 “대용량 TXT를 bounded memory로 지원”한다고 홍보하면 안 된다.** 현재 분할은 주로 API 응답과 DOM 규모를 제한하며 원문 source materialization은 제한하지 않는다.

3. **EPUB 전체 페이지 수는 창 크기·폰트·이미지 로딩 순서에 따라 늦게 변하거나 잠시 잘못 보일 수 있다.** `EpubReader.jsx`가 숨은 측정 DOM에서 chapter를 순차 측정하고, 이미지·폰트·resize와 같은 비동기 변수를 함께 다루기 때문이다.

4. **수천 이미지 ZIP은 페이지 이동마다 archive metadata 전체를 다시 검증하는 비용이 누적될 수 있다.** `get_zip_image()`가 매 요청마다 ZIP을 다시 열고 `infolist()`와 전체 크기·압축률 검사를 반복한다.

5. **동기 EPUB parse/search/ZIP 처리를 `async` route 안에서 직접 호출하는 부분은 한 요청이 다른 API 응답을 지연시킬 수 있다.** TXT route는 `run_in_threadpool`을 쓰지만 EPUB·검색·ZIP의 주요 호출은 그렇지 않다.

### 1.5 추가 검증이 필요한 항목

* Windows 11 기준 100/300/500MiB TXT의 cold open, first readable page, peak private bytes, 검색 취소 시간
* CP949/EUC‑KR/UTF‑8/UTF‑16과 혼합·잘못된 인코딩에서의 오탐률
* 모든 delete phase, fsync, rename, backup, restore 지점에서 강제 종료했을 때의 복구 결과
* 디스크 부족, primary와 backup 동시 손상, 손상된 delete journal
* 실제 출판사 EPUB corpus의 CSS·SVG·MathML·font obfuscation·fixed-layout 호환성
* 5,000장 ZIP의 페이지 전환 latency와 WebView image memory
* 한글·emoji·NFC/NFD·Windows 긴 경로의 설치형 빌드 검증
* unsigned/signed sidecar의 Windows Defender·SmartScreen·주요 백신 오탐률

**기준선 판정:** 기능 부족이 주된 문제가 아니다. 현재 제품은 이미 기능이 많은 편이며, 상용 출시를 막는 핵심은 **대용량 처리의 실제 상한, 위치 복원의 정확성, 저장소 간 일관성, 실패 후 복구 가능성**이다.

---

## 2. 경쟁 환경과 제품 선택

공식 자료 확인일은 모두 **2026년 7월 13일**이다.

| 제품             | 공식 최신 자료에서 확인한 강점                                                                                                                     | BookReader에 대한 결론                                                             | 공식 출처·확인일                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calibre        | 9.11.0. 라이브러리 관리, 메타데이터·표지 편집, 변환, 콘텐츠 서버, viewer 검색·주석·낭독, 백업, 플러그인, 최근 주석 HTML export와 AI까지 포함한다.                                   | 기능 폭 경쟁은 불가능하다. 변환·편집·서버·플러그인·AI는 포기해야 한다.                                    | [About](https://calibre-ebook.com/about), [What’s new](https://calibre-ebook.com/whats-new), [Windows](https://calibre-ebook.com/download_windows), 2026-07-13. ([Calibre][1])                   |
| SumatraPDF     | Windows 전용 경량·고속·포터블 앱이며 PDF뿐 아니라 비암호화 EPUB, TXT, CBZ/CBR와 여러 archive 형식을 읽는다. 공식 문서에는 검색·주석·TTS 등도 있다.                               | Windows의 “작고 빠름”과 형식 폭에서는 이기기 어렵다. BookReader는 형식 수가 아니라 이어읽기 정확성으로 차별화해야 한다. | [공식 사이트](https://www.sumatrapdfreader.org/free-pdf-reader), [지원 형식](https://www.sumatrapdfreader.org/docs/Supported-document-formats), 2026-07-13. ([Sumatra PDF][2])                            |
| Thorium Reader | 3.4.0. Windows/macOS/Linux, 접근성·스크린리더·TTS, 전자책·만화·오디오북, catalog, annotation import/export가 강하다. 광고나 독서 데이터 유출이 없음을 강조한다.              | EPUB 표준·접근성·OPDS를 전부 추격하지 않는다. 비DRM reflow EPUB의 안정적 기본 읽기에 범위를 제한한다.         | [Thorium 공식 사이트](https://thorium.edrlab.org/en/), 2026-07-13. ([Thorium][3])                                                                                                                     |
| Foliate        | Linux 중심. EPUB·Mobi·FB2·CBZ·PDF, paged/scrolled, 검색, 주석 JSON, 사전·번역·TTS, RTL·세로쓰기·fixed layout 등을 제공한다. 위치 식별에는 EPUB CFI를 사용한다.       | 고급 EPUB 기능과 언어 레이아웃 전체를 구현하려 하지 않는다. CFI는 장기 상호운용 요구가 생길 때 도입한다.              | [공식 사이트](https://johnfactotum.github.io/foliate/), [공식 FAQ](https://github.com/johnfactotum/foliate/blob/67b6676d3f936c5edea91d4d903385ef39dd25c0/docs/faq.md), 2026-07-13. ([John Factotum][4]) |
| Lithium        | Android·Chromebook 계열의 단순한 EPUB reader다. 자동 책 탐지, highlight·note, night/sepia, paged/scroll을 제공하며 Pro는 Google Drive로 진행률·주석 등을 동기화한다. | 직접적인 Windows 경쟁자는 아니지만, “설명 없이 바로 읽히는 단순성”의 UX 기준으로 삼는다. 클라우드 동기화는 따라가지 않는다.  | [Google Play 공식 페이지](https://play.google.com/store/apps/details?id=com.faultexception.reader), 2026-07-13. ([Google Play][5])                                                                    |

### 단 하나의 차별적 핵심 가치

> **대용량 로컬 책에서도 읽던 문장을 잃지 않는 Windows 독서 신뢰성**

이를 제품 약속으로 풀면 다음 한 문장이 된다.

> **책을 외부로 보내지 않고, 큰 한국어 TXT와 비DRM EPUB·ZIP을 빠르게 열며, 글꼴·창·여백이 바뀌거나 앱이 비정상 종료돼도 읽던 문장으로 정확히 돌아온다.**

### 타깃 사용자

1. **한국어 웹소설·개인 문서 TXT 보유자 — 1차 타깃**
   수십~수백 MiB TXT, CP949/EUC‑KR/UTF‑16, 불규칙한 줄바꿈을 가진 사용자다. 현재 코드 투자가 가장 많이 축적된 영역이고 Calibre·Thorium과 정면으로 겹치지 않는다.

2. **DRM 없는 EPUB을 로컬에서 읽고 싶은 Windows 사용자 — 2차 타깃**
   계정·클라우드·온라인 서점 없이 EPUB을 읽고 검색·주석·이어읽기를 원하는 사용자다. 단, fixed-layout·수식·세로쓰기까지 약속하지 않는다.

3. **ZIP 만화를 가끔 함께 보는 사용자 — 3차 타깃**
   별도 만화 관리 제품이 필요한 전문 사용자가 아니라, TXT·EPUB과 함께 단면·양면 ZIP을 간단히 읽고 싶은 사용자다. 만화 생태계를 주력으로 확장하지 않는다.

### 명시적 비목표

향후 6개월 동안 다음은 BookReader의 목표가 아니다.

* Calibre형 변환기·전자책 편집기·콘텐츠 서버·온라인 메타데이터 수집
* PDF 및 DRM 해제·지원
* 모든 EPUB 3 기능, fixed-layout, MathML·SVG·세로쓰기 완전 준수
* 모바일·macOS·Linux 동시 출시
* 계정, 클라우드 동기화, 원격 설정 동기화
* OPDS·온라인 서점·콘텐츠 발견
* TTS, 번역, 사전, AI 요약·질의응답
* 외부 플러그인 생태계
* 독서 통계·배지·연속 독서 등 gamification
* “모든 환경에서 동일한 총 페이지 수”라는 약속

---

## 3. 기능 압축 의사결정

`1인주`는 한 개발자가 구현·코드리뷰·자동화 테스트를 완료하는 1주이며, 출시 지원·문서·사용자 대응은 제외한다.

* **P0:** 출시 차단
* **P1:** 상용 완성도에 필요하나 출시 직후까지 허용
* **P2:** 사용 증거가 있을 때
* **P3:** 현재 보류 또는 명시적 비목표

현재 허용 확장자는 TXT·EPUB·ZIP이고, 책 내부 검색과 태그·컬렉션·메타데이터 편집·중복 관련 데이터는 이미 존재한다. 이를 “미구현”으로 다시 만들지 말고 정확성과 UX를 다듬어야 한다.

| 후보            | 현재 상태                               |        사용자 가치 |                    난도·인주 |  유지보수 | 손실·보안 위험                          | 선행 의존성                             |            우선순위 | 결론                                    |
| ------------- | ----------------------------------- | ------------: | -----------------------: | ----: | --------------------------------- | ---------------------------------- | --------------: | ------------------------------------- |
| 전체 라이브러리 검색   | 제목·저자·태그 등 메타 검색 있음; 모든 책 본문 검색 없음  |    메타 중, 본문 중 |    메타 하 0.5–1 / 본문 상 4–8 |     중 | 본문 index에 문장 유출·손상 가능성 중          | 검색 index·revision                  |   P1 메타 / P3 본문 | **메타 검색만 직후 다듬기. 전체 본문 검색은 장기 보류**    |
| 책 내부 통합 검색    | TXT·EPUB 구현, ZIP 제외; 전체 scan·취소 부족  |             상 |                    중 2–3 |     중 | 프리즈·잘못된 locator 중                 | streaming TXT·locator v2           |              P0 | **출시 전 안정화. 새 기능이 아니라 blocker 수정**    |
| 하이라이트·주석 내보내기 | CRUD 있음, export 없음                  |             상 |                    하 1–2 |     하 | export 파일의 민감 문장 노출 중             | locator v2·schema version          |              P1 | **출시 직후 Markdown+JSON export**        |
| 독서 통계         | 사실상 없음                              |           하~중 |                    중 2–4 |     상 | 이벤트 누락·개인 행동 데이터 중                | event model·clock semantics        |              P3 | **보류**                                |
| 태그·컬렉션        | 이미 구현                               |             중 |                  하 0.5–1 |     중 | 중복 IA·실수 삭제 낮음                    | 용어·IA 정리                           |              P1 | **기능 추가 금지, 기존 흐름 단순화**               |
| 자동 표지         | 체계적 구현 없음                           |            중하 |                    중 1–2 |     중 | 손상 이미지·cache 중                    | asset cache·fallback               |              P2 | **출시 후 조건부**                          |
| 메타데이터 편집      | 제목·저자·태그·컬렉션·시리즈 등 구현               |             중 |                  하 0.5–1 |     중 | 잘못된 대량 편집 중                       | backup·undo 정책                     |              P1 | **기존 기능만 정리. 온라인 조회는 하지 않음**          |
| 폴더 감시         | 없음; 현재 폴더는 논리 책장                    |             중 |                    상 4–8 |     상 | 이동·권한·중복·race 상                   | file identity·relink·watch service |              P3 | **보류. 일회성 폴더 가져오기만 검토**               |
| 중복 감지         | SHA‑1 fingerprint·중복 필드·그룹 UI 부분 구현 |             중 |                    중 1–2 |     중 | 오탐 자동삭제 시 매우 높음                   | revision·backup                    |              P1 | **직후. “제안”만 하고 자동삭제 금지**              |
| 설정 동기화        | 없음                                  |             하 |                매우 상 8–16 |  매우 상 | 계정·암호화·충돌 상                       | 서버·인증·동기화 엔진                       |              P3 | **6개월 내 하지 않음**                       |
| 백업·복구         | 내부 `.bak` 자동 복구 있음; 사용자용 bundle 없음  |          매우 상 |                    중 2–4 |     중 | 실패 시 독서 데이터 손실 매우 높음              | schema·journal·검증                  |              P0 | **출시 전 사용자용 verified backup/restore** |
| OPDS          | 없음                                  |      특정 사용자 중 |                    상 4–8 |     상 | 인증·네트워크·URL 공격 중                  | network policy·catalog model       |              P3 | **장기 보류**                             |
| PDF           | 없음                                  |      시장 가치는 상 |              매우 상 12–24+ |  매우 상 | parser·annotation·보안 상            | 별도 렌더링 엔진                          |              P3 | **하지 않음**                             |
| CBZ·CBR       | ZIP만 지원; `.cbz`·RAR 기반 CBR 없음       | CBZ 중, CBR 중하 | CBZ 하 0.5–1 / CBR 상 3–6+ | CBR 상 | archive parser 공격면 중상             | ZIP manifest·RAR dependency        | P2 CBZ / P3 CBR | **CBZ alias만 장기 조건부, CBR 보류**         |
| 세로쓰기          | 완전 지원 아님                            |      특정 사용자 중 |                   상 6–12 |     상 | locator·selection·pagination 회귀 상 | EPUB layout engine                 |              P3 | **보류, 현재 미지원 명시**                     |
| TTS           | 없음                                  |             중 |                    상 4–8 |     상 | 음성·선택·중단 상태 중                     | stable text range·OS voice         |              P3 | **보류**                                |
| 번역·사전         | 없음                                  |             중 |                    상 4–8 |     상 | 외부 전송·라이선스·개인정보 상                 | network consent·selection model    |              P3 | **하지 않음**                             |
| AI 요약·질의응답    | 없음                                  |     핵심 타깃에는 하 |               매우 상 8–16+ |  매우 상 | 책 외부 전송·비용·저작권 매우 상               | provider·동의·과금·보안                  |              P3 | **명시적 비목표**                           |
| 플러그인          | 없음                                  |          현재 하 |               매우 상 12–24 |  매우 상 | 임의 코드 실행·호환성 매우 상                 | public API·sandbox·versioning      |              P3 | **외부 플러그인 금지**                        |
| 자동 업데이트       | updater 구성 없음                       |             상 |                    중 3–5 |    중상 | supply chain·migration 실패 상       | code signing·키 보관·rollback         |              P1 | **출시 직후 조건부. 최초 출시는 수동 업데이트**         |
| 포터블 모드        | 없음                                  |      특정 사용자 중 |                    중 2–4 |    중상 | 권한·상대 경로·업데이트 중                   | data-root abstraction              |              P2 | **6개월 뒤 수요 근거가 있을 때**                 |

### 출시 차단 결함으로 다시 평가할 현재 기능

1. **대용량 TXT:** API windowing이 아니라 프로세스 메모리 상한을 증명해야 한다.
2. **위치 복원:** page나 segment 번호가 아니라 source revision과 문장 anchor를 기준으로 해야 한다.
3. **삭제·복구:** 책·주석·진행률·로컬 캐시가 한 작업으로 완료되거나 모두 롤백돼야 한다.
4. **백업:** 내부 `.bak`만으로는 사용자 복구 기능이 아니다.
5. **검색:** 사용자 취소, timeout, partial result, background 실행이 필요하다.
6. **인코딩:** 자동 추정 결과와 수동 override를 사용자가 볼 수 있어야 한다.
7. **EPUB 실패:** DRM, 암호화, 손상, 미지원 SVG·MathML을 “빈 화면”과 구분해야 한다.
8. **ZIP:** manifest 검증을 page마다 반복하지 않아야 한다.
9. **Windows 배포:** 긴 경로·한글 경로·sidecar 차단·서명 정책을 실제 설치본에서 검증해야 한다.
10. **총 페이지 수:** 준비 전에는 확정 수치처럼 표시하지 않아야 한다.

---

## 4. 정보 구조와 핵심 흐름

### 4.1 기본 원칙

* 앱의 첫 화면은 “관리 도구”보다 “최근 읽던 책으로 돌아가기”를 우선한다.
* UI에서는 서버 용어인 **업로드** 대신 **책 가져오기**를 사용한다.
* 1.0은 **관리 사본 방식**만 지원한다. 가져온 파일을 앱 데이터 영역으로 복사하며 외부 원본 경로를 계속 참조하지 않는다.
* 현재 논리 폴더는 **책장** 또는 **컬렉션**으로 이름을 바꾼다. 파일 시스템 폴더와 혼동시키지 않는다.
* 읽는 동안 chrome은 최소화하되, 마우스·키보드·창 크기라는 데스크톱 장점을 적극 사용한다.
* 공통 shell은 하나이고 형식별 UI는 실제 콘텐츠 차이만 담당한다.

### 4.2 라이브러리

왼쪽 rail은 다음 수준에서 끝낸다.

* 전체
* 읽는 중
* 최근
* 즐겨찾기
* 책장

상단에는 검색, 정렬, 목록·격자 전환, `책 가져오기`만 둔다. 태그·시리즈·중복·고급 필터는 별도 filter drawer로 이동한다. 라이브러리 첫 화면에 모든 필터를 동시에 노출하지 않는다.

책 항목의 기본 정보는 표지 또는 형식 icon, 제목, 저자, 진행률, 마지막 읽은 시간, 누락 파일 상태다. 우클릭 메뉴는 `열기`, `정보`, `책장으로 이동`, `중복 확인`, `라이브러리에서 제거`만 제공한다.

현재 drag-and-drop은 첫 파일만 처리한다. 출시 전에는 여러 파일 선택과 여러 파일 drop을 같은 가져오기 queue로 통합해야 한다.

### 4.3 책 가져오기와 폴더 등록

#### 출시 전

1. `Ctrl+O`, drag-and-drop, 버튼으로 여러 파일을 선택한다.
2. 확장자·크기·읽기 권한·중복 가능성을 먼저 검사한다.
3. 결과를 `가져올 책 / 중복 후보 / 지원하지 않음`으로 미리 보여준다.
4. 기본 동작은 관리 사본 생성이다.
5. 정확히 같은 fingerprint는 기본적으로 건너뛰며, `둘 다 유지`는 사용자가 명시적으로 선택한다.
6. 기존 책 대체는 default가 아니며 진행률·주석 이전 결과를 미리 보여준다.

#### 출시 직후의 일회성 폴더 가져오기

* 사용자가 폴더를 한 번 선택하면 지원 파일을 recursive scan한다.
* preview 후 관리 사본으로 가져온다.
* 원본 폴더를 계속 감시하지 않는다.
* 이후 원본 파일 이동·삭제는 BookReader에 영향을 주지 않는다.

#### 하지 않을 흐름

* 읽을 때마다 외부 원본 경로에 의존
* 시작 시 전체 디스크 scan
* 항상 켜진 folder watcher
* 파일 이름만으로 자동 대체·병합

### 4.4 공통 Reader Shell

TXT·EPUB·ZIP 모두 다음 shell을 공유한다.

**상단:** 뒤로, 제목, 형식, 검색, 책갈피, 주석, 설정
**중앙:** 형식 renderer
**하단:** 현재 위치·진행률, 이전·다음
**오버레이:** 재개 toast, selection menu, 오류·복구 메시지

상단과 하단은 읽기 시작 후 자동으로 낮은 opacity 또는 숨김 상태가 되고, 마우스를 가장자리로 이동하거나 `Alt`를 누르면 나타난다. 현재처럼 책갈피를 가로 chip 줄로 계속 노출하는 방식은 긴 독서 화면을 줄이므로 주석 panel 안으로 이동한다.

공통 단축키는 다음으로 제한한다.

* `Ctrl+O`: 책 가져오기
* `Ctrl+F`: 책 내부 검색
* `Ctrl+,`: 설정
* `B`: 책갈피
* `A`: 주석 panel
* `←/→`, `PageUp/PageDown`: 이전·다음
* `Home/End`: 책 시작·끝
* `Esc`: 열려 있는 panel 닫기

단, input·textarea·select·contenteditable에 focus가 있을 때 문자 단축키를 실행하지 않는다.

### 4.5 TXT 리더

첫 화면은 전체 페이지 계산이 끝날 때까지 기다리지 않고 첫 content window를 바로 보여줘야 한다.

상단 메타에는 현재 인코딩과 신뢰도를 작게 표시한다. 사용자가 `인코딩 변경`을 선택하면 UTF‑8, UTF‑16 LE/BE, CP949/EUC‑KR 후보의 짧은 preview를 비교한 뒤 적용한다.

자주 쓰는 항목은 글꼴 크기·줄 간격·페이지 폭·단면/양면이다. 다음은 고급 설정으로 이동한다.

* 공백 압축
* 빈 줄 제거
* 문장 단위 재분할
* 인코딩 override
* letter spacing·font weight 세부값

원문 fingerprint가 바뀌면 기존 위치를 조용히 page 비율로 복원하지 않는다. `원문이 변경되었습니다. 같은 문장을 찾았습니다` 또는 `이전 위치에 가까운 지점으로 이동했습니다`를 구분해 알린다.

### 4.6 EPUB 리더

기본 UI는 목차, 검색, 책갈피·주석, publisher style 사용 여부만 노출한다.

* 목차는 chapter 목록과 현재 chapter만 보여준다.
* 전체 page count가 준비되기 전에는 `Chapter 7 · 42%`처럼 표시한다.
* embedded CSS가 읽기를 방해하면 `출판사 스타일 끄기`로 안전한 reader style을 사용한다.
* asset 누락, 손상 chapter, DRM·암호화, 미지원 SVG·MathML을 각각 구분한다.
* 이미지 확대는 popup보다 공통 image overlay를 사용해 focus·Esc·창 경계를 일관되게 처리한다.

### 4.7 만화 리더

ZIP renderer 전용 UI는 다음만 갖는다.

* 단면·양면
* 왼쪽→오른쪽 / 오른쪽→왼쪽
* 첫 표지를 단면으로 취급
* 창 맞춤 / 폭 맞춤 / 원본 배율
* 앞뒤 1~2장 prefetch

라이브러리 관리, 검색, 주석 panel은 ZIP 전용으로 억지로 구현하지 않는다. ZIP은 page bookmark와 진행률에 집중한다.

### 4.8 검색 결과

TXT와 EPUB 결과 panel의 표현을 통일한다.

* 결과 수와 `최대 100개 표시`를 명시한다.
* EPUB은 chapter, TXT는 문단 또는 location으로 그룹화한다.
* 각 결과는 위치 label, snippet, 검색어 highlight를 보여준다.
* `Enter`, `F3`, `Shift+F3`으로 다음·이전 결과를 이동한다.
* 새 검색을 시작하면 이전 scan을 취소한다.
* 결과 선택 후 renderer가 정확한 anchor를 찾지 못하면 가장 가까운 지점으로 조용히 이동하지 않고 실패를 표시한다.

### 4.9 책갈피와 주석

하나의 side panel 안에서 `책갈피 / 하이라이트 / 메모`를 filter한다.

주석은 다음 상태를 가질 수 있어야 한다.

* 정상 anchor
* 원문 변경 후 재연결됨
* 위치를 찾지 못한 orphan

orphan 주석은 삭제하지 않는다. 선택 문장과 메모를 계속 보여주고 `다시 연결`과 `삭제`를 제공한다.

내보내기는 두 가지다.

* Markdown: 사람이 읽고 다른 메모 앱에 넣기 위한 형식
* JSON: locator와 revision을 보존하는 백업·향후 import용 형식

### 4.10 설정

**자주 쓰는 설정**

* 밝음·어두움·세피아
* 글꼴 크기
* 줄 간격
* 좌우 여백 또는 페이지 폭
* 단면·양면
* EPUB publisher style
* ZIP 방향·맞춤

**고급 설정**

* 글꼴 업로드·font family·weight·letter spacing
* TXT 인코딩과 변환
* EPUB embedded font와 문제 해결
* ZIP 원본 배율
* 데이터 위치·백업·진단 로그
* 실험 기능

현재 ReaderToolbar의 live preview와 keyboard focus trap은 유지하되, 모든 slider를 첫 tab에 나열하지 않는다.

### 4.11 백업·복구

설정의 `데이터` 영역에서 두 가지 backup을 제공한다.

1. **독서 데이터 백업:** 라이브러리 메타데이터, 진행률, 책갈피, 주석, 설정, 사용자 글꼴
2. **전체 백업:** 위 데이터와 관리 사본 책 파일

backup에는 schema version, 앱 버전, 파일 수, 각 파일 checksum, 생성 시간을 기록한다.

복원은 즉시 덮어쓰지 않는다.

1. bundle 검사
2. 현재 데이터 자동 snapshot
3. 복원 preview
4. 임시 위치에 복원
5. checksum·참조 무결성 검증
6. 원자적 전환
7. 실패 시 기존 데이터 유지

---

## 5. 콘텐츠 파서·렌더러 분리와 공통 형식 인터페이스

### 5.1 현재 코드의 구조적 병목

`frontend/src/components/TxtReader.jsx`는 source window, transform, global pagination, viewport pagination, 검색, 주석, selection, bookmark, 복원, UI까지 한 컴포넌트가 소유한다. `EpubReader.jsx`도 chapter fetch, 전체 chapter 측정, navigation, 검색, 주석, asset interaction, reader shell을 함께 다룬다. 상태 수와 effect 간 의존성이 많아 resize·font load·chapter switch·검색 이동이 동시에 발생할 때 stale 작업이 commit될 위험이 높다.

`TxtReader.jsx`, `EpubReader.jsx`, `ZipReader.jsx`에는 다음이 중복된다.

* 동일한 top bar
* 검색·주석 panel toggle
* bookmark 동작
* 좌우 navigation hit area
* progress bar
* resume toast
* keyboard navigation
* 테마·여백·단면/양면 적용

`frontend/src/pages/Dashboard.jsx`는 가져오기, 필터, grouping, metadata 편집, bulk move, 삭제, 정보 panel을 함께 담당한다. `ReaderToolbar.jsx` 역시 설정 상태, font API, tab UI, preview, focus trap을 한 파일에 포함한다.

백엔드에서는 `library_store.py`, `annotation_store.py`, `reading_progress_store.py`가 유사한 atomic JSON 패턴을 각각 구현하지만 하나의 transaction boundary는 없다. 프런트의 `localStorage`까지 포함하면 독서 데이터 책임이 네 위치에 분산되어 있다.

### 5.2 목표 경계

#### 백엔드 parser 계층

각 형식 parser는 viewport page를 만들지 않는다. 다음만 반환한다.

* publication metadata
* content revision
* 논리적 content chunk 또는 chapter
* asset reference
* search hit
* format-specific source anchor

형식별 구현은 다음으로 제한한다.

* **TXT:** streaming decoder, sparse source index, transform mapping
* **EPUB:** package·spine·TOC parser, safe asset resolver
* **ZIP:** 한 번 검증한 image manifest와 member lookup

#### 프런트 renderer 계층

renderer는 전달받은 content를 현재 창·폰트·여백으로 배치한다. page는 일시적 layout 결과이며 저장 식별자가 아니다.

#### 공통 format adapter

각 형식은 다음 개념적 계약을 구현한다.

* `capabilities`: TOC·검색·주석·양면 지원 여부
* `open`: manifest와 revision
* `getContent`: 현재 위치 주변 content
* `captureLocator`: 현재 읽는 source 위치
* `resolveLocator`: locator를 현재 layout 위치로 변환
* `search`: 취소 가능한 검색
* `getToc`
* `getAsset`
* `dispose`: 진행 중 작업·cache 정리

TXT·EPUB·ZIP renderer가 직접 백엔드 URL 규칙과 저장 schema를 각각 알지 않게 한다.

### 5.3 최소 변경 순서

1. **동작 변경 없이 `ReaderShell`을 추출한다.** top bar, panels, progress, resume, keyboard를 공통화한다.
2. **각 reader에서 locator와 search navigation을 adapter로 분리한다.**
3. **`TxtReader.jsx`를 controller, pagination engine, selection/annotation binding, view로 나눈다.**
4. **백엔드에 `PublicationRepository` 경계를 만들고 현재 JSON store를 그 뒤에 둔다.**
5. **EPUB·검색·ZIP의 blocking 작업을 threadpool 또는 별도 worker queue로 이동한다.**
6. **그 뒤에만 저장소나 parser 구현을 교체한다.**

### 5.4 하지 않을 재작성

* React 전체를 TypeScript로 일괄 전환
* Python backend 전체를 Rust로 재작성
* EPUB parser를 자체 구현
* CSS pagination engine 전면 교체
* JSON과 SQLite를 장기간 dual-write
* 모든 reader를 한 번에 새 architecture로 옮기는 big bang

### 5.5 테스트 사각지대

* 실제 수백 MiB TXT의 RSS·TTFR
* 50MiB 이상의 단일 line TXT
* 검색 중 취소·책 전환·창 닫기
* source 수정 후 quote re-anchor
* 글꼴 load 지연 중 position restore
* delete 각 phase의 process kill
* corrupt delete journal
* disk full·read-only app data
* primary와 `.bak` 동시 손상
* EPUB SVG·MathML·fixed-layout·암호화 corpus
* 5,000장 ZIP 반복 navigation
* 업데이트 전후 모든 역사적 schema fixture
* sidecar가 없거나 quarantine된 설치 환경

---

## 6. 기술 결정

### 6.1 JSON → SQLite

**현재 판단:** 향후 6개월과 1.0 출시에서는 JSON을 유지한다. SQLite 전환을 출시 조건으로 만들지 않는다.

**왜 지금:** 현재 JSON은 임시 파일·fsync·원자 교체·backup 복구를 이미 갖는다. 데이터 규모가 아직 작다는 전제에서 SQLite 전환은 사용자 가치를 늘리기보다 migration·rollback·dual-source 문제를 새로 만든다. 지금 더 시급한 문제는 저장 엔진보다 여러 저장소의 transaction 경계다.

**최소 변경안:** `PublicationRepository`와 schema version 경계를 만들고, library·annotation·progress를 포함하는 공통 operation journal, 사용자 backup bundle, 무결성 검사기를 추가한다.

**전환 트리거:** 다음 중 하나가 실제 측정으로 발생할 때다.

* 2,000권 이상에서 라이브러리 p95 load/save가 150ms 초과
* 주석 50,000개 이상
* 단일 JSON store 20MiB 이상
* 여러 store 간 repair가 반복적으로 발생
* 전체 라이브러리 본문 검색이 검증된 핵심 요구가 됨
* 향후 다중 기기 동기화가 실제 제품 결정으로 승인됨

**하지 않을 것:** big-bang migration, 영구 dual-write, 책 binary를 DB에 넣기, 현재 단계에서 SQLite FTS를 전체 라이브러리에 선제 도입하기.

#### 향후 SQLite 전환 시의 단계적 이행

1. 현재 JSON schema를 고정하고 migration fixture를 만든다.
2. 전환 직전 data-only backup과 `.pre-sqlite` snapshot을 생성한다.
3. 임시 DB에 `schema_version`, foreign key, WAL 설정을 만든다.
4. 하나의 transaction에서 library·progress·annotation을 import한다.
5. record count, ID set, book fingerprint, annotation locator hash, `foreign_key_check`, `integrity_check`를 검증한다.
6. 모든 검증이 성공한 경우에만 active store pointer를 SQLite로 바꾼다.
7. 실패하면 JSON을 그대로 사용하며 사용자 데이터는 수정하지 않는다.
8. 성공 후에도 이전 JSON은 최소 한 minor release 동안 read-only snapshot으로 보존한다.
9. live SQLite backup은 파일 복사가 아니라 SQLite backup API와 checkpoint를 사용한다.
10. JSON과 SQLite를 장기간 동시에 쓰지 않는다.

### 6.2 버전된 표준 locator 모델

**현재 판단:** locator v2는 P0다. page와 format-specific 임시 필드를 하나의 versioned envelope로 통합한다.

**왜 지금:** 현재 진행률 locator는 v1 object, 주석 locator는 string과 여러 offset 필드로 분산되어 있다. EPUB chapter page와 TXT measured page는 layout 변경에 안정적이지 않다.

**최소 변경안:** locator v2는 다음 정보를 가진다.

* `version`
* `bookId`
* `contentRevision` 또는 fingerprint
* `format`
* format별 primary anchor
* 선택 문장의 exact text와 prefix·suffix
* fallback progression
* 생성 시각
* 선택 범위가 있으면 start·end anchor

형식별 primary anchor는 다음으로 한다.

* TXT: LF 정규화 원문의 Unicode code-point offset
* EPUB: 정규화된 spine href + chapter 내 정규화 text offset
* ZIP: 정확한 member name
* page·chapter page는 fallback 또는 UI hint일 뿐 primary key가 아니다.

**전환 트리거:** 즉시. 기존 v1은 읽을 수 있게 유지하고 다음 save 시 v2로 lazy upgrade한다.

**하지 않을 것:** 모든 구형 locator를 startup에 일괄 rewrite, page 번호만 저장, segment ID만 영구 식별자로 사용.

### 6.3 TXT 원문·글꼴·창·여백 변화 시 복원

**현재 판단:** 원문 revision과 layout 변화를 분리한다.

**왜 지금:** 글꼴·창·여백 변화는 같은 원문의 page map만 바꾸지만, 원문 수정·인코딩 변경은 source offset 자체를 바꿀 수 있다.

**최소 변경안:**

* fingerprint가 같으면 source code-point offset으로 다시 pagination한다.
* fingerprint가 다르면 저장된 exact quote를 이전 offset 주변에서 찾는다.
* exact match가 여러 개면 prefix·suffix context로 결정한다.
* 없으면 제한된 반경에서 normalized text match를 시도한다.
* 그래도 없으면 progression 근사 위치로 이동하되 `대략적인 위치`임을 표시한다.
* 인코딩 override가 달라지면 별도 content revision으로 본다.

**전환 트리거:** quote re-anchor 성공률이 95% 미만이거나 실제 사용자 문서가 대규모 편집되는 사례가 많으면 diff 기반 anchor mapping을 추가한다.

**하지 않을 것:** 500MiB 파일 전체 fuzzy scan을 UI thread에서 수행, 잘못된 위치로 조용히 이동, 기존 page 번호를 강제로 clamp하고 성공으로 간주.

### 6.4 EPUB CFI 또는 대안

**현재 판단:** 6개월 내 자체 full EPUB CFI 구현을 하지 않는다. spine href + chapter text offset + text quote를 사용한다.

**왜 지금:** EPUB CFI는 표준화된 정확한 참조 방식이지만, 현재 BookReader는 backend에서 asset·CSS를 rewrite하고 frontend에서 DOM을 sanitize한다. 원본 DOM tree와 실제 렌더링 DOM이 다르므로 불완전한 CFI 구현은 오히려 잘못된 주석 위치를 만들 수 있다. EPUB 3.3과 EPUB CFI는 현재 W3C 표준이며 Foliate도 정확한 식별에 CFI를 사용한다. ([W3C][6])

**최소 변경안:** normalized spine href, chapter text offset, exact/prefix/suffix quote, chapter progression을 저장한다. DOM node index는 저장하지 않는다.

**전환 트리거:** 다른 reader와 annotation 교환, EPUB annotation import, sync, 표준 export가 제품 요구가 되거나 검증된 CFI engine을 도입할 때다.

**하지 않을 것:** 자체 CFI parser를 몇 주 안에 부분 구현, sanitized DOM path를 영구 식별자로 저장, CFI 없이도 완전한 상호운용성을 지원한다고 홍보.

### 6.5 검색 index

**현재 판단:** 전체 라이브러리 index는 만들지 않는다. 책 내부 검색을 streaming·cancellable하게 고친다.

**왜 지금:** 현재 TXT 검색은 전체 manifest를 만들고 EPUB 검색은 전체 chapter text를 구성한다. prewarm cache도 별도 전체 materialization을 수행한다. 대용량 핵심 가치와 상충한다.

**최소 변경안:**

* TXT는 decoder chunk를 순차 scan하고 첫 결과부터 보낸다.
* 검색 요청마다 cancellation token과 generation ID를 둔다.
* 결과 100개 이후에는 전체 count를 끝까지 세지 않고 `100+`로 표시할 수 있다.
* EPUB은 chapter 단위 background scan과 cache를 사용한다.
* cache key는 content revision과 검색 normalization version으로 한다.

**전환 트리거:** 같은 책의 반복 검색 p95가 2초를 넘고 사용자 행동에서 반복 검색이 실제로 많으면 per-book persisted index를 만든다. 전체 라이브러리 본문 검색이 승인될 때만 SQLite FTS 등을 검토한다.

**하지 않을 것:** 시작 시 모든 책 pre-index, 검색을 위해 전체 라이브러리 파일 열기, cache와 원문 revision 불일치 무시.

### 6.6 주석·하이라이트 모델

**현재 판단:** 현재 모델을 버리지 않고 locator v2 range와 orphan 상태를 추가한다.

**왜 지금:** 현재 selected text, note, color, 여러 offset을 이미 저장하지만 locator가 일관되지 않고 원문 변경 후 상태를 표현할 수 없다.

**최소 변경안:**

* immutable selected quote
* locator v2 start/end range
* content revision
* note와 color
* `normal / reanchored / orphaned`
* created/updated timestamps
* export ID
* reanchor 이력 1개

**전환 트리거:** export가 안정화된 후 실제 import 요구가 생기면 JSON import를 추가한다. 외부 표준 교환 요구가 생기면 W3C Web Annotation 또는 CFI mapping을 검토한다.

**하지 않을 것:** 위치를 못 찾는 주석 자동 삭제, selected text를 원문에서 매번 재추출해 덮어쓰기, import와 export를 동시에 구현.

### 6.7 마이그레이션·손상 복구·비정상 종료·백업

**현재 판단:** 저장소 교체보다 operation-level durability를 먼저 완성한다.

**왜 지금:** 각 store의 atomicity는 양호하지만 책 삭제·복원·migration처럼 여러 store를 건드리는 작업은 하나의 원자적 작업이 아니다. delete journal 손상이 앱 시작을 막을 수도 있다.

**최소 변경안:**

* delete journal에 progress와 관련 local cleanup intent를 포함한다.
* journal 자체도 backup 또는 append-only record + checksum을 가진다.
* 손상 journal은 원본을 `quarantine`하고 읽기 전용 repair mode로 시작한다.
* backup 전에 디스크 여유 공간을 검사한다.
* restore는 임시 data root에서 검증 후 전환한다.
* 최소 N‑2 schema의 migration fixture를 유지한다.
* 모든 replace·delete phase에 fault injection test를 둔다.

**전환 트리거:** cross-store 작업 종류가 세 개 이상 늘어나면 SQLite transaction으로 전환하는 근거가 된다.

**하지 않을 것:** 손상 데이터를 빈 store로 조용히 초기화, backup 파일을 검증 없이 active로 복사, 실패한 migration 후 새 버전으로 부분 저장.

### 6.8 자동 업데이트

**현재 판단:** 첫 상용 배포는 수동 업데이트로 시작하고, 서명과 rollback이 준비된 뒤 opt-in 자동 업데이트를 넣는다.

**왜 지금:** Tauri updater는 update signature 검증이 필수이며 이를 끌 수 없다. updater private key 관리가 잘못되면 설치 사용자에게 향후 update를 배포하기 어려워질 수 있다. Windows code signing은 Microsoft Store 배포에 필요하고 SmartScreen의 신뢰 경고를 줄이는 데 중요하다. ([Tauri][7])

**최소 변경안:**

* code-signing 인증서와 updater signing key 보관 절차
* static release manifest
* stable·beta channel 분리
* update 전 data snapshot
* migration dry-run
* 실패 시 이전 binary·data로 rollback
* 네트워크 확인은 명시적 opt-in

**전환 트리거:** signed 설치본, rollback drill, N‑2 migration test, update key 복구 절차가 모두 통과할 때다.

**하지 않을 것:** unsigned silent update, 강제 자동 업데이트, 앱 실행 중 사용자 독서 데이터를 migration한 뒤 rollback 불가 상태로 만들기.

### 6.9 Python sidecar 유지·축소·이전

**현재 판단:** 6개월 동안 Python sidecar를 유지한다.

**왜 지금:** 현재 parser·encoding·archive·FastAPI 경로와 테스트 자산이 Python에 집중되어 있고, sidecar는 동적 포트·nonce·health·process cleanup까지 구현됐다. 이를 Rust나 프런트로 옮기는 것은 핵심 사용자 문제를 해결하지 않는다.

**최소 변경안:**

* full-read·search·ZIP manifest 같은 측정된 hot path만 개선
* PyInstaller dependency와 startup log 정리
* sidecar 시작 실패에 사용자용 diagnosis 제공
* blocking task를 worker/threadpool로 이동
* parser cache에 revision·memory budget 적용

**전환 트리거:**

* sidecar cold startup p95 2초 초과
* 백신 차단·오탐 support 비율 2% 초과
* installer가 50MiB 이상으로 증가
* Python memory·crash가 주요 support 원인
* 특정 hot path를 Rust로 옮겼을 때 측정상 3배 이상 개선

**하지 않을 것:** backend 전체 Rust 재작성, EPUB/ZIP parser를 WebView JavaScript로 옮기기, installer 크기만을 이유로 architecture 교체.

### 6.10 플러그인 대비

**현재 판단:** 외부 플러그인 API는 만들지 않는다. 내부 format adapter만 확장 가능하게 한다.

**왜 지금:** 외부 plugin은 API versioning, sandbox, 서명, 악성 코드, 지원 책임을 함께 만든다. 1인 개발 제품의 유지 범위를 넘어선다.

**최소 변경안:** 내부적으로 capability 기반 adapter registry를 두고 TXT·EPUB·ZIP을 같은 계약으로 연결한다.

**전환 트리거:** 독립적으로 유지되는 format adapter가 세 개 이상 추가되고, 보안·버전 호환을 담당할 자원이 생긴 뒤다.

**하지 않을 것:** 동적 DLL·Python·JavaScript 로딩, 앱 데이터와 파일 시스템에 자유롭게 접근하는 third-party code, “향후 plugin을 위해” 현재 API를 과도하게 일반화하기.

---

## 7. 현실적 실패 사례 행렬

| 사례                 | 사용자 증상                                        | 손실 가능성            | 예방                                                         | 복구                                 | 가장 가치 높은 자동화 테스트                                                |
| ------------------ | --------------------------------------------- | ----------------- | ---------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| 수백 MiB TXT         | 앱 정지, sidecar 종료, 첫 페이지가 오래 안 나옴              | 원문 없음; 마지막 진행률 일부 | streaming decode, sparse index, memory budget, 지원 상한       | 기존 progress 보존, 재시작 후 첫 window 복원  | 100/300/500MiB cold open의 TTFR·RSS·강제 종료                        |
| 줄바꿈 거의 없는 TXT      | 한 문단 처리로 pagination·검색 지연                     | 낮음                | paragraph와 무관한 hard chunk, Unicode-safe split              | 해당 segment만 다시 index               | 50MiB 단일 line, 공백 없는 CJK, 1MiB emoji sequence                   |
| 잘못된 인코딩            | 한글 깨짐, 검색 실패, 위치 어긋남                          | 주석 위치 중           | confidence 표시, preview, 수동 override, revision 분리           | 다른 encoding으로 재열고 quote reanchor   | CP949/EUC‑KR/UTF‑8/16, BOM, 혼합 byte fixture                     |
| 특수문자·세로쓰기          | emoji 잘림, combining mark 위치 오류, 세로 문서 레이아웃 붕괴 | 위치 중              | code-point offset, grapheme test, 세로쓰기 미지원 명시              | 안전한 가로쓰기 fallback                  | non-BMP·ZWJ·combining·NFC/NFD·CJK punctuation                   |
| 복잡한 EPUB CSS       | 글자가 안 보임, page overflow, chrome 침범            | 낮음                | scoped sanitizer, publisher style off, CSS resource limit  | 안전 reader style로 재열기               | 대표 출판사 CSS visual corpus와 malicious CSS corpus                  |
| 비정상 이미지 경로         | 이미지 누락, chapter blank, traversal 시도           | 낮음~보안 상           | canonical path resolver, encoded traversal 차단, placeholder | 누락 asset 목록과 해당 chapter 계속 읽기      | `../`, `%2e%2e`, backslash, Unicode·case path fixture           |
| DRM·암호화 EPUB       | 빈 책, generic parser error                     | 원문 없음             | encryption metadata 검사, DRM과 font obfuscation 구분           | `지원하지 않는 DRM` 명확히 표시, 파일 보존        | DRM fixture, encrypted spine, obfuscated font                   |
| 손상 EPUB            | 열기 실패, 일부 chapter crash                       | 원문 없음; 진행률 낮음     | ZIP·container·OPF preflight, parser timeout                | 손상 보고서, 다른 책 계속 사용                 | truncation, bad central directory, missing OPF/spine            |
| 수천 이미지 ZIP         | 페이지 전환 지연, 메모리 증가                             | 낮음                | revision별 manifest 1회 검증, O(1) member lookup, 제한 prefetch  | 실패 page 건너뛰기·재시도                   | 5,000장 ZIP의 random seek·연속 1,000 page                           |
| 비정상 종료             | 책·메타·주석·진행률 일부만 삭제·저장                         | 높음                | 통합 journal, idempotent replay, flush ordering              | startup repair·rollback report     | 모든 journal phase 직후 process kill                                |
| 디스크 부족             | 가져오기·backup·migration 실패, temp 잔류             | 높음                | free-space preflight, fsync, 원본 보존                         | temp cleanup, 이전 snapshot 유지       | ENOSPC fault injection at write/backup/replace                  |
| 파일 이동·삭제·이름 변경     | 책 누락, 중복 재등록                                  | 중                 | 1.0 managed-copy, fingerprint identity                     | re-import 또는 fingerprint relink    | app-data 외부 변조와 rename/delete fixture                           |
| 데이터 손상             | startup 실패, 빈 라이브러리로 보임                       | 매우 높음             | checksum, backup rotation, quarantine, read-only mode      | repair report와 선택적 복원              | primary truncate·bit flip·primary+backup 동시 손상                  |
| 업데이트 migration 실패  | 새 버전 시작 불가, 일부 데이터만 변환                        | 매우 높음             | pre-update snapshot, dry-run, version gate                 | 이전 binary와 데이터 snapshot으로 rollback | 모든 역사적 schema → 현재 → 이전 버전 복귀                                   |
| Windows 긴 경로·한글 경로 | 가져오기·asset·sidecar 실행 실패                      | 중                 | 짧은 ID 기반 stored filename, Unicode normalization            | 관리 사본으로 재복사, 경로 진단                 | 240자 이상, 한글·emoji·NFC/NFD 설치·책 경로                               |
| 백신 sidecar 차단      | 앱은 열리나 library/API가 계속 실패                     | 원문 없음; 사용 불가      | installer·sidecar 서명, actionable status, log, retry        | quarantine 복구 안내, 재설치·수동 허용        | missing executable, access denied, 즉시 종료, quarantine simulation |

---

## 8. 1인 개발자 5단계 로드맵

26주 중 실제 feature·refactor 작업은 약 20인주로 제한하고 나머지는 회귀 수정, 배포, 문서, 사용자 대응에 남긴다. 동시 진행 중인 작업은 항상 최대 두 개다.

| 단계                   | 목표                       | 기능·작업                                                                                                             | 해결할 기술 부채                                 |    인주 | 완료 조건                                                                  | 중단·축소 기준                                            | 다음 단계 진입 게이트                 |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----: | ---------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| 1. 출시 가능 최소 기준, 1–6주 | 핵심 약속을 거짓 없이 만들기         | bounded-memory TXT, locator v2 TXT, encoding override, search 취소, delete-progress 일관성                             | full read, page locator, 손상 journal       |     6 | 300MiB 지원 SLO, v1 restore, 모든 delete phase 복구, P0 0건                   | 4주차까지 streaming 불안정이면 1.0 지원 상한을 명시적으로 낮추고 beta로 제한 | golden corpus·fault suite 통과 |
| 2. 안정화, 7–12주        | 데이터 신뢰와 설치형 RC           | 사용자 backup/restore, repository boundary, EPUB/ZIP background 작업, ZIP manifest cache, disk/corruption/long-path QA | 저장 책임 분산, blocking API, per-page ZIP scan |     5 | verified restore, 손상 journal에서도 startup, fresh install RC, P1 치명 오류 0건 | durability gate 실패 시 신규 UI 기능 전부 중단                 | RC를 2주 사용해 신규 P0/P1 없음       |
| 3. 편의 기능, 13–16주     | 기능은 그대로 두고 사용 흐름 단순화     | ReaderShell, 검색 결과 통일, 주석 export, 가져오기 queue, 용어 정리                                                               | reader 중복, Dashboard·Toolbar 비대           |     3 | 키보드·focus·작은 창 테스트, reader 동작 회귀 없음                                    | 일정 초과 시 자동 표지·추가 metadata UI부터 삭제                   | 안정 버전의 crash·support 부담 유지   |
| 4. 차별화, 17–22주       | “읽던 문장으로 복원”을 제품 장점으로 완성 | source 변경 reanchor, 인코딩 UX, 대형 TXT 진단, EPUB 오류 분류, ZIP 방향·표지 pairing                                              | locator orphan, 모호한 오류                    |     4 | 변경 원문 exact 또는 명시적 approximate 복원, silent wrong jump 0건                | 새 형식 요청은 모두 거절                                      | 핵심 사용자 시나리오 성공률 90% 이상       |
| 5. 장기 확장, 23–26주     | 안전한 운영 기반                | signed opt-in updater 또는 1.0.x 안정화, CBZ alias 조건부                                                                 | signing·migration·rollback                | 2 조건부 | updater rollback drill 또는 1.0.x 무회귀                                    | signing·rollback 미완료면 updater를 버리고 안정화에 전량 사용       | 1.0 신뢰성 유지 후에만 다음 기능 승인      |

### 8.1 구체적인 첫 3개월 캘린더

| 기간     | 작업 A                                               | 작업 B                                                     | 종료 게이트                                  |
| ------ | -------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| 1–2주   | 대형 TXT benchmark corpus·SLO·streaming source seam  | locator v2 ADR·TXT 적용·delete journal에 progress 포함        | full-read 병목 수치화, crash-delete 불변조건 테스트 |
| 3–4주   | sparse index·첫 window 우선 로딩·single-line hard chunk | 인코딩 preview·override·revision 처리                         | 300MiB cold-open 기준 및 no-line corpus 통과 |
| 5–6주   | 취소 가능한 streaming TXT 검색                            | font·window·margin 변경 복원, quote fallback                 | 검색 취소와 정확한 locator 회귀 통과                |
| 7–8주   | data-only/full backup bundle·restore preview       | disk full·store corruption·journal corruption fault test | 기존 데이터 손상 없이 restore 성공                 |
| 9–10주  | repository boundary·fingerprint/cache 비용 최적화       | EPUB threadpool·ZIP manifest cache·malformed corpus      | event-loop stall 및 ZIP 반복 검증 제거         |
| 11–12주 | signed 또는 signing-ready 설치 RC·fresh app-data smoke | P0/P1 수정만 수행                                             | 새로운 기능 없이 RC 승인                         |

### 8.2 6개월 캘린더

| 월    | 목표            | 허용 WIP 1                        | 허용 WIP 2                        | 월말 산출물                              |
| ---- | ------------- | ------------------------------- | ------------------------------- | ----------------------------------- |
| 1개월차 | 대형 TXT와 위치 모델 | streaming TXT                   | locator/delete durability       | 성능 계약·locator v2                    |
| 2개월차 | 검색·복원 안정화     | cancellable search              | encoding·layout restore         | 핵심 TXT beta                         |
| 3개월차 | 데이터·설치 안정화    | backup/restore                  | EPUB·ZIP·Windows fault QA       | 1.0 RC                              |
| 4개월차 | UX 단순화        | ReaderShell                     | import/search/annotation export | 공통 reader UX                        |
| 5개월차 | 차별화 완성        | source-change reanchor          | EPUB·ZIP 오류와 comic polish       | 신뢰성 중심 1.0                          |
| 6개월차 | 운영            | signed updater **또는** 1.0.x 안정화 | 사용자 피드백 기반 P0/P1만               | rollback 검증된 update 또는 더 안정적인 1.0.x |

**3개월 목표:** 공개 범위를 제한한 1.0 RC 또는 signed beta
**6개월 목표:** 대형 TXT·비DRM EPUB·ZIP 범위에서 상용으로 책임질 수 있는 1.0

---

## 9. 다음 코드 리뷰 우선순위

| 순위 | 파일·기능                                                                                    | 구체적 실패 가설                                              | 확인할 불변조건                                                     | 필요한 테스트                                                         |
| -: | ---------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
|  1 | `backend/services/txt_service.py`                                                        | 전체 read로 OOM, 단일 line이 거대 segment                      | memory가 파일 크기에 선형 비례하지 않음; offset 단조 증가                      | 100/300/500MiB, 50MiB single-line, 여러 encoding RSS              |
|  2 | `frontend/src/components/TxtReader.jsx`, `frontend/src/lib/txtMeasuredPagination.js`     | window 전환·resize 중 page gap/overlap, anchor drift      | source range가 중복·누락 없이 전체를 덮음; layout 변경 후 같은 anchor         | property test, rapid resize, font change, delayed window        |
|  3 | `frontend/src/hooks/useReadingProgress.js`, `backend/services/reading_progress_store.py` | local·backend race와 clock skew로 오래된 위치가 승리             | 가장 최신의 유효 entry만 적용; flush idempotent                        | delayed PUT/GET, clock skew, pagehide, book switch              |
|  4 | `backend/services/delete_recovery.py`, `backend/routers/books.py`                        | crash 후 progress 고아, 손상 journal로 startup 실패            | 삭제는 파일·메타·주석·progress 전체 완료 또는 전체 복원                         | 각 phase kill, truncated journal, replay 두 번                     |
|  5 | `backend/services/library_store.py`                                                      | startup scan·full SHA‑1이 대형 라이브러리를 지연, 손상 record 자동 손실 | ID 유일, missing record 보존, backup recovery 결정적                | 1,000권, 대형 파일, primary/backup 손상, disk fault                    |
|  6 | `backend/services/search_service.py`, books search route                                 | prewarm 중복, 전체 scan, event loop 정지                     | 검색 취소 가능, 결과 offset가 원문과 일치, 다른 API responsive               | 500MiB TXT, non-BMP, cancellation, concurrent health/progress   |
|  7 | `backend/services/epub_service.py`                                                       | stale cache, 잘못된 asset 경로, DRM·손상 모두 generic error     | cache는 revision별, package limit 우회 불가, 오류 분류 안정              | ZIP bomb, encrypted EPUB, missing asset, font obfuscation       |
|  8 | `frontend/src/lib/epubSanitizer.js`                                                      | CSS·URL 공격이 통과하거나 정상 문서가 과도하게 삭제                       | 외부 script/network/chrome 침범 0; fallback 예측 가능                | malicious HTML/CSS와 SVG·MathML·fixed-layout corpus              |
|  9 | `frontend/src/components/EpubReader.jsx`                                                 | 이전 chapter 측정 결과가 새 chapter·새 layout에 commit           | generation이 다르면 결과 폐기; visible anchor 유지                     | slow image/font, rapid chapter switch, resize, search jump      |
| 10 | `backend/services/zip_service.py`, `frontend/src/components/ZipReader.jsx`               | page마다 O(n) 검증, 양면 pairing 오류                          | manifest revision당 1회; member lookup O(1); 방향·표지 pairing 결정적 | 5,000장, corrupt middle page, RTL, odd cover                     |
| 11 | `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/tauri.conf.json`                    | AV·port·spawn 실패가 빈 화면으로 끝나거나 orphan process 발생        | 인증된 owned sidecar만 사용; 종료 후 process 0; 오류 actionable         | missing/quarantined exe, port race, forced exit, 한글 설치 경로       |
| 12 | `frontend/src/pages/Dashboard.jsx`, `DashboardSettingsPanel.jsx`, `ReaderToolbar.jsx`    | 가져오기·삭제 용어 혼란, focus 손실, input에서 reader shortcut 실행    | destructive action 명확, dialog focus 복원, 작은 창 usable          | keyboard-only, 1024×600, bulk move/delete, settings persistence |

---

## 10. 원 기획에서 수정해야 할 전제

1. **“분할 로딩이 있으므로 대용량 TXT가 해결됐다”는 전제가 틀렸다.** 프런트 window와 백엔드 source materialization은 별개의 문제다.

2. **“로컬 우선”의 정의가 부족하다.** 서버로 전송하지 않는 것만으로 끝나지 않는다. 관리 사본인지 외부 파일 link인지, backup에 책 원문이 포함되는지, updater가 언제 네트워크를 사용하는지 명시해야 한다.

3. **page 번호를 독서 위치로 보는 전제가 잘못됐다.** reflow 문서에서는 page가 결과이고 source locator가 본체다.

4. **‘폴더’ 요구가 중복·혼동되어 있다.** 현재 폴더는 논리 조직이며, 외부 폴더 등록·일회성 가져오기·상시 감시는 서로 완전히 다른 기능이다.

5. **후보 목록에 이미 구현된 기능이 섞여 있다.** 책 내부 검색, 태그·컬렉션, 메타데이터 편집, 중복 관련 필드, backup 보호장치는 “새 기능”이 아니라 정확성·IA·복구성 문제다.

6. **상용 출시 결정에 code signing이 빠져 있다.** unsigned installer와 sidecar는 Windows에서 실제 사용성을 훼손할 수 있다. updater보다 signing이 먼저다.

7. **EPUB 지원 범위가 정의되지 않았다.** DRM, fixed-layout, SVG, MathML, 세로쓰기, scripted content, font obfuscation의 지원 여부를 support matrix로 공개해야 한다.

8. **smoke 통과를 resilience 통과로 해석하면 안 된다.** 정상 설치·정상 파일·정상 종료 smoke는 disk full, journal corruption, kill, AV 차단을 검증하지 않는다.

9. **PDF·OPDS·TTS·AI·plugin은 backlog 항목이 아니라 별도 제품 축이다.** 이들을 같은 6개월 계획에 넣으면 핵심 reader 신뢰성이 완성되지 않는다.

10. **1인 개발자는 streaming pipeline, SQLite migration, updater, 새 형식, UI 재작성 중 하나나 둘만 동시에 다룰 수 있다.** WIP 2를 넘으면 모든 작업이 절반 구현 상태로 남는다.

---

# 최종 결론

## 집중할 단 하나의 핵심 가치

> **대용량 로컬 책에서도 읽던 문장을 잃지 않는 Windows 독서 신뢰성**

## 한 문장 추천 제품 전략

> **기능 폭을 포기하고, 대용량 한국어 TXT의 bounded-memory 즉시 열기와 형식 공통의 문장 단위 이어읽기 신뢰성을 BookReader 1.0의 유일한 구매 이유로 만든다.**

## 지금 개발할 상위 10개 / 지금 개발하지 않을 상위 10개

| 순위 | 지금 개발할 것                                   | 지금 개발하지 않을 것            |
| -: | ------------------------------------------ | ----------------------- |
|  1 | bounded-memory 대형 TXT source·sparse index  | PDF                     |
|  2 | locator v2와 quote-based reanchor           | CBR                     |
|  3 | progress까지 포함하는 통합 operation journal       | OPDS                    |
|  4 | 검증 가능한 사용자 backup·restore                  | 클라우드·설정 동기화             |
|  5 | 취소 가능한 책 내부 검색                             | AI 요약·질의응답              |
|  6 | 인코딩 preview·override와 no-line 처리           | 외부 플러그인                 |
|  7 | EPUB·ZIP 실패 진단과 corpus hardening           | TTS                     |
|  8 | 공통 ReaderShell과 설정 단순화                     | 번역·온라인 사전               |
|  9 | 주석 Markdown+JSON export                    | 상시 폴더 감시                |
| 10 | code signing·Windows fault QA·updater 전제조건 | 세로쓰기·fixed-layout 완전 준수 |

## 가장 위험한 기술 결정 5개

1. 전체 원문을 메모리에 읽는 상태에서 “수백 MiB TXT 지원”을 제품 약속으로 내거는 것
2. page 번호나 chapter page를 영구 독서 위치로 계속 사용하는 것
3. 지금 SQLite로 big-bang migration하거나 JSON·SQLite를 장기간 dual-write하는 것
4. 측정 근거 없이 Python sidecar 전체를 Rust 또는 프런트로 재작성하는 것
5. signing·key custody·migration rollback 없이 자동 업데이트부터 배포하는 것

## 가장 큰 UX 위험 5개

1. 사용자가 모르는 사이 다른 문장으로 복원되는 것
2. `가져오기`, `폴더`, `라이브러리에서 제거`, `파일 삭제`의 의미가 섞이는 것
3. 태그·컬렉션·폴더·시리즈·중복·상세 설정이 독서 시작을 방해하는 것
4. EPUB 총 페이지 수와 진행률이 background 측정 중 계속 바뀌는 것
5. DRM·손상·asset 누락·sidecar 차단을 모두 “열기 실패” 또는 빈 화면으로 보여주는 것

## 3개월 현실 로드맵

3개월 안에는 새 형식을 추가하지 않는다. 대형 TXT pipeline, locator v2, 검색 취소, 인코딩 override, cross-store durability, backup/restore, EPUB·ZIP blocking 제거와 Windows fault QA를 끝낸다. 결과물은 **상용 범위를 명확히 제한한 1.0 RC 또는 signed beta**다.

## 6개월 현실 로드맵

4~5개월차에 ReaderShell, 검색 UX 통합, 주석 export, source 변경 reanchor를 완성한다. 6개월차에는 signing·rollback이 준비된 경우에만 opt-in updater를 넣고, 그렇지 않으면 전부 1.0.x 안정화에 사용한다. PDF·클라우드·AI·TTS·OPDS는 포함하지 않는다.

## 실패 가능성이 높은 이유

* 경쟁 제품의 기능 폭을 따라가려는 유혹이 크다.
* 현재 가장 중요한 대형 TXT 경로가 실제로는 full-memory다.
* EPUB·ZIP의 비정상 파일과 Windows 설치 환경은 정상 smoke보다 훨씬 넓다.
* 사용자는 기능 한 개 부족한 것보다 읽던 위치가 틀리거나 데이터가 사라지는 것을 더 오래 기억한다.
* 1인 개발자가 architecture refactor, format expansion, updater, DB migration을 함께 시작하면 WIP가 폭발한다.

## 성공을 위해 반드시 포기할 것

* 범용 전자책 reader라는 표현
* 완전한 EPUB 3 지원
* PDF·CBR·OPDS
* 클라우드·AI·plugin
* 총 페이지 수의 절대적 정확성
* 6개월 내 SQLite 전환
* 전체 sidecar 재작성
* 세 개 이상의 동시 작업

---

## 가장 먼저 실행할 2주 작업 묶음

동시 작업은 아래 두 묶음만 허용한다.

### 작업 묶음 A — 대형 TXT의 실제 상한 확정

**산출물**

* Windows 11, 16GiB RAM, NVMe 기준 reference 환경
* 10/100/300/500MiB TXT corpus
* UTF‑8, UTF‑16, CP949/EUC‑KR, CRLF/LF, 50MiB single-line, non-BMP fixture
* cold open, first readable page, peak private bytes, 검색 취소 latency 보고서
* `TxtSource` streaming·sparse-index 경계
* 큰 파일의 첫 window 경로에서 전체 `file.read()` 제거
* 1.0이 실제로 책임질 파일 크기 support contract

**완료 기준**

* 300MiB cold open에서 첫 읽을 수 있는 문장이 5초 이내
* 500MiB stress file이 OOM 없이 열리며 첫 문장이 10초 이내
* 500MiB 처리 중 sidecar peak private bytes 350MiB 이하를 목표로 하고, 파일 크기와 동일한 비율로 증가하지 않음
* 50MiB single-line 문서가 하나의 DOM node·하나의 측정 단위로 남지 않음
* source offset 범위에 gap·overlap이 없음
* 진행 중 검색 취소 후 250ms 안에 reader 조작이 가능
* 4주차까지 이 기준을 충족하지 못하면 1.0 지원 상한을 측정된 값으로 낮추고 300MiB 지원 문구를 제거

### 작업 묶음 B — 위치·삭제 신뢰성

**산출물**

* locator v2 ADR와 구형 v1 fixture
* TXT code-point offset + exact/prefix/suffix quote
* v1 read·v2 lazy upgrade
* 진행률을 포함한 delete journal
* 손상 journal quarantine와 repair report
* 글꼴·창·여백·원문 변경 복원 fixture

**완료 기준**

* 원문이 같은 경우 20개 글꼴·창·여백 조합의 99% 이상에서 같은 문장으로 복원
* 원문이 변경된 경우 exact quote 또는 명시적 `대략적 복원`으로만 이동
* 잘못된 문장으로 조용히 이동하는 테스트 사례 0건
* 삭제 각 phase에서 강제 종료해도 최종 상태가 `책·메타·주석·진행률 모두 존재` 또는 `모두 삭제` 중 하나
* 같은 journal을 두 번 재생해도 결과가 동일
* 손상 journal 때문에 앱 전체가 시작 불가 상태가 되지 않음
* v1 데이터가 열리고 다음 저장 시 v2가 됨

### 2주 회귀 테스트

* 현재 `backend/tests/test_txt_service.py`의 segment·dense paragraph·cursor·cache 검증
* 현재 `backend/tests/test_search_service.py`의 locator·Unicode mapping 검증
* TXT measured pagination의 source range property test
* 50MiB single-line·Unicode grapheme·mixed newline test
* font·window·margin 연속 변경 중 restore test
* delete phase별 process-kill fault injection
* primary·backup·journal 손상 test
* packaged sidecar authenticated health
* fresh app-data 설치본에서 TXT·EPUB·ZIP open·진행률 저장·재시작 smoke

**냉정한 최종 판정:** BookReader는 기능을 더 붙여야 상용 제품이 되는 상태가 아니다. 이미 구현된 기능의 폭은 충분하다. 향후 6개월의 성공 여부는 **대형 TXT가 실제로 메모리 상한 안에서 열리는지, 사용자가 읽던 문장으로 정확히 돌아오는지, 어떤 실패 뒤에도 독서 데이터가 복구되는지** 세 가지로 결정된다.

[1]: https://calibre-ebook.com/about "https://calibre-ebook.com/about"
[2]: https://www.sumatrapdfreader.org/free-pdf-reader "https://www.sumatrapdfreader.org/free-pdf-reader"
[3]: https://thorium.edrlab.org/en/ "https://thorium.edrlab.org/en/"
[4]: https://johnfactotum.github.io/foliate/ "https://johnfactotum.github.io/foliate/"
[5]: https://play.google.com/store/apps/details?id=com.faultexception.reader "https://play.google.com/store/apps/details?id=com.faultexception.reader"
[6]: https://www.w3.org/TR/epub-33/ "https://www.w3.org/TR/epub-33/"
[7]: https://v2.tauri.app/plugin/updater/ "https://v2.tauri.app/plugin/updater/"
