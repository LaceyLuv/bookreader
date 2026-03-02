/**
 * i18n dictionary for English (en) and Korean (ko).
 * Usage:  import { t } from '../i18n'
 *         t('library', 'ko')  → '라이브러리'
 */

const dict = {
    // ─── Dashboard ───
    appTitle: { en: 'Universal Book Reader', ko: '유니버설 북 리더' },
    appSubtitle: { en: 'TXT · EPUB · ZIP Comics', ko: 'TXT · EPUB · ZIP 만화' },
    library: { en: 'Library', ko: '라이브러리' },
    uploadPrompt: { en: 'Drop a file here or click to upload', ko: '파일을 놓거나 클릭하여 업로드' },
    uploading: { en: 'Uploading...', ko: '업로드 중...' },
    supportedFiles: { en: 'Supports .txt, .epub, .zip files', ko: '.txt, .epub, .zip 파일 지원' },
    emptyLibrary: { en: 'Your library is empty', ko: '라이브러리가 비어 있습니다' },
    emptyLibrarySub: { en: 'Upload a book to get started', ko: '책을 업로드하여 시작하세요' },
    deleteConfirm: { en: 'Delete this book?', ko: '이 책을 삭제하시겠습니까?' },
    progress: { en: 'Progress', ko: '진행률' },

    // ─── Reader common ───
    backToLibrary: { en: 'Back to Library', ko: '라이브러리로 돌아가기' },
    bookmark: { en: 'Bookmark', ko: '북마크' },
    addBookmark: { en: 'Add Bookmark', ko: '북마크 추가' },
    bookmarks: { en: 'Bookmarks', ko: '북마크' },
    toc: { en: 'Table of Contents', ko: '목차' },
    contents: { en: 'Contents', ko: '목차' },
    page: { en: 'Page', ko: '페이지' },
    chapter: { en: 'Ch', ko: '장' },
    images: { en: 'images', ko: '이미지' },
    noImagesFound: { en: 'No images found', ko: '이미지를 찾을 수 없습니다' },
    previous: { en: 'Previous', ko: '이전' },
    next: { en: 'Next', ko: '다음' },

    // ─── Settings Panel ───
    settings: { en: 'Reading Settings', ko: '읽기 설정' },
    theme: { en: 'Theme', ko: '테마' },
    dark: { en: 'Dark', ko: '다크' },
    sepia: { en: 'Sepia', ko: '세피아' },
    light: { en: 'Light', ko: '라이트' },
    font: { en: 'Font', ko: '글꼴' },
    serif: { en: 'Serif', ko: '명조' },
    sansSerif: { en: 'Sans-serif', ko: '고딕' },
    size: { en: 'Size', ko: '크기' },
    layout: { en: 'Layout', ko: '레이아웃' },
    single: { en: 'Single', ko: '단일' },
    dual: { en: 'Dual', ko: '양면' },
    typography: { en: 'Typography', ko: '타이포그래피' },
    lineHeight: { en: 'Line Height', ko: '줄 높이' },
    letterSpacing: { en: 'Letter Spacing', ko: '자간' },
    margins: { en: 'Margins', ko: '여백' },
    hMargin: { en: 'Horizontal Margin', ko: '좌우 여백' },
    vMargin: { en: 'Vertical Margin', ko: '상하 여백' },
    splitMargin: { en: 'Split Margin', ko: '분할 여백' },
    titleBar: { en: 'Title Bar', ko: '타이틀 바' },
    showTitleBar: { en: 'Show Title Bar', ko: '타이틀 바 표시' },
    hideTitleBar: { en: 'Hide Title Bar', ko: '타이틀 바 숨김' },
    language: { en: 'Language', ko: '언어' },
    keyboardHint: { en: '← → Arrow keys or Space to turn pages', ko: '← → 방향키 또는 스페이스로 페이지 넘기기' },
    resetDefaults: { en: 'Reset to Defaults', ko: '기본값으로 초기화' },
    resetConfirm: { en: 'Reset all settings to defaults?', ko: '모든 설정을 기본값으로 초기화하시겠습니까?' },
    resetDone: { en: 'Settings restored to defaults', ko: '설정이 기본값으로 복원되었습니다' },

    // ─── Resume Toast ───
    resumeReading: { en: 'Resume reading?', ko: '이어서 읽으시겠습니까?' },
    youWereAt: { en: 'You were at', ko: '마지막 위치:' },
    resume: { en: 'Resume', ko: '이어 읽기' },
    startOver: { en: 'Start Over', ko: '처음부터' },
}

/**
 * Translate a key to the given language.
 * Falls back to English if key or language is missing.
 */
export function t(key, lang = 'en') {
    const entry = dict[key]
    if (!entry) return key
    return entry[lang] || entry.en || key
}

/**
 * Create a bound translator for a specific language.
 * Usage:  const tt = createT('ko');  tt('library') → '라이브러리'
 */
export function createT(lang) {
    return (key) => t(key, lang)
}
