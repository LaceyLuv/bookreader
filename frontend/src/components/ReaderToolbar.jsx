import { useEffect, useRef, useState } from 'react'
import ResumeToast from './ResumeToast'
import { THEME_PRESETS } from '../constants/themes'
import { API_FONTS_BASE } from '../lib/apiBase'
import { emitUserFontsUpdated } from './FontStyleInjector'
import { readErrorDetail } from '../lib/readErrorDetail'

export default function ReaderToolbar({ settings, readerType = '' }) {
    const {
        theme,
        font,
        setFont,
        fontMode,
        setFontMode,
        fontFamily,
        setFontFamily,
        fontWeight,
        setFontWeight,
        fontSize,
        incFont,
        decFont,
        layout,
        setLayout,
        lineHeight,
        setLineHeight,
        letterSpacing,
        setLetterSpacing,
        hMargin,
        setHMargin,
        vMargin,
        setVMargin,
        columnGap,
        setColumnGap,
        zipImageScale,
        setZipImageScale,
        bgColor,
        setBgColor,
        textColor,
        setTextColor,
        showTitleBar,
        toggleTitleBar,
        lang,
        setLang,
        resetDefaults,
        resetToast,
        settingsOpen,
        toggleSettings,
        THEMES,
        FONTS,
        tt,
    } = settings

    const t = THEMES[theme] || THEMES.dark
    const SETTINGS_BG = 'rgb(250, 250, 250)'
    const SETTINGS_TEXT = 'rgb(51, 51, 51)'
    const SETTINGS_BORDER = 'rgba(51, 51, 51, 0.22)'
    const SETTINGS_INPUT_BG = 'rgba(255, 255, 255, 0.92)'
    const SETTINGS_FONT_FAMILY = "'RIDIBatang', 'RidiBatang', 'Noto Serif KR', 'Noto Sans KR', 'Malgun Gothic', serif"
    const [themeToast, setThemeToast] = useState(null)
    const [userFonts, setUserFonts] = useState([])
    const [fontsLoading, setFontsLoading] = useState(false)
    const [fontError, setFontError] = useState('')
    const fileInputRef = useRef(null)

    const rgbToHex = (value) => {
        if (!value) return '#000000'
        if (value.startsWith('#')) return value.toLowerCase()
        const m = value.match(/rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/i)
        if (!m) return '#000000'
        const toHex = (n) => Number(n).toString(16).padStart(2, '0')
        return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`.toLowerCase()
    }

    const matchedPreset = (() => {
        const bg = rgbToHex(bgColor)
        const fg = rgbToHex(textColor)
        return THEME_PRESETS.find((p) => rgbToHex(p.bg) === bg && rgbToHex(p.fg) === fg) || null
    })()

    const applyPreset = (preset) => {
        setBgColor(preset.bg)
        setTextColor(preset.fg)
        setThemeToast(`${preset.name} ${tt('themeApplied')}`)
        setTimeout(() => setThemeToast(null), 1800)
    }

    const fetchUserFonts = async () => {
        setFontsLoading(true)
        setFontError('')
        try {
            const res = await fetch(API_FONTS_BASE)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const list = Array.isArray(data) ? data : (Array.isArray(data?.fonts) ? data.fonts : [])
            setUserFonts(list)
        } catch {
            setFontError(tt('fontLoadFailed'))
        }
        setFontsLoading(false)
    }

    useEffect(() => {
        fetchUserFonts()
    }, [])

    useEffect(() => {
        if (settingsOpen) fetchUserFonts()
    }, [settingsOpen])

    const handleUploadFont = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        setFontError('')
        try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch(API_FONTS_BASE, { method: 'POST', body: formData })
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('fontUploadFailed')))
            const saved = await res.json()
            const family = `UserFont_${saved.id}`
            setFontFamily(family)
            setFontMode('user')
            await fetchUserFonts()
            emitUserFontsUpdated()
            setThemeToast(tt('fontUploaded'))
            setTimeout(() => setThemeToast(null), 1800)
        } catch (err) {
            setFontError(err.message || tt('fontUploadFailed'))
        } finally {
            e.target.value = ''
        }
    }

    const Slider = ({ label, value, min, max, step, unit, onChange }) => (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">{label}</span>
                <span className="tabular-nums text-[11px] opacity-60">{value}{unit}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="h-1 w-full cursor-pointer rounded-full"
                style={{
                    background: `linear-gradient(90deg, var(--accent) 0%, ${SETTINGS_BORDER} 100%)`,
                    accentColor: 'var(--accent)',
                }}
            />
        </div>
    )

    const handleReset = () => {
        if (window.confirm(tt('resetConfirm'))) {
            resetDefaults()
        }
    }

    const BUILTIN_FONT_OPTIONS = [
        { key: 'ridiBatang', label: 'RIDIBatang' },
        { key: 'notoSansKr', label: 'Noto Sans KR' },
        { key: 'system', label: tt('systemFont') },
    ]
    const selectedBuiltinFontKey = font === 'noto' ? 'notoSansKr' : (FONTS?.[font] ? font : 'system')
    const builtinFontKeyFromFamily = fontFamily
        ? (BUILTIN_FONT_OPTIONS.find((item) => FONTS?.[item.key]?.family === fontFamily)?.key || null)
        : null
    const effectiveBuiltinFontKey = builtinFontKeyFromFamily || selectedBuiltinFontKey
    const selectedBuiltinFontFamily = FONTS?.[effectiveBuiltinFontKey]?.family || FONTS?.system?.family || 'system-ui'
    const selectedFontPreviewFamily = fontFamily || selectedBuiltinFontFamily
    const selectedFontValue = (fontFamily && !builtinFontKeyFromFamily) ? fontFamily : `__builtin:${effectiveBuiltinFontKey}`
    const isBuiltinFontFamily = !!fontFamily && Object.values(FONTS || {}).some((f) => f?.family === fontFamily)
    const isBuiltinSelectedValue = selectedFontValue.startsWith('__builtin:')
    const hasDetachedFontValue = !isBuiltinSelectedValue && !userFonts.some((f) => `UserFont_${f.id}` === selectedFontValue) && !isBuiltinFontFamily

    const handleFontSelectChange = (nextValue) => {
        if (!nextValue) return
        if (nextValue.startsWith('__builtin:')) {
            const fontKey = nextValue.slice('__builtin:'.length)
            setFont(FONTS[fontKey] ? fontKey : 'system')
            setFontFamily('')
            setFontMode('user')
            return
        }
        setFont('system')
        setFontFamily(nextValue)
        setFontMode('user')
    }

    return (
        <div className="relative">
            <button
                onClick={toggleSettings}
                title={tt('settings')}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:opacity-60"
                style={{ color: t.text }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>

            {settingsOpen && (
                <>
                    <div className="fixed inset-0 z-30" onClick={toggleSettings} />

                    <div
                        className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border shadow-2xl"
                        style={{
                            '--settings-bg': SETTINGS_BG,
                            '--settings-fg': SETTINGS_TEXT,
                            '--settings-border': SETTINGS_BORDER,
                            '--settings-input-bg': SETTINGS_INPUT_BG,
                            backgroundColor: 'var(--settings-bg)',
                            borderColor: 'var(--settings-border)',
                            color: 'var(--settings-fg)',
                            fontFamily: SETTINGS_FONT_FAMILY,
                        }}
                    >
                        <div
                            className="max-h-[70vh] space-y-5 overflow-y-auto p-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5"
                            style={{ scrollbarColor: 'var(--settings-border) transparent' }}
                        >
                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('language')}</span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setLang('en')}
                                        className={`flex-1 rounded-lg border-2 py-2 text-[11px] font-semibold transition-all ${lang === 'en' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: lang === 'en' ? 'var(--accent)' : 'var(--settings-border)' }}
                                    >
                                        {tt('langEnglish')}
                                    </button>
                                    <button
                                        onClick={() => setLang('ko')}
                                        className={`flex-1 rounded-lg border-2 py-2 text-[11px] font-semibold transition-all ${lang === 'ko' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: lang === 'ko' ? 'var(--accent)' : 'var(--settings-border)' }}
                                    >
                                        {tt('langKorean')}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('font')}</span>
                                <select
                                    value={selectedFontValue}
                                    onChange={(e) => handleFontSelectChange(e.target.value)}
                                    className="w-full rounded-lg border px-3 py-2 text-[12px]"
                                    style={{
                                        borderColor: 'var(--settings-border)',
                                        backgroundColor: 'var(--settings-input-bg)',
                                        color: 'var(--settings-fg)',
                                        fontFamily: selectedFontPreviewFamily,
                                    }}
                                >
                                    {BUILTIN_FONT_OPTIONS.map((item) => (
                                        <option key={item.key} value={`__builtin:${item.key}`}>
                                            {item.label}
                                        </option>
                                    ))}
                                    {userFonts.map((fontItem) => (
                                        <option key={fontItem.id} value={`UserFont_${fontItem.id}`}>
                                            {fontItem.filename}
                                        </option>
                                    ))}
                                    {hasDetachedFontValue && <option value={selectedFontValue}>{tt('customSelectedFont')}</option>}
                                </select>

                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="rounded-lg border px-2 py-1 text-[11px] font-semibold transition-all hover:opacity-80"
                                        style={{ borderColor: 'var(--settings-border)' }}
                                    >
                                        {tt('addFont')}
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".ttf,.otf,.woff,.woff2"
                                        className="hidden"
                                        onChange={handleUploadFont}
                                    />
                                    <span className="text-[10px] opacity-60">
                                        {fontsLoading ? tt('loadingFonts') : `${userFonts.length} ${tt('uploadedCountSuffix')}`}
                                    </span>
                                </div>

                                <label className="mt-3 flex items-center justify-between rounded-lg border px-2 py-2 text-[11px]" style={{ borderColor: 'var(--settings-border)' }}>
                                    <span>{tt('useEpubEmbeddedFonts')}</span>
                                    <input
                                        type="checkbox"
                                        checked={fontMode === 'embedded'}
                                        onChange={(e) => setFontMode(e.target.checked ? 'embedded' : 'user')}
                                        className="h-4 w-4"
                                        style={{ accentColor: 'var(--accent)' }}
                                    />
                                </label>
                                <p className="mt-1 text-[10px] opacity-60">{tt('embeddedFontsHint')}</p>
                                {fontError && <p className="mt-1 text-[10px] text-red-400">{fontError}</p>}
                            </div>

                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('weight')}</span>
                                <div className="mb-3 grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setFontWeight(400)}
                                        className="rounded-lg border-2 py-2 text-[11px] font-semibold transition-all"
                                        style={{ borderColor: fontWeight === 400 ? 'var(--accent)' : 'var(--settings-border)' }}
                                    >
                                        {tt('regularWeight')}
                                    </button>
                                    <button
                                        onClick={() => setFontWeight(700)}
                                        className="rounded-lg border-2 py-2 text-[11px] font-semibold transition-all"
                                        style={{ borderColor: fontWeight === 700 ? 'var(--accent)' : 'var(--settings-border)' }}
                                    >
                                        {tt('boldWeight')}
                                    </button>
                                </div>
                                <span className="mb-1 block text-[10px] uppercase tracking-widest opacity-50">{tt('custom')}</span>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="range"
                                        min={100}
                                        max={900}
                                        step={50}
                                        value={fontWeight}
                                        onChange={e => setFontWeight(parseInt(e.target.value, 10))}
                                        className="h-1 flex-1 cursor-pointer rounded-full"
                                        style={{
                                            background: `linear-gradient(90deg, var(--accent) 0%, ${SETTINGS_BORDER} 100%)`,
                                            accentColor: 'var(--accent)',
                                        }}
                                    />
                                    <input
                                        type="number"
                                        min={100}
                                        max={900}
                                        step={50}
                                        value={fontWeight}
                                        onChange={e => setFontWeight(parseInt(e.target.value, 10))}
                                        className="w-20 rounded border px-2 py-1 text-[11px]"
                                        style={{
                                            borderColor: 'var(--settings-border)',
                                            backgroundColor: 'var(--settings-input-bg)',
                                            color: 'var(--settings-fg)',
                                        }}
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="mb-2">
                                    <span className="block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('colors')}</span>
                                    <div className="mt-1.5 flex justify-center">
                                        <span className="inline-flex min-w-[11rem] items-center justify-center rounded-full border px-3 py-0.5 text-center text-[10px]" style={{ borderColor: 'var(--settings-border)' }}>
                                            {matchedPreset ? `${tt('preset')}: ${matchedPreset.name}` : tt('custom')}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="text-[10px] uppercase tracking-widest opacity-60">
                                        {tt('bg')}
                                        <input
                                            type="color"
                                            value={rgbToHex(bgColor)}
                                            onChange={e => setBgColor(e.target.value)}
                                            className="mt-1 h-8 w-full cursor-pointer rounded border bg-transparent p-0"
                                            style={{ borderColor: 'var(--settings-border)' }}
                                        />
                                    </label>
                                    <label className="text-[10px] uppercase tracking-widest opacity-60">
                                        {tt('text')}
                                        <input
                                            type="color"
                                            value={rgbToHex(textColor)}
                                            onChange={e => setTextColor(e.target.value)}
                                            className="mt-1 h-8 w-full cursor-pointer rounded border bg-transparent p-0"
                                            style={{ borderColor: 'var(--settings-border)' }}
                                        />
                                    </label>
                                </div>
                            </div>

                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('themePresets')}</span>
                                <div className="space-y-2">
                                    {THEME_PRESETS.map((preset) => {
                                        const selected = matchedPreset?.key === preset.key
                                        return (
                                            <button
                                                key={preset.key}
                                                onClick={() => applyPreset(preset)}
                                                title={preset.note}
                                                className="w-full rounded-lg border px-3 py-2 text-left transition-all hover:opacity-90"
                                                style={{ borderColor: selected ? 'var(--accent)' : 'var(--settings-border)' }}
                                            >
                                                <div className="flex items-center justify-center gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="h-4 w-4 rounded border" style={{ backgroundColor: preset.bg, borderColor: 'var(--settings-border)' }} />
                                                        <span className="h-4 w-4 rounded border" style={{ backgroundColor: preset.fg, borderColor: 'var(--settings-border)' }} />
                                                        <span className="text-[12px] font-semibold">{preset.name}</span>
                                                    </div>
                                                </div>
                                                {selected && <div className="mt-1 text-center text-[10px] font-semibold">{tt('selected')}</div>}
                                                <div className="mt-1 text-center text-[10px] opacity-55">{preset.note}</div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('size')}</span>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={decFont}
                                        className="flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-bold transition-all hover:opacity-80"
                                        style={{ borderColor: 'var(--settings-border)' }}
                                    >
                                        -
                                    </button>
                                    <span className="flex-1 text-center text-[12px] tabular-nums">{fontSize}px</span>
                                    <button
                                        onClick={incFont}
                                        className="flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-bold transition-all hover:opacity-80"
                                        style={{ borderColor: 'var(--settings-border)' }}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('layout')}</span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setLayout('single')}
                                        className={`flex-1 rounded-lg border-2 py-2 text-[11px] font-semibold transition-all ${layout === 'single' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: layout === 'single' ? 'var(--accent)' : 'var(--settings-border)' }}
                                    >
                                        {tt('single')}
                                    </button>
                                    <button
                                        onClick={() => setLayout('dual')}
                                        className={`flex-1 rounded-lg border-2 py-2 text-[11px] font-semibold transition-all ${layout === 'dual' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: layout === 'dual' ? 'var(--accent)' : 'var(--settings-border)' }}
                                    >
                                        {tt('dual')}
                                    </button>
                                </div>
                            </div>

                            {readerType === 'zip' && (
                                <div>
                                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">ZIP Image Scale</span>
                                    <Slider
                                        label="Zoom"
                                        value={Number((zipImageScale || 1).toFixed(1))}
                                        min={0.5}
                                        max={2.5}
                                        step={0.1}
                                        unit="x"
                                        onChange={setZipImageScale}
                                    />
                                </div>
                            )}

                            <div>
                                <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest opacity-50">{tt('titleBar')}</span>
                                <button
                                    onClick={toggleTitleBar}
                                    className="w-full rounded-lg border-2 py-2 text-[11px] font-semibold transition-all"
                                    style={{ borderColor: showTitleBar ? 'var(--accent)' : 'var(--settings-border)' }}
                                >
                                    {showTitleBar ? tt('hideTitleBar') : tt('showTitleBar')}
                                </button>
                                <p className="mt-2 text-[10px] opacity-60">ESC</p>
                            </div>

                            <div className="border-t pt-1" style={{ borderColor: 'var(--settings-border)' }}>
                                <span className="block text-[10px] font-bold uppercase tracking-widest opacity-30">{tt('typography')}</span>
                            </div>

                            <Slider label={tt('lineHeight')} value={lineHeight} min={1.0} max={2.5} step={0.1} unit="" onChange={setLineHeight} />
                            <Slider label={tt('letterSpacing')} value={letterSpacing} min={-0.05} max={0.2} step={0.01} unit="em" onChange={setLetterSpacing} />

                            <div className="border-t pt-1" style={{ borderColor: 'var(--settings-border)' }}>
                                <span className="block text-[10px] font-bold uppercase tracking-widest opacity-30">{tt('margins')}</span>
                            </div>

                            <Slider label={tt('hMargin')} value={hMargin} min={16} max={120} step={4} unit="px" onChange={setHMargin} />
                            <Slider label={tt('vMargin')} value={vMargin} min={8} max={80} step={4} unit="px" onChange={setVMargin} />
                            <Slider label={tt('splitMargin')} value={columnGap} min={16} max={120} step={4} unit="px" onChange={setColumnGap} />

                            <div className="border-t pt-2 opacity-30" style={{ borderColor: 'var(--settings-border)' }}>
                                <p className="text-[10px] leading-snug">{tt('keyboardHint')}</p>
                            </div>

                            <button
                                onClick={handleReset}
                                className="w-full rounded-lg border-2 py-2.5 text-[12px] font-semibold transition-all hover:border-red-400/50 hover:bg-red-500/10 active:scale-[0.98]"
                                style={{ borderColor: 'var(--settings-border)', color: 'var(--settings-fg)', backgroundColor: 'var(--settings-input-bg)' }}
                            >
                                {tt('resetDefaults')}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {resetToast && (
                <div
                    className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-5 py-3 shadow-2xl animate-[fadeInUp_0.3s_ease-out]"
                    style={{
                        backgroundColor: SETTINGS_BG,
                        borderColor: SETTINGS_BORDER,
                        color: SETTINGS_TEXT,
                    }}
                >
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <span className="text-green-400">OK</span>
                        {tt('resetDone')}
                    </div>
                </div>
            )}

            <ResumeToast
                resumePrompt={null}
                onResume={() => { }}
                onDismiss={() => setThemeToast(null)}
                tt={tt}
                message={themeToast}
            />
        </div>
    )
}
