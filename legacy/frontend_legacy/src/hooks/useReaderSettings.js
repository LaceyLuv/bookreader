import { useState, useCallback, useEffect } from 'react'
import { createT } from '../i18n'
import {
    emitTitleBarVisibility,
    isSafeModeEnabled,
    SAFE_APP_BG,
    SAFE_APP_FG,
    setAppThemeVars,
} from '../lib/appChrome'

const THEMES = {
    dark: { name: 'dark', bg: '#1a1b1e', text: '#d1d5db', card: '#25262b', border: '#373a40' },
    sepia: { name: 'sepia', bg: '#f4ecd8', text: '#5c4b37', card: '#ede0c8', border: '#d4c4a8' },
    light: { name: 'light', bg: '#ffffff', text: '#1f2937', card: '#f9fafb', border: '#e5e7eb' },
}

const FONTS = {
    system: { name: 'system', family: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
    noto: { name: 'noto', family: "\"Noto Sans KR\", system-ui, -apple-system, \"Segoe UI\", Roboto, \"Malgun Gothic\", sans-serif" },
    serif: { name: 'serif', family: "'Merriweather', 'Georgia', 'Times New Roman', serif" },
    mono: { name: 'mono', family: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace" },
}

const STORAGE_KEY = 'bookreader_settings'

const DEFAULTS = {
    theme: 'dark',
    font: 'system',
    fontWeight: 400,
    fontSize: 18,
    layout: 'dual',
    lineHeight: 1.8,
    letterSpacing: -0.01,
    hMargin: 48,
    vMargin: 32,
    columnGap: 64,
    bgColor: '#1a1b1e',
    textColor: '#d1d5db',
    showTitleBar: true,
    lang: 'en',
}

function loadSaved() {
    const safeMode = isSafeModeEnabled()
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
            const merged = { ...DEFAULTS, ...JSON.parse(raw) }
            if (safeMode) {
                return {
                    ...merged,
                    theme: 'light',
                    bgColor: SAFE_APP_BG,
                    textColor: SAFE_APP_FG,
                }
            }
            return merged
        }
    } catch { /* ignore */ }
    if (safeMode) {
        return {
            ...DEFAULTS,
            theme: 'light',
            bgColor: SAFE_APP_BG,
            textColor: SAFE_APP_FG,
        }
    }
    return { ...DEFAULTS }
}

export function useReaderSettings() {
    const [s, setS] = useState(loadSaved)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [resetToast, setResetToast] = useState(false)

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    }, [s])

    const set = useCallback((key, val) => setS(prev => ({ ...prev, [key]: val })), [])

    const incFont = useCallback(() => set('fontSize', Math.min(36, s.fontSize + 2)), [s.fontSize])
    const decFont = useCallback(() => set('fontSize', Math.max(10, s.fontSize - 2)), [s.fontSize])

    const toggleSettings = useCallback(() => setSettingsOpen(o => !o), [])

    // Reset all settings to factory defaults
    const resetDefaults = useCallback(() => {
        const lang = s.lang // preserve language choice
        setS({ ...DEFAULTS, lang })
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, lang }))
        setResetToast(true)
        setTimeout(() => setResetToast(false), 2500)
    }, [s.lang])

    const themeStyle = THEMES[s.theme]
    const fontFamily = (FONTS[s.font] || FONTS.system).family
    const bgColor = s.bgColor || themeStyle.bg
    const textColor = s.textColor || themeStyle.text
    const showTitleBar = s.showTitleBar !== false

    useEffect(() => {
        setAppThemeVars(bgColor, textColor)
    }, [bgColor, textColor])

    useEffect(() => {
        emitTitleBarVisibility(showTitleBar)
    }, [showTitleBar])

    // Bound translator for current language
    const tt = createT(s.lang)

    const contentStyle = {
        color: textColor,
        fontFamily,
        fontWeight: s.fontWeight,
        fontSize: `${s.fontSize}px`,
        lineHeight: `${s.lineHeight}`,
        letterSpacing: `${s.letterSpacing}em`,
        transition: 'background-color 0.3s, color 0.3s',
    }

    return {
        theme: s.theme, setTheme: v => set('theme', v),
        font: s.font, setFont: v => set('font', v),
        fontWeight: s.fontWeight, setFontWeight: v => {
            const n = Number(v)
            if (!Number.isFinite(n)) return
            set('fontWeight', Math.max(100, Math.min(900, n)))
        },
        fontSize: s.fontSize, setFontSize: v => set('fontSize', v), incFont, decFont,
        layout: s.layout, setLayout: v => set('layout', v),
        lineHeight: s.lineHeight, setLineHeight: v => set('lineHeight', v),
        letterSpacing: s.letterSpacing, setLetterSpacing: v => set('letterSpacing', v),
        hMargin: s.hMargin, setHMargin: v => set('hMargin', v),
        vMargin: s.vMargin, setVMargin: v => set('vMargin', v),
        columnGap: s.columnGap, setColumnGap: v => set('columnGap', v),
        bgColor, setBgColor: v => set('bgColor', v),
        textColor, setTextColor: v => set('textColor', v),
        showTitleBar, setShowTitleBar: v => set('showTitleBar', !!v),
        toggleTitleBar: () => set('showTitleBar', !showTitleBar),
        lang: s.lang, setLang: v => set('lang', v),
        // actions
        resetDefaults, resetToast,
        settingsOpen, toggleSettings,
        // derived
        themeStyle, fontFamily, contentStyle,
        THEMES, FONTS,
        tt, // translator function
    }
}
