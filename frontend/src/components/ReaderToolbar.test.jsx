// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import ReaderToolbar from './ReaderToolbar'

function createSettings() {
    return {
        theme: 'light', font: 'system', setFont: vi.fn(), fontMode: 'user', setFontMode: vi.fn(),
        fontFamily: '', setFontFamily: vi.fn(), fontWeight: 400, setFontWeight: vi.fn(), fontSize: 18,
        incFont: vi.fn(), decFont: vi.fn(), layout: 'dual', setLayout: vi.fn(), lineHeight: 1.8,
        setLineHeight: vi.fn(), letterSpacing: -0.01, setLetterSpacing: vi.fn(), hMargin: 48,
        setHMargin: vi.fn(), vMargin: 32, setVMargin: vi.fn(), columnGap: 64, setColumnGap: vi.fn(),
        zipImageScale: 1, setZipImageScale: vi.fn(), bgColor: '#fbfaf6', setBgColor: vi.fn(),
        textColor: '#38342f', setTextColor: vi.fn(), showTitleBar: true, toggleTitleBar: vi.fn(),
        lang: 'ko', setLang: vi.fn(), resetDefaults: vi.fn(), resetToast: false, settingsOpen: true,
        toggleSettings: vi.fn(), THEMES: { light: { text: '#38342f' } },
        FONTS: { system: { family: 'system-ui' } },
        tt: (key) => ({ trimSpaces: '공백 정리', splitParagraphs: '문단 나누기' }[key] || key),
    }
}

test('TXT transforms live in reading settings and call their existing setters', async () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const user = userEvent.setup()
    const onTrimSpacesChange = vi.fn()
    const onSplitParagraphsChange = vi.fn()
    render(<ReaderToolbar settings={createSettings()} readerType="txt" txtTransforms={{
        trimSpaces: false, splitParagraphs: true, onTrimSpacesChange, onSplitParagraphsChange,
    }} />)

    const trim = screen.getByRole('checkbox', { name: '공백 정리' })
    const split = screen.getByRole('checkbox', { name: '문단 나누기' })
    expect(trim.checked).toBe(false)
    expect(split.checked).toBe(true)
    await user.click(trim)
    await user.click(split)
    expect(onTrimSpacesChange).toHaveBeenCalledWith(true)
    expect(onSplitParagraphsChange).toHaveBeenCalledWith(false)
})

test('non-TXT readers do not show TXT transform settings', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<ReaderToolbar settings={createSettings()} readerType="epub" />)
    expect(screen.queryByText('공백 정리')).toBeNull()
    expect(screen.queryByText('문단 나누기')).toBeNull()
})
