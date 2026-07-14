export function compactBookmarkText(value, maxLength = 180) {
    const text = Array.isArray(value) ? value.filter(Boolean).join(' ') : value
    if (typeof text !== 'string') return ''

    const compact = text.replace(/\s+/g, ' ').trim()
    if (compact.length <= maxLength) return compact
    return `${compact.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function getBookmarkExcerpt(fallback, maxLength = 180) {
    try {
        const selected = typeof window !== 'undefined' ? window.getSelection?.()?.toString() : ''
        const selectedExcerpt = compactBookmarkText(selected, maxLength)
        if (selectedExcerpt) return selectedExcerpt
    } catch {
        // A reader can still save its visible-page fallback in restricted webviews.
    }
    return compactBookmarkText(fallback, maxLength)
}
