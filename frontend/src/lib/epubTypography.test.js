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
  expect(css).toContain('.epub-content :where(')
  expect(css).toContain('font-family: inherit !important;')
  expect(css).toContain('font-weight: inherit !important;')
  expect(css).not.toContain('strong')
  expect(css).not.toContain(' b,')
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

test('buildEpubTypographyCss skips overrides when embedded fonts are enabled', () => {
  expect(buildEpubTypographyCss({
    useEmbeddedFonts: true,
    fontFamily: 'UserFont_123',
    fontWeight: 550,
  })).toBe('')
})
