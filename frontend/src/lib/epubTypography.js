function normalizeFontWeight(fontWeight) {
  const parsed = Number(fontWeight)
  if (!Number.isFinite(parsed)) return 400
  return Math.max(100, Math.min(900, parsed))
}

function normalizeFontFamily(fontFamily) {
  const value = typeof fontFamily === 'string' ? fontFamily.trim() : ''
  if (!value) return '"system-ui"'
  return JSON.stringify(value)
}

export function buildEpubTypographyCss({ useEmbeddedFonts, fontFamily, fontWeight }) {
  if (useEmbeddedFonts) return ''

  const safeFamily = normalizeFontFamily(fontFamily)
  const safeWeight = normalizeFontWeight(fontWeight)

  return [
    `.epub-content { font-family: ${safeFamily} !important; font-weight: ${safeWeight} !important; }`,
    '.epub-content :where(p, div, span, a, li, blockquote, dt, dd, h1, h2, h3, h4, h5, h6, strong, em, b, i, font, small, sub, sup) {',
    '  font-family: inherit !important;',
    '  font-weight: inherit !important;',
    '}',
  ].join('\n')
}
