/**
 * i18n dictionary for English (en) and Korean (ko).
 * Usage: import { t } from '../i18n'
 */

const dict = {
    // Dashboard
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

    // Reader common
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

    // Settings panel
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

    // Extended settings labels
    themeApplied: { en: 'applied', ko: '적용됨' },
    fontUploaded: { en: 'Font uploaded', ko: '글꼴 업로드 완료' },
    fontLoadFailed: { en: 'Failed to load fonts', ko: '글꼴 목록을 불러오지 못했습니다' },
    fontUploadFailed: { en: 'Failed to upload font', ko: '글꼴 업로드에 실패했습니다' },
    systemFont: { en: 'System', ko: '시스템' },
    customSelectedFont: { en: 'Custom selected font', ko: '사용자 선택 글꼴' },
    addFont: { en: 'Add font', ko: '글꼴 추가' },
    loadingFonts: { en: 'Loading fonts...', ko: '글꼴 불러오는 중...' },
    uploadedCountSuffix: { en: 'uploaded', ko: '개 업로드됨' },
    useEpubEmbeddedFonts: { en: 'Use EPUB embedded fonts', ko: 'EPUB 내장 글꼴 사용' },
    embeddedFontsHint: { en: 'Embedded mode affects EPUB content only.', ko: '내장 모드는 EPUB 본문에만 적용됩니다.' },
    weight: { en: 'Weight', ko: '굵기' },
    regularWeight: { en: 'Regular (400)', ko: '기본 (400)' },
    boldWeight: { en: 'Bold (700)', ko: '굵게 (700)' },
    custom: { en: 'Custom', ko: '사용자 설정' },
    colors: { en: 'Colors', ko: '색상' },
    preset: { en: 'Preset', ko: '프리셋' },
    bg: { en: 'BG', ko: '배경' },
    text: { en: 'Text', ko: '텍스트' },
    themePresets: { en: 'Theme Presets', ko: '테마 프리셋' },
    selected: { en: 'Selected', ko: '선택됨' },
    langEnglish: { en: 'English', ko: '영어' },
    langKorean: { en: 'Korean', ko: '한국어' },

    // Resume toast
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
 * Usage: const tt = createT('ko'); tt('library') -> '라이브러리'
 */
export function createT(lang) {
    return (key) => t(key, lang)
}
