export const DEFAULT_THEME_BG = '#1a1b1e'
export const DEFAULT_THEME_FG = '#d1d5db'
export const DEFAULT_THEME_ACCENT = '#5c7cfa'

function clampChannel(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(255, Math.round(n)))
}

function parseColor(value) {
    if (!value || typeof value !== 'string') return null
    const raw = value.trim()
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
        const v = hex[1]
        if (v.length === 3) {
            return [
                parseInt(v[0] + v[0], 16),
                parseInt(v[1] + v[1], 16),
                parseInt(v[2] + v[2], 16),
            ]
        }
        return [
            parseInt(v.slice(0, 2), 16),
            parseInt(v.slice(2, 4), 16),
            parseInt(v.slice(4, 6), 16),
        ]
    }

    const rgb = raw.match(/^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$/i)
    if (rgb) {
        return [clampChannel(rgb[1]), clampChannel(rgb[2]), clampChannel(rgb[3])]
    }
    return null
}

function toRgbString(rgb, fallback) {
    if (!Array.isArray(rgb) || rgb.length !== 3) return fallback
    return `rgb(${clampChannel(rgb[0])},${clampChannel(rgb[1])},${clampChannel(rgb[2])})`
}

function mixColors(from, to, ratio) {
    const a = parseColor(from)
    const b = parseColor(to)
    if (!a || !b) return from
    const r = Math.max(0, Math.min(1, Number(ratio) || 0))
    return toRgbString(
        [
            a[0] + (b[0] - a[0]) * r,
            a[1] + (b[1] - a[1]) * r,
            a[2] + (b[2] - a[2]) * r,
        ],
        from,
    )
}

export function withThemeVars(theme = {}) {
    const bg = theme.bg || theme.pageBg || DEFAULT_THEME_BG
    const fg = theme.fg || theme.text || theme.pageFg || DEFAULT_THEME_FG
    const pageBg = theme.pageBg || bg
    const pageFg = theme.pageFg || theme.text || fg
    const panelBg = theme.panelBg || theme.card || mixColors(pageBg, pageFg, 0.08)
    const panelBorder = theme.panelBorder || theme.border || mixColors(pageBg, pageFg, 0.2)
    const accent = theme.accent || DEFAULT_THEME_ACCENT

    return {
        ...theme,
        bg,
        fg,
        text: theme.text || pageFg,
        pageBg,
        pageFg,
        panelBg,
        panelBorder,
        accent,
        card: theme.card || panelBg,
        border: theme.border || panelBorder,
    }
}

export const THEME_PRESETS = [
    withThemeVars({
        key: 'soft-white',
        name: '\uC18C\uD504\uD2B8 \uD654\uC774\uD2B8',
        bg: 'rgb(250,250,250)',
        fg: 'rgb(51,51,51)',
        note: '\uBC1D\uC740 \uB0AE, \uC0AC\uBB34\uC2E4',
    }),
    withThemeVars({
        key: 'classic-sepia',
        name: '\uD074\uB798\uC2DD \uC138\uD53C\uC544',
        bg: 'rgb(244,236,216)',
        fg: 'rgb(91,70,54)',
        note: '1\uC2DC\uAC04 \uC774\uC0C1\uC758 \uC7A5\uAE30 \uB3C5\uC11C',
    }),
    withThemeVars({
        key: 'midnight-dark',
        name: '\uBBF8\uB4DC\uB098\uC787 \uB2E4\uD06C',
        bg: 'rgb(28,28,28)',
        fg: 'rgb(210,210,210)',
        note: '\uC870\uBA85\uC774 \uC5B4\uB450\uC6B4 \uBC24',
    }),
    withThemeVars({
        key: 'solarized',
        name: '\uC194\uB77C\uC774\uC988\uB4DC',
        bg: 'rgb(0,43,54)',
        fg: 'rgb(131,148,150)',
        note: '\uACE0\uB3C4\uC758 \uC9D1\uC911\uC774 \uD544\uC694\uD55C \uD559\uC2B5',
    }),
    withThemeVars({
        key: 'pastel-green',
        name: '\uD30C\uC2A4\uD154 \uC5F0\uB450',
        bg: 'rgb(232,245,233)',
        fg: 'rgb(46,125,50)',
        note: '\uB208\uC758 \uAE34\uC7A5 \uC644\uD654, \uC232\uC18D \uB290\uB08C',
    }),
    withThemeVars({
        key: 'pastel-gray',
        name: '\uD30C\uC2A4\uD154 \uD68C\uC0C9',
        bg: 'rgb(240,240,240)',
        fg: 'rgb(66,66,66)',
        note: '\uBAA8\uB358\uD55C \uAC10\uC131, \uC7A5\uC2DC\uAC04 \uC9D1\uC911',
    }),
]
