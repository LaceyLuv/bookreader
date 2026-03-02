import { withThemeVars } from '../constants/themes'

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
        return withThemeVars({ bg: SAFE_APP_BG, fg: SAFE_APP_FG })
    }
    const saved = getSavedReaderSettings()
    return withThemeVars({
        bg: saved.bgColor || DEFAULT_APP_BG,
        fg: saved.textColor || DEFAULT_APP_FG,
        pageBg: saved.pageBg || saved.bgColor,
        pageFg: saved.pageFg || saved.textColor,
        panelBg: saved.panelBg,
        panelBorder: saved.panelBorder,
        accent: saved.accent,
    })
}

export function isSafeModeEnabled() {
    try {
        return localStorage.getItem(SAFE_MODE_STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

function normalizeThemeInput(bgOrTheme, fg) {
    if (bgOrTheme && typeof bgOrTheme === 'object') return bgOrTheme
    return { bg: bgOrTheme, fg }
}

export function setAppThemeVars(bgOrTheme, fg) {
    const root = getRoot()
    if (!root) return
    const theme = withThemeVars(normalizeThemeInput(bgOrTheme, fg))
    const appBg = theme.bg || DEFAULT_APP_BG
    const appFg = theme.fg || DEFAULT_APP_FG
    root.style.setProperty('--app-bg', appBg)
    root.style.setProperty('--app-fg', appFg)
    root.style.setProperty('--reader-page-bg', theme.pageBg || appBg)
    root.style.setProperty('--reader-page-fg', theme.pageFg || appFg)
    root.style.setProperty('--panel-bg', theme.panelBg)
    root.style.setProperty('--panel-border', theme.panelBorder)
    root.style.setProperty('--accent', theme.accent)
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
    if (typeof window === 'undefined') return () => { }
    const listener = (event) => {
        const next = event?.detail?.visible
        if (typeof next === 'boolean') handler(next)
    }
    window.addEventListener(VISIBILITY_EVENT, listener)
    return () => window.removeEventListener(VISIBILITY_EVENT, listener)
}
