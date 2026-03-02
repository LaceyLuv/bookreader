function detectTauriRuntime() {
    if (typeof window === 'undefined') return false
    return !!window.__TAURI_INTERNALS__
}

export const IS_TAURI_RUNTIME = detectTauriRuntime()
export const API_BASE = IS_TAURI_RUNTIME ? 'http://127.0.0.1:8000' : ''
export const API_BOOKS_BASE = `${API_BASE}/api/books`
export const API_FONTS_BASE = `${API_BASE}/api/fonts`
