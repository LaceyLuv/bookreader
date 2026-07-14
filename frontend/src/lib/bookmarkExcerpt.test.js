import { afterEach, expect, test, vi } from 'vitest'

import { compactBookmarkText, getBookmarkExcerpt } from './bookmarkExcerpt'

afterEach(() => {
    vi.restoreAllMocks()
})

test('compacts whitespace and caps bookmark excerpts', () => {
    expect(compactBookmarkText('  first\n\n second  ')).toBe('first second')
    expect(compactBookmarkText('abcdefgh', 6)).toBe('abcde…')
})

test('prefers the selected passage over the page fallback', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => ' selected\npassage ' })
    expect(getBookmarkExcerpt('page fallback')).toBe('selected passage')
})
