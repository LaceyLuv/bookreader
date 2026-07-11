let desktopApiBase = 'http://127.0.0.1:8000'
let desktopNonce = null
let desktopAssetToken = null

export function detectTauriRuntime(windowLike = globalThis.window) {
    if (!windowLike) return false
    return !!windowLike.__TAURI_INTERNALS__
}

export function getApiBase(windowLike = globalThis.window) {
    return detectTauriRuntime(windowLike) ? desktopApiBase : ''
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
export let API_BASE = getApiBase()
export let API_BOOKS_BASE = getApiBooksBase()
export let API_FONTS_BASE = getApiFontsBase()
export let API_HEALTH_URL = getApiHealthUrl()

export function configureDesktopBackend({ apiBase, nonce, assetToken }, windowLike = globalThis.window) {
    if (!detectTauriRuntime(windowLike)) return
    const parsed = new URL(apiBase)
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
        throw new Error('Tauri returned an invalid backend address.')
    }
    if (nonce != null && (typeof nonce !== 'string' || nonce.length < 32)) {
        throw new Error('Tauri returned an invalid backend credential.')
    }
    if (assetToken != null && (typeof assetToken !== 'string' || assetToken.length < 32)) {
        throw new Error('Tauri returned an invalid asset credential.')
    }
    desktopApiBase = parsed.origin
    desktopNonce = nonce || null
    desktopAssetToken = assetToken || null
    API_BASE = desktopApiBase
    API_BOOKS_BASE = buildApiPath(API_BASE, '/api/books')
    API_FONTS_BASE = buildApiPath(API_BASE, '/api/fonts')
    API_HEALTH_URL = buildApiPath(API_BASE, '/api/health')
}

export function authenticateAssetUrl(url) {
    if (!desktopAssetToken) return url
    const parsed = new URL(url, desktopApiBase)
    if (parsed.origin !== desktopApiBase || !parsed.pathname.includes('/asset/')) return url
    parsed.searchParams.set('asset_token', desktopAssetToken)
    return parsed.toString()
}

export function installDesktopFetchAuthentication(windowLike = globalThis.window) {
    if (!detectTauriRuntime(windowLike) || !desktopNonce) return
    const originalFetch = windowLike.fetch.bind(windowLike)
    windowLike.fetch = (input, init = {}) => {
        const url = new URL(input instanceof Request ? input.url : String(input), windowLike.location.href)
        if (url.origin !== desktopApiBase) return originalFetch(input, init)
        const headers = new Headers(input instanceof Request ? input.headers : init.headers)
        headers.set('X-BookReader-Nonce', desktopNonce)
        return originalFetch(input, { ...init, headers })
    }
}
