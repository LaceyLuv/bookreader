import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { createT } from '../i18n'
import { withThemeVars } from '../constants/themes'
import {
    emitTitleBarVisibility,
    isSafeModeEnabled,
    SAFE_APP_BG,
    SAFE_APP_FG,
    setAppThemeVars,
} from '../lib/appChrome'

const THEMES = {
    dark: withThemeVars({ name: 'dark', bg: '#1a1b1e', text: '#d1d5db', card: '#25262b', border: '#373a40', accent: '#5c7cfa' }),
    sepia: withThemeVars({ name: 'sepia', bg: '#f4ecd8', text: '#5c4b37', card: '#ede0c8', border: '#d4c4a8', accent: '#7c5cfa' }),
    light: withThemeVars({ name: 'light', bg: '#ffffff', text: '#1f2937', card: '#f9fafb', border: '#e5e7eb', accent: '#4f46e5' }),
}

const FONTS = {
    system: { name: 'system', family: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
    ridiBatang: { name: 'ridiBatang', family: "'RIDIBatang', 'RidiBatang', 'Noto Serif KR', 'Nanum Myeongjo', serif" },
    notoSansKr: { name: 'notoSansKr', family: "\"Noto Sans KR\", system-ui, -apple-system, \"Segoe UI\", Roboto, \"Malgun Gothic\", sans-serif" },
    noto: { name: 'noto', family: "\"Noto Sans KR\", system-ui, -apple-system, \"Segoe UI\", Roboto, \"Malgun Gothic\", sans-serif" },
    serif: { name: 'serif', family: "'Merriweather', 'Georgia', 'Times New Roman', serif" },
    mono: { name: 'mono', family: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace" },
}

const STORAGE_KEY = 'bookreader_settings'

function persistSettings(value) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
        // Ignore storage failures and keep in-memory settings working.
    }
}

const DEFAULTS = {
    theme: 'dark',
    font: 'system',
    fontMode: 'user',
    fontFamily: '',
    fontWeight: 400,
    fontSize: 18,
    layout: 'dual',
    lineHeight: 1.8,
    letterSpacing: -0.01,
    hMargin: 48,
    vMargin: 32,
    columnGap: 64,
    zipImageScale: 1,
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
            merged.fontMode = merged.fontMode === 'embedded' ? 'embedded' : 'user'
            merged.fontFamily = typeof merged.fontFamily === 'string' ? merged.fontFamily : ''
            const parsedWeight = Number(merged.fontWeight)
            merged.fontWeight = Number.isFinite(parsedWeight)
                ? Math.max(100, Math.min(900, parsedWeight))
                : DEFAULTS.fontWeight
            const parsedZipScale = Number(merged.zipImageScale)
            merged.zipImageScale = Number.isFinite(parsedZipScale)
                ? Math.max(0.5, Math.min(2.5, parsedZipScale))
                : DEFAULTS.zipImageScale
            merged.layout = merged.layout === 'dual' || merged.layout === 'spread' ? 'dual' : 'single'
            if (safeMode) {
                return { ...merged, theme: 'light', bgColor: SAFE_APP_BG, textColor: SAFE_APP_FG }
            }
            return merged
        }
    } catch { /* ignore */ }
    if (safeMode) {
        return { ...DEFAULTS, theme: 'light', bgColor: SAFE_APP_BG, textColor: SAFE_APP_FG }
    }
    return { ...DEFAULTS }
}

export function useReaderSettings() {
    const [s, setS] = useState(loadSaved)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [resetToast, setResetToast] = useState(false)
    const latestSettingsRef = useRef(s)

    useEffect(() => {
        latestSettingsRef.current = s
    }, [s])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            persistSettings(latestSettingsRef.current)
        }, 120)
        return () => window.clearTimeout(timer)
    }, [s])

    useEffect(() => {
        const flush = () => persistSettings(latestSettingsRef.current)
        window.addEventListener('pagehide', flush)
        return () => {
            window.removeEventListener('pagehide', flush)
            flush()
        }
    }, [])

    const set = useCallback((key, val) => setS(prev => ({ ...prev, [key]: val })), [])

    const incFont = useCallback(() => set('fontSize', Math.min(36, s.fontSize + 2)), [s.fontSize])
    const decFont = useCallback(() => set('fontSize', Math.max(10, s.fontSize - 2)), [s.fontSize])

    const toggleSettings = useCallback(() => setSettingsOpen(o => !o), [])

    const resetDefaults = useCallback(() => {
        const lang = s.lang
        const next = { ...DEFAULTS, lang }
        setS(next)
        persistSettings(next)
        setResetToast(true)
        setTimeout(() => setResetToast(false), 2500)
    }, [s.lang])

    const baseThemeStyle = THEMES[s.theme] || THEMES.dark
    const fallbackFontFamily = (FONTS[s.font] || FONTS.system).family
    const fontFamily = s.fontFamily || fallbackFontFamily
    const bgColor = s.bgColor || baseThemeStyle.bg
    const textColor = s.textColor || baseThemeStyle.text
    const themeStyle = useMemo(
        () => withThemeVars({
            name: baseThemeStyle.name,
            bg: bgColor,
            fg: textColor,
            text: textColor,
            accent: baseThemeStyle.accent,
        }),
        [baseThemeStyle.accent, baseThemeStyle.name, bgColor, textColor],
    )
    const showTitleBar = s.showTitleBar !== false

    useEffect(() => {
        setAppThemeVars(themeStyle)
    }, [themeStyle])

    useEffect(() => {
        emitTitleBarVisibility(showTitleBar)
    }, [showTitleBar])

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
        fontMode: s.fontMode, setFontMode: v => set('fontMode', v === 'embedded' ? 'embedded' : 'user'),
        fontFamily: s.fontFamily, setFontFamily: v => set('fontFamily', typeof v === 'string' ? v : ''),
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
        zipImageScale: s.zipImageScale, setZipImageScale: v => {
            const n = Number(v)
            if (!Number.isFinite(n)) return
            set('zipImageScale', Math.max(0.5, Math.min(2.5, n)))
        },
        bgColor, setBgColor: v => set('bgColor', v),
        textColor, setTextColor: v => set('textColor', v),
        showTitleBar, setShowTitleBar: v => set('showTitleBar', !!v),
        toggleTitleBar: () => set('showTitleBar', !showTitleBar),
        lang: s.lang, setLang: v => set('lang', v),
        resetDefaults, resetToast,
        settingsOpen, toggleSettings,
        themeStyle, fontFamily, contentStyle,
        THEMES, FONTS,
        tt,
    }
}
