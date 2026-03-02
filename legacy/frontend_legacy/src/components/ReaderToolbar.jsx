import { useState } from 'react'
import ResumeToast from './ResumeToast'
import { THEME_PRESETS } from '../constants/themes'

/**
 * ReaderToolbar settings panel with i18n, sliders, and reset button.
 */
export default function ReaderToolbar({ settings }) {
    const {
        theme, setTheme,
        font, setFont,
        fontWeight, setFontWeight,
        fontSize, incFont, decFont,
        layout, setLayout,
        lineHeight, setLineHeight,
        letterSpacing, setLetterSpacing,
        hMargin, setHMargin,
        vMargin, setVMargin,
        columnGap, setColumnGap,
        bgColor, setBgColor,
        textColor, setTextColor,
        showTitleBar, toggleTitleBar,
        lang, setLang,
        resetDefaults, resetToast,
        settingsOpen, toggleSettings,
        THEMES, FONTS,
        tt,
    } = settings

    const t = THEMES[theme]
    const [themeToast, setThemeToast] = useState(null)

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
        setThemeToast(`${preset.name} 테마 적용됨`)
        setTimeout(() => setThemeToast(null), 1800)
    }

    const Slider = ({ label, value, min, max, step, unit, onChange }) => (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">{label}</span>
                <span className="text-[11px] font-mono opacity-60 tabular-nums">{value}{unit}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value}
                onChange={e => onChange(parseFloat(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
                    [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-[#5c7cfa] [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/20
                    [&::-webkit-slider-thumb]:cursor-pointer"
                style={{ background: `linear-gradient(90deg, #5c7cfa 0%, ${t.border} 100%)` }}
            />
        </div>
    )

    const handleReset = () => {
        if (window.confirm(tt('resetConfirm'))) {
            resetDefaults()
        }
    }

    return (
        <div className="relative">
            <button onClick={toggleSettings} title={tt('settings')}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                style={{ color: t.text }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>

            {settingsOpen && (
                <>
                    <div className="fixed inset-0 z-30" onClick={toggleSettings} />

                    <div
                        className="absolute right-0 top-full mt-2 z-40 w-80 rounded-xl shadow-2xl border overflow-hidden"
                        style={{ backgroundColor: t.card, borderColor: t.border, color: t.text }}
                    >
                        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-5
                            [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent
                            [&::-webkit-scrollbar-thumb]:rounded-full"
                            style={{ scrollbarColor: `${t.border} transparent` }}>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">{tt('language')}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => setLang('en')}
                                        className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border-2 transition-all
                                            ${lang === 'en' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: lang === 'en' ? '#5c7cfa' : t.border }}>
                                        English
                                    </button>
                                    <button onClick={() => setLang('ko')}
                                        className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border-2 transition-all
                                            ${lang === 'ko' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: lang === 'ko' ? '#5c7cfa' : t.border }}>
                                        한국어
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">{tt('theme')}</span>
                                <div className="flex gap-2">
                                    {Object.entries(THEMES).map(([key, th]) => (
                                        <button key={key} onClick={() => setTheme(key)}
                                            className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border-2 transition-all
                                                ${theme === key ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                            style={{
                                                backgroundColor: th.bg, color: th.text,
                                                borderColor: theme === key ? '#5c7cfa' : th.border
                                            }}>
                                            {tt(key)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">{tt('font')}</span>
                                <select
                                    value={font}
                                    onChange={e => setFont(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg text-[12px] border"
                                    style={{ borderColor: t.border, backgroundColor: t.card, color: t.text }}
                                >
                                    {Object.entries(FONTS).map(([key]) => (
                                        <option key={key} value={key}>
                                            {key === 'system' ? 'System'
                                                : key === 'noto' ? 'Noto Sans KR(추천)'
                                                    : key === 'serif' ? 'Serif' : 'Mono'}
                                        </option>
                                    ))}
                                </select>
                                {font === 'system' && (
                                    <p className="mt-2 text-[10px] opacity-60">
                                        일부 시스템 글꼴은 400/700만 지원할 수 있음
                                    </p>
                                )}
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">Weight</span>
                                <div className="grid grid-cols-2 gap-2 mb-3">
                                    <button
                                        onClick={() => setFontWeight(400)}
                                        className="py-2 rounded-lg text-[11px] font-semibold border-2 transition-all"
                                        style={{ borderColor: fontWeight === 400 ? '#5c7cfa' : t.border }}
                                    >
                                        기본(400)
                                    </button>
                                    <button
                                        onClick={() => setFontWeight(700)}
                                        className="py-2 rounded-lg text-[11px] font-semibold border-2 transition-all"
                                        style={{ borderColor: fontWeight === 700 ? '#5c7cfa' : t.border }}
                                    >
                                        두껍게(700)
                                    </button>
                                </div>
                                <span className="text-[10px] uppercase tracking-widest opacity-50 mb-1 block">자율조절</span>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="range"
                                        min={100}
                                        max={900}
                                        step={50}
                                        value={fontWeight}
                                        onChange={e => setFontWeight(parseInt(e.target.value, 10))}
                                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer
                                            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
                                            [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
                                            [&::-webkit-slider-thumb]:bg-[#5c7cfa] [&::-webkit-slider-thumb]:cursor-pointer"
                                        style={{ background: `linear-gradient(90deg, #5c7cfa 0%, ${t.border} 100%)` }}
                                    />
                                    <input
                                        type="number"
                                        min={100}
                                        max={900}
                                        step={50}
                                        value={fontWeight}
                                        onChange={e => setFontWeight(parseInt(e.target.value, 10))}
                                        className="w-20 px-2 py-1 rounded border text-[11px] font-mono"
                                        style={{ borderColor: t.border, backgroundColor: t.card, color: t.text }}
                                    />
                                </div>
                                {import.meta.env.DEV && (
                                    <p className="mt-2 text-[10px] opacity-60 font-mono break-all">
                                        fontFamily: {settings.fontFamily} / fontWeight: {fontWeight}
                                    </p>
                                )}
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 block">Colors</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{ borderColor: t.border }}>
                                        {matchedPreset ? `프리셋: ${matchedPreset.name}` : '커스텀'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="text-[10px] uppercase tracking-widest opacity-60">
                                        BG
                                        <input
                                            type="color"
                                            value={rgbToHex(bgColor)}
                                            onChange={e => setBgColor(e.target.value)}
                                            className="mt-1 w-full h-8 rounded border p-0 bg-transparent cursor-pointer"
                                            style={{ borderColor: t.border }}
                                        />
                                    </label>
                                    <label className="text-[10px] uppercase tracking-widest opacity-60">
                                        Text
                                        <input
                                            type="color"
                                            value={rgbToHex(textColor)}
                                            onChange={e => setTextColor(e.target.value)}
                                            className="mt-1 w-full h-8 rounded border p-0 bg-transparent cursor-pointer"
                                            style={{ borderColor: t.border }}
                                        />
                                    </label>
                                </div>
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">Theme Presets</span>
                                <div className="space-y-2">
                                    {THEME_PRESETS.map((preset) => {
                                        const selected = matchedPreset?.key === preset.key
                                        return (
                                            <button
                                                key={preset.key}
                                                onClick={() => applyPreset(preset)}
                                                title={preset.note}
                                                className="w-full px-3 py-2 rounded-lg border text-left transition-all hover:opacity-90"
                                                style={{ borderColor: selected ? '#5c7cfa' : t.border }}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-4 h-4 rounded border" style={{ backgroundColor: preset.bg, borderColor: t.border }} />
                                                        <span className="w-4 h-4 rounded border" style={{ backgroundColor: preset.fg, borderColor: t.border }} />
                                                        <span className="text-[12px] font-semibold">{preset.name}</span>
                                                    </div>
                                                    {selected && <span className="text-[10px] font-semibold">선택됨</span>}
                                                </div>
                                                <div className="text-[10px] opacity-55 mt-1">{preset.note}</div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">{tt('size')}</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={decFont}
                                        className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold hover:opacity-80 transition-all"
                                        style={{ borderColor: t.border }}>-</button>
                                    <span className="flex-1 text-center text-[12px] font-mono tabular-nums">{fontSize}px</span>
                                    <button onClick={incFont}
                                        className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold hover:opacity-80 transition-all"
                                        style={{ borderColor: t.border }}>+</button>
                                </div>
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">{tt('layout')}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => setLayout('single')}
                                        className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border-2 transition-all
                                            ${layout === 'single' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: layout === 'single' ? '#5c7cfa' : t.border }}>
                                        {tt('single')}
                                    </button>
                                    <button onClick={() => setLayout('dual')}
                                        className={`flex-1 py-2 rounded-lg text-[11px] font-semibold border-2 transition-all
                                            ${layout === 'dual' ? 'scale-105 shadow-md' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ borderColor: layout === 'dual' ? '#5c7cfa' : t.border }}>
                                        {tt('dual')}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2 block">{tt('titleBar')}</span>
                                <button
                                    onClick={toggleTitleBar}
                                    className="w-full py-2 rounded-lg text-[11px] font-semibold border-2 transition-all"
                                    style={{ borderColor: showTitleBar ? '#5c7cfa' : t.border }}
                                >
                                    {showTitleBar ? tt('hideTitleBar') : tt('showTitleBar')}
                                </button>
                                <p className="mt-2 text-[10px] opacity-60">
                                    ESC
                                </p>
                            </div>

                            <div className="border-t pt-1" style={{ borderColor: t.border }}>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-30 block">{tt('typography')}</span>
                            </div>

                            <Slider label={tt('lineHeight')} value={lineHeight} min={1.0} max={2.5} step={0.1}
                                unit="" onChange={setLineHeight} />

                            <Slider label={tt('letterSpacing')} value={letterSpacing} min={-0.05} max={0.2} step={0.01}
                                unit="em" onChange={setLetterSpacing} />

                            <div className="border-t pt-1" style={{ borderColor: t.border }}>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-30 block">{tt('margins')}</span>
                            </div>

                            <Slider label={tt('hMargin')} value={hMargin} min={16} max={120} step={4}
                                unit="px" onChange={setHMargin} />

                            <Slider label={tt('vMargin')} value={vMargin} min={8} max={80} step={4}
                                unit="px" onChange={setVMargin} />

                            <Slider label={tt('splitMargin')} value={columnGap} min={16} max={120} step={4}
                                unit="px" onChange={setColumnGap} />

                            <div className="pt-2 border-t opacity-30" style={{ borderColor: t.border }}>
                                <p className="text-[10px] leading-snug">{tt('keyboardHint')}</p>
                            </div>

                            <button onClick={handleReset}
                                className="w-full py-2.5 rounded-lg text-[12px] font-semibold border-2 transition-all
                                    hover:bg-red-500/10 hover:border-red-400/50 active:scale-[0.98]"
                                style={{ borderColor: t.border, color: t.text }}>
                                {tt('resetDefaults')}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {resetToast && (
                <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl border
                    animate-[fadeInUp_0.3s_ease-out]"
                    style={{ backgroundColor: t.card, borderColor: t.border, color: t.text }}>
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                        <span className="text-green-400">?</span>
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


