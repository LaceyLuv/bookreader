function normalizeFontWeight(fontWeight) {
  const parsed = Number(fontWeight)
  if (!Number.isFinite(parsed)) return 400
  return Math.max(100, Math.min(900, parsed))
}

function normalizeFontFamily(fontFamily) {
  const value = typeof fontFamily === 'string' ? fontFamily.trim() : ''
  if (!value) return '"system-ui"'
  if (value.includes(',')) return value
  return JSON.stringify(value)
}

export function buildEpubTypographyCss({ useEmbeddedFonts, fontFamily, fontWeight }) {
  const safeWeight = normalizeFontWeight(fontWeight)
  const familyDeclaration = useEmbeddedFonts
    ? ''
    : ` font-family: ${normalizeFontFamily(fontFamily)} !important;`
  const inheritedFamily = useEmbeddedFonts
    ? ''
    : '  font-family: inherit !important;\n'
  const weightDeclarations = [
    `  font-weight: ${safeWeight} !important;`,
    `  font-variation-settings: "wght" ${safeWeight} !important;`,
  ].join('\n')

  return [
    `.epub-content.epub-content.epub-content {${familyDeclaration}`,
    weightDeclarations,
    '}',
    '.epub-content.epub-content.epub-content * {',
    inheritedFamily,
    weightDeclarations,
    '}',
  ].filter(Boolean).join('\n')
}
