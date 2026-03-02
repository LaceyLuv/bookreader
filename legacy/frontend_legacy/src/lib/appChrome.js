const SETTINGS_STORAGE_KEY = 'bookreader_settings'
export const SAFE_MODE_STORAGE_KEY = '__BOOKREADER_SAFE_MODE__'

export const DEFAULT_APP_BG = '#1a1b1e'
export const DEFAULT_APP_FG = '#d1d5db'
export const SAFE_APP_BG = '#f7f7f7'
export const SAFE_APP_FG = '#111'
export const TITLE_BAR_HEIGHT = 40

const VISIBILITY_EVENT = 'bookreader:titlebar-visibility'

function getRoot() {
    if (typeof document === 'undefined') return null
    return document.documentElement
}

export function getSavedReaderSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

export function getInitialAppTheme() {
    if (isSafeModeEnabled()) {
        return {
            bg: SAFE_APP_BG,
            fg: SAFE_APP_FG,
        }
    }
    const saved = getSavedReaderSettings()
    return {
        bg: saved.bgColor || DEFAULT_APP_BG,
        fg: saved.textColor || DEFAULT_APP_FG,
    }
}

export function isSafeModeEnabled() {
    try {
        return localStorage.getItem(SAFE_MODE_STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export function setAppThemeVars(bg, fg) {
    const root = getRoot()
    if (!root) return
    root.style.setProperty('--app-bg', bg || DEFAULT_APP_BG)
    root.style.setProperty('--app-fg', fg || DEFAULT_APP_FG)
}

export function setTitleBarOffset(visible) {
    const root = getRoot()
    if (!root) return
    const px = visible ? `${TITLE_BAR_HEIGHT}px` : '0px'
    root.style.setProperty('--titlebar-height', px)
}

export function emitTitleBarVisibility(visible) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(VISIBILITY_EVENT, { detail: { visible: !!visible } }))
}

export function onTitleBarVisibilityChange(handler) {
    if (typeof window === 'undefined') return () => {}
    const listener = (event) => {
        const next = event?.detail?.visible
        if (typeof next === 'boolean') {
            handler(next)
        }
    }
    window.addEventListener(VISIBILITY_EVENT, listener)
    return () => window.removeEventListener(VISIBILITY_EVENT, listener)
}
