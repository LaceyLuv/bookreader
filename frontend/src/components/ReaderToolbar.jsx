import { useEffect, useRef, useState } from 'react'
import ResumeToast from './ResumeToast'
import { THEME_PRESETS } from '../constants/themes'
import { API_FONTS_BASE } from '../lib/apiBase'
import { emitUserFontsUpdated } from './FontStyleInjector'
import { readErrorDetail } from '../lib/readErrorDetail'

export function ReaderSettingSlider({ label, value, min, max, step, unit = '', onChange }) {
    const percentage = ((Number(value) - min) / (max - min)) * 100

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold">{label}</span>
                <span className="rounded-md bg-[#f1eadf] px-2 py-0.5 text-[11px] tabular-nums text-[#766854]">{value}{unit}</span>
            </div>
            <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(parseFloat(event.target.value))}
                className="h-1 w-full cursor-pointer rounded-full"
                style={{
                    background: `linear-gradient(90deg, #b7864b 0%, #b7864b ${percentage}%, #ded4c5 ${percentage}%, #ded4c5 100%)`,
                    accentColor: '#b7864b',
                }}
            />
        </div>
    )
}

export default function ReaderToolbar({ settings, readerType = '', txtTransforms = null, txtEncoding = null }) {
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
    const SETTINGS_FONT_FAMILY = "'RIDIBatang', 'RidiBatang', 'Noto Serif KR', 'Noto Sans KR', 'Malgun Gothic', serif"
    const [themeToast, setThemeToast] = useState(null)
    const [userFonts, setUserFonts] = useState([])
    const [fontsLoading, setFontsLoading] = useState(false)
    const [fontError, setFontError] = useState('')
    const [activeTab, setActiveTab] = useState('basic')
    const fileInputRef = useRef(null)
    const panelRef = useRef(null)
    const triggerRef = useRef(null)
    const wasSettingsOpenRef = useRef(false)

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
    const getPresetName = (preset) => preset?.nameKey ? tt(preset.nameKey) : preset?.name
    const getPresetNote = (preset) => preset?.noteKey ? tt(preset.noteKey) : preset?.note

    const applyPreset = (preset) => {
        setBgColor(preset.bg)
        setTextColor(preset.fg)
        setThemeToast(`${getPresetName(preset)} ${tt('themeApplied')}`)
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

    useEffect(() => {
        if (!settingsOpen) {
            if (wasSettingsOpenRef.current) triggerRef.current?.focus()
            wasSettingsOpenRef.current = false
            return undefined
        }
        wasSettingsOpenRef.current = true
        panelRef.current?.focus()
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                toggleSettings()
                return
            }
            if (event.key !== 'Tab') return
            const focusable = [...(panelRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [settingsOpen, toggleSettings])

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
    const isTextReader = readerType !== 'zip'

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

    const handleTabKeyDown = (event, currentKey) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const keys = ['basic', 'advanced']
        const currentIndex = keys.indexOf(currentKey)
        const nextKey = event.key === 'Home'
            ? keys[0]
            : event.key === 'End'
                ? keys[keys.length - 1]
                : keys[(currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length]
        setActiveTab(nextKey)
        requestAnimationFrame(() => document.getElementById(`settings-tab-${nextKey}`)?.focus())
    }

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                onClick={toggleSettings}
                title={tt('settings')}
                className="reader-toolbar-button flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:opacity-60"
                style={{ color: t.text }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>

            {settingsOpen && (
                <div
                    className="fixed inset-0 z-40 bg-[#211c16]/35"
                    onMouseDown={(event) => event.target === event.currentTarget && toggleSettings()}
                >
                    <aside
                        ref={panelRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="reader-settings-title"
                        className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-[#faf7f1] text-[#3f392f] shadow-[-18px_0_55px_rgba(54,44,29,0.2)] outline-none"
                        style={{ fontFamily: SETTINGS_FONT_FAMILY }}
                    >
                        <header className="flex items-center justify-between border-b border-[#e5dccd] px-6 py-5">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a8b72]">BOOK READER</p>
                                <h2 id="reader-settings-title" className="mt-1 text-xl font-semibold">{tt('settings')}</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="rounded-full border border-[#ded4c5] px-2.5 py-1 text-[10px] font-semibold text-[#766854]">
                                    {lang === 'ko' ? tt('langKorean') : tt('langEnglish')}
                                </span>
                                <button
                                    type="button"
                                    onClick={toggleSettings}
                                    aria-label={tt('closeSettings')}
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#ded4c5] text-xl transition-colors hover:bg-[#f1eadf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b7864b]"
                                >
                                    ×
                                </button>
                            </div>
                        </header>

                        <div role="tablist" aria-label={tt('settingsSections')} className="mx-6 mt-4 grid grid-cols-2 rounded-xl border border-[#ded4c5] bg-[#f4eee5] p-1">
                            {[
                                ['basic', tt('settingsBasicTab')],
                                ['advanced', tt('settingsAdvancedTab')],
                            ].map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    role="tab"
                                    id={`settings-tab-${key}`}
                                    aria-selected={activeTab === key}
                                    aria-controls={`settings-panel-${key}`}
                                    tabIndex={activeTab === key ? 0 : -1}
                                    onClick={() => setActiveTab(key)}
                                    onKeyDown={(event) => handleTabKeyDown(event, key)}
                                    className={`rounded-lg py-2 text-[12px] font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b7864b] ${activeTab === key ? 'bg-white text-[#6e4d27] shadow-sm' : 'text-[#8a7c66] hover:text-[#3f392f]'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {activeTab === 'basic' && (
                            <div
                                data-testid="reader-settings-preview"
                                className="mx-6 mt-4 overflow-hidden rounded-2xl border border-[#d9cdbd] p-3 shadow-inner transition-colors"
                                style={{ backgroundColor: bgColor, color: textColor }}
                            >
                                <p className="mb-2 text-[8px] font-bold uppercase tracking-[0.18em] opacity-55">{tt('livePreview')}</p>
                                <div
                                    data-testid="reader-settings-preview-page"
                                    className={`grid min-h-16 ${layout === 'dual' ? 'grid-cols-2' : 'grid-cols-1'} overflow-hidden rounded-lg bg-white/20 shadow-sm`}
                                    style={{
                                        columnGap: `${Math.max(4, columnGap * 0.12)}px`,
                                        padding: `${Math.max(6, vMargin * 0.18)}px ${Math.max(8, hMargin * 0.16)}px`,
                                        fontFamily: selectedFontPreviewFamily,
                                        fontWeight,
                                        fontSize: `${Math.max(10, fontSize * 0.58)}px`,
                                        lineHeight,
                                        letterSpacing: `${letterSpacing}em`,
                                    }}
                                >
                                    <p className={layout === 'dual' ? 'border-r border-current/20 pr-2' : ''}>{tt('previewText')}</p>
                                    {layout === 'dual' && <p className="pl-2">{tt('previewTextAlt')}</p>}
                                </div>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto px-6 py-5 [scrollbar-color:#d8cdbd_transparent]">
                            {activeTab === 'basic' && (
                                <div id="settings-panel-basic" role="tabpanel" aria-labelledby="settings-tab-basic" className="space-y-5">
                                    <section>
                                        <div className="mb-3 flex items-center justify-between">
                                            <h3 className="text-[12px] font-semibold">{tt('themePresets')}</h3>
                                            <span className="text-[10px] text-[#8a7c66]">{getPresetName(matchedPreset) || tt('custom')}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            {THEME_PRESETS.map((preset) => {
                                                const selected = matchedPreset?.key === preset.key
                                                return (
                                                    <button key={preset.key} type="button" onClick={() => applyPreset(preset)} aria-pressed={selected} title={getPresetNote(preset)} className={`rounded-2xl border p-2.5 text-center ${selected ? 'border-[#b7864b] bg-[#f5eadc]' : 'border-[#ded4c5] bg-white/70'}`}>
                                                        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm" style={{ backgroundColor: preset.bg, borderColor: selected ? '#b7864b' : '#ded4c5' }}>
                                                            <i className="h-4 w-1 rounded-full" style={{ backgroundColor: preset.fg }} />
                                                        </span>
                                                        <span className="mt-2 block truncate text-[10px] font-semibold">{getPresetName(preset)}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </section>

                                    {isTextReader && (
                                        <section className="rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                            <label className="mb-2 block text-[12px] font-semibold" htmlFor="reader-font-select">{tt('font')}</label>
                                            <select
                                                id="reader-font-select"
                                                value={selectedFontValue}
                                                onChange={(event) => handleFontSelectChange(event.target.value)}
                                                className="w-full rounded-xl border border-[#ded4c5] bg-[#fffdf9] px-3 py-2.5 text-[12px] outline-none focus:border-[#b7864b]"
                                                style={{ fontFamily: selectedFontPreviewFamily }}
                                            >
                                                {BUILTIN_FONT_OPTIONS.map((item) => <option key={item.key} value={`__builtin:${item.key}`}>{item.label}</option>)}
                                                {userFonts.map((fontItem) => <option key={fontItem.id} value={`UserFont_${fontItem.id}`}>{fontItem.filename}</option>)}
                                                {hasDetachedFontValue && <option value={selectedFontValue}>{tt('customSelectedFont')}</option>}
                                            </select>

                                            {readerType === 'epub' && (
                                                <label className="mt-3 flex items-center justify-between rounded-xl border border-[#ded4c5] bg-[#fffdf9] px-3 py-2.5 text-[11px] font-semibold">
                                                    <span>{tt('useEpubEmbeddedFonts')}</span>
                                                    <input type="checkbox" checked={fontMode === 'embedded'} onChange={(event) => setFontMode(event.target.checked ? 'embedded' : 'user')} className="h-4 w-4 accent-[#b7864b]" />
                                                </label>
                                            )}

                                            <div className="mt-4 flex items-center justify-between">
                                                <span className="text-[12px] font-semibold">{tt('size')}</span>
                                                <div className="flex items-center overflow-hidden rounded-xl border border-[#ded4c5] bg-[#fffdf9]">
                                                    <button type="button" aria-label={tt('decreaseFontSize')} onClick={decFont} className="h-9 w-10 text-lg hover:bg-[#f1eadf]">−</button>
                                                    <span className="min-w-16 border-x border-[#ded4c5] px-3 text-center text-[12px] tabular-nums">{fontSize} px</span>
                                                    <button type="button" aria-label={tt('increaseFontSize')} onClick={incFont} className="h-9 w-10 text-lg hover:bg-[#f1eadf]">+</button>
                                                </div>
                                            </div>

                                            <div className="mt-4">
                                                <span className="mb-2 block text-[12px] font-semibold">{tt('weight')}</span>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {[400, 700].map((value) => (
                                                        <button key={value} type="button" onClick={() => setFontWeight(value)} aria-pressed={fontWeight === value} className={`rounded-xl border py-2 text-[11px] font-semibold ${fontWeight === value ? 'border-[#b7864b] bg-[#f5eadc] text-[#765022]' : 'border-[#ded4c5] bg-[#fffdf9]'}`}>
                                                            {value === 400 ? tt('regularWeight') : tt('boldWeight')}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="mt-5">
                                                <ReaderSettingSlider label={tt('lineHeight')} value={lineHeight} min={1} max={2.5} step={0.1} onChange={setLineHeight} />
                                            </div>
                                        </section>
                                    )}

                                    <section>
                                        <h3 className="mb-2 text-[12px] font-semibold">{tt('layout')}</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                ['single', tt('single'), false],
                                                ['dual', tt('dual'), true],
                                            ].map(([value, label, dual]) => (
                                                <button key={value} type="button" onClick={() => setLayout(value)} aria-pressed={layout === value} className={`flex items-center justify-center gap-3 rounded-2xl border p-3 text-[12px] font-semibold ${layout === value ? 'border-[#b7864b] bg-[#f5eadc] text-[#765022]' : 'border-[#ded4c5] bg-white/70'}`}>
                                                    <span className={`grid h-8 w-9 ${dual ? 'grid-cols-2' : 'grid-cols-1'} gap-px rounded border border-[#cbbda9] bg-white p-1`}>
                                                        <i className="bg-[#e6dccd]" />{dual && <i className="bg-[#e6dccd]" />}
                                                    </span>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </section>

                                    {readerType === 'zip' && (
                                        <section className="rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                            <ReaderSettingSlider label={tt('zipImageScale')} value={Number((zipImageScale || 1).toFixed(1))} min={0.5} max={2.5} step={0.1} unit="x" onChange={setZipImageScale} />
                                        </section>
                                    )}
                                </div>
                            )}

                            {activeTab === 'advanced' && (
                                <div id="settings-panel-advanced" role="tabpanel" aria-labelledby="settings-tab-advanced" className="space-y-5">
                                    <section className="rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                        <h3 className="mb-3 text-[12px] font-semibold">{tt('colors')}</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[[tt('bg'), bgColor, setBgColor], [tt('text'), textColor, setTextColor]].map(([label, value, setter]) => (
                                                <label key={label} className="flex items-center justify-between rounded-xl border border-[#ded4c5] bg-[#fffdf9] px-3 py-2 text-[11px] font-semibold">
                                                    {label}
                                                    <input aria-label={label} type="color" value={rgbToHex(value)} onChange={(event) => setter(event.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
                                                </label>
                                            ))}
                                        </div>
                                    </section>

                                    <section>
                                        <h3 className="mb-2 text-[12px] font-semibold">{tt('language')}</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[['en', tt('langEnglish')], ['ko', tt('langKorean')]].map(([value, label]) => (
                                                <button key={value} type="button" onClick={() => setLang(value)} aria-pressed={lang === value} className={`rounded-xl border py-2.5 text-[11px] font-semibold ${lang === value ? 'border-[#b7864b] bg-[#f5eadc] text-[#765022]' : 'border-[#ded4c5] bg-white/70'}`}>{label}</button>
                                            ))}
                                        </div>
                                    </section>

                                    {isTextReader ? (
                                        <>
                                            <section className="space-y-5 rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                                <div>
                                                    <div className="mb-2 flex items-center justify-between">
                                                        <span className="text-[12px] font-semibold">{tt('fontWeightDetail')}</span>
                                                        <input
                                                            aria-label={tt('fontWeightValue')}
                                                            type="number"
                                                            min={100}
                                                            max={900}
                                                            step={50}
                                                            value={fontWeight}
                                                            onChange={(event) => setFontWeight(parseInt(event.target.value, 10))}
                                                            className="w-20 rounded-lg border border-[#ded4c5] bg-[#fffdf9] px-2 py-1.5 text-center text-[11px] tabular-nums outline-none focus:border-[#b7864b]"
                                                        />
                                                    </div>
                                                    <input
                                                        aria-label={tt('fontWeightDetail')}
                                                        type="range"
                                                        min={100}
                                                        max={900}
                                                        step={50}
                                                        value={fontWeight}
                                                        onChange={(event) => setFontWeight(parseInt(event.target.value, 10))}
                                                        className="h-1 w-full cursor-pointer accent-[#b7864b]"
                                                    />
                                                </div>
                                                <ReaderSettingSlider label={tt('letterSpacing')} value={letterSpacing} min={-0.05} max={0.2} step={0.01} unit=" em" onChange={setLetterSpacing} />
                                                <ReaderSettingSlider label={tt('hMargin')} value={hMargin} min={16} max={120} step={4} unit=" px" onChange={setHMargin} />
                                                <ReaderSettingSlider label={tt('vMargin')} value={vMargin} min={8} max={80} step={4} unit=" px" onChange={setVMargin} />
                                                <ReaderSettingSlider label={tt('splitMargin')} value={columnGap} min={16} max={120} step={4} unit=" px" onChange={setColumnGap} />
                                            </section>

                                            <section className="rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                                <div className="flex items-center justify-between">
                                                    <div><h3 className="text-[12px] font-semibold">{tt('fontManagement')}</h3><p className="mt-1 text-[10px] text-[#8a7c66]">{fontsLoading ? tt('loadingFonts') : `${userFonts.length} ${tt('uploadedCountSuffix')}`}</p></div>
                                                    <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-xl border border-[#b7864b] bg-[#f5eadc] px-3 py-2 text-[11px] font-semibold text-[#765022]">{tt('addFont')}</button>
                                                    <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleUploadFont} />
                                                </div>
                                                {fontError && <p role="alert" className="mt-2 text-[10px] text-red-600">{fontError}</p>}
                                            </section>
                                        </>
                                    ) : (
                                        <section className="space-y-5 rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                            <ReaderSettingSlider label={tt('hMargin')} value={hMargin} min={16} max={120} step={4} unit=" px" onChange={setHMargin} />
                                            <ReaderSettingSlider label={tt('vMargin')} value={vMargin} min={8} max={80} step={4} unit=" px" onChange={setVMargin} />
                                        </section>
                                    )}

                                    {readerType === 'epub' && (
                                        <section className="rounded-2xl border border-dashed border-[#d7cbbb] bg-[#f4eee5] px-4 py-3">
                                            <h3 className="text-[12px] font-semibold">{tt('useEpubEmbeddedFonts')}</h3>
                                            <p className="mt-1 text-[10px] leading-relaxed text-[#766854]">{tt('embeddedFontsHint')}</p>
                                        </section>
                                    )}

                                    {readerType === 'txt' && (txtTransforms || txtEncoding) && (
                                        <section className="rounded-2xl border border-[#e2d9cb] bg-white/70 p-4">
                                            <h3 className="mb-3 text-[12px] font-semibold">TXT</h3>
                                            <div className="space-y-3">
                                                {txtTransforms && [
                                                    [tt('trimSpaces'), txtTransforms.trimSpaces, txtTransforms.onTrimSpacesChange],
                                                    [tt('splitParagraphs'), txtTransforms.splitParagraphs, txtTransforms.onSplitParagraphsChange],
                                                ].map(([label, checked, setter]) => (
                                                    <label key={label} className="flex items-center justify-between text-[11px]"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} className="h-4 w-4 accent-[#b7864b]" /></label>
                                                ))}
                                                {txtEncoding && (
                                                    <div className="border-t border-[#e2d9cb] pt-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span>
                                                                <b className="block text-[11px] font-semibold">{tt('currentEncoding')}</b>
                                                                <small className="mt-0.5 block text-[10px] font-normal text-[#8a7c66]">
                                                                    {txtEncoding.encoding || tt('unknown')} · {txtEncoding.source === 'override' ? tt('manualEncoding') : tt('automaticEncoding')}
                                                                </small>
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    toggleSettings()
                                                                    txtEncoding.onOpen?.()
                                                                }}
                                                                className="shrink-0 rounded-xl border border-[#b7864b] bg-[#f5eadc] px-3 py-2 text-[10px] font-semibold text-[#765022]"
                                                            >
                                                                {tt('changeEncoding')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    )}

                                    <div className="rounded-2xl border border-dashed border-[#d7cbbb] bg-[#f4eee5] px-4 py-3 text-[10px] leading-relaxed text-[#766854]">
                                        {tt('keyboardHint')}
                                    </div>
                                </div>
                            )}
                        </div>

                        <footer className="grid grid-cols-[1fr_1.25fr] gap-3 border-t border-[#e5dccd] bg-[#faf7f1] px-6 py-4">
                            <button type="button" onClick={handleReset} className="rounded-xl px-3 py-3 text-[11px] font-semibold text-[#9a6c36] transition-colors hover:bg-[#f1eadf]">{tt('resetDefaults')}</button>
                            <button type="button" onClick={toggleSettings} className="rounded-xl bg-[#b7864b] px-3 py-3 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-[#a4763f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5d2b]">{tt('done')}</button>
                        </footer>
                    </aside>
                </div>
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
