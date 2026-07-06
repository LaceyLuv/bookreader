const TAURI_API_BASE = 'http://127.0.0.1:8000'

export function detectTauriRuntime(windowLike = globalThis.window) {
    if (!windowLike) return false
    return !!windowLike.__TAURI_INTERNALS__
}

export function getApiBase(windowLike = globalThis.window) {
    return detectTauriRuntime(windowLike) ? TAURI_API_BASE : ''
}

export function buildApiPath(base, path) {
    const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`
    const normalizedBase = String(base || '').replace(/\/+$/, '')
    return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath
}

export function getApiBooksBase(windowLike = globalThis.window) {
    return buildApiPath(getApiBase(windowLike), '/api/books')
}

export function getApiFontsBase(windowLike = globalThis.window) {
    return buildApiPath(getApiBase(windowLike), '/api/fonts')
}

export function getApiHealthUrl(windowLike = globalThis.window) {
    return buildApiPath(getApiBase(windowLike), '/api/health')
}

export const IS_TAURI_RUNTIME = detectTauriRuntime()
export const API_BASE = getApiBase()
export const API_BOOKS_BASE = getApiBooksBase()
export const API_FONTS_BASE = getApiFontsBase()
export const API_HEALTH_URL = getApiHealthUrl()
