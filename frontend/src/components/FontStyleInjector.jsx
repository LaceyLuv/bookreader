import { useEffect } from 'react'
import { API_FONTS_BASE } from '../lib/apiBase'

const FONT_UPDATE_EVENT = 'bookreader:user-fonts-updated'
const STYLE_TAG_ID = 'user-font-faces'

function fontFormatFromExt(ext) {
    const value = (ext || '').toLowerCase()
    if (value === 'ttf') return 'truetype'
    if (value === 'otf') return 'opentype'
    if (value === 'woff') return 'woff'
    if (value === 'woff2') return 'woff2'
    return 'truetype'
}

function buildFontFaceCss(fonts) {
    return fonts.map((font) => {
        const family = `UserFont_${font.id}`
        const format = fontFormatFromExt(font.ext)
        const src = `${API_FONTS_BASE}/${encodeURIComponent(font.id)}`
        return `@font-face { font-family: '${family}'; src: url('${src}') format('${format}'); font-display: swap; }`
    }).join('\n')
}

function ensureStyleTag() {
    let styleTag = document.getElementById(STYLE_TAG_ID)
    if (!styleTag) {
        styleTag = document.createElement('style')
        styleTag.id = STYLE_TAG_ID
        document.head.appendChild(styleTag)
    }
    return styleTag
}

async function fetchUserFonts() {
    try {
        const res = await fetch(API_FONTS_BASE)
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? data : (Array.isArray(data?.fonts) ? data.fonts : [])
    } catch {
        return []
    }
}

export function emitUserFontsUpdated() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event(FONT_UPDATE_EVENT))
}

export default function FontStyleInjector() {
    useEffect(() => {
        let disposed = false

        const refresh = async () => {
            const fonts = await fetchUserFonts()
            if (disposed) return
            const styleTag = ensureStyleTag()
            styleTag.textContent = buildFontFaceCss(fonts)
        }

        refresh()
        window.addEventListener(FONT_UPDATE_EVENT, refresh)
        return () => {
            disposed = true
            window.removeEventListener(FONT_UPDATE_EVENT, refresh)
        }
    }, [])

    return null
}
