import { expect, test } from 'vitest'

import { buildEpubTypographyCss } from './epubTypography'

test('buildEpubTypographyCss forces user font family and weight onto chapter descendants', () => {
  const css = buildEpubTypographyCss({
    useEmbeddedFonts: false,
    fontFamily: 'UserFont_123',
    fontWeight: 550,
  })

  expect(css).toContain('.epub-content')
  expect(css).toContain('font-family: "UserFont_123" !important;')
  expect(css).toContain('font-weight: 550 !important;')
  expect(css).toContain('font-variation-settings: "wght" 550 !important;')
  expect(css).toContain('.epub-content.epub-content.epub-content *')
  expect(css).toContain('font-family: inherit !important;')
})

test('buildEpubTypographyCss preserves preset font stacks as fallback lists', () => {
  const fontStack = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

  const css = buildEpubTypographyCss({
    useEmbeddedFonts: false,
    fontFamily: fontStack,
    fontWeight: 400,
  })

  expect(css).toContain(`font-family: ${fontStack} !important;`)
  expect(css).not.toContain(`font-family: "${fontStack}" !important;`)
})

test('buildEpubTypographyCss preserves embedded font families while forcing the user weight', () => {
  const css = buildEpubTypographyCss({
    useEmbeddedFonts: true,
    fontFamily: 'UserFont_123',
    fontWeight: 550,
  })

  expect(css).toContain('font-weight: 550 !important;')
  expect(css).toContain('font-variation-settings: "wght" 550 !important;')
  expect(css).not.toContain('font-family:')
  expect(css).not.toContain('UserFont_123')
})
