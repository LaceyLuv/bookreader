// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import ReaderToolbar from './ReaderToolbar'

function createSettings(overrides = {}) {
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
        tt: (key) => key,
        ...overrides,
    }
}

function renderToolbar({ settings = createSettings(), readerType = 'epub', txtTransforms = null } = {}) {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<ReaderToolbar settings={settings} readerType={readerType} txtTransforms={txtTransforms} />)
    return settings
}

afterEach(() => {
    vi.restoreAllMocks()
})

test('reading tab keeps typography, detailed weight, and margin controls connected', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar()

    expect(screen.getByRole('tab', { name: 'settingsReadTab' }).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'increaseFontSize' }))
    await user.click(screen.getByRole('button', { name: 'boldWeight' }))
    fireEvent.change(screen.getByRole('slider', { name: 'lineHeight' }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('slider', { name: 'fontWeightDetail' }), { target: { value: '550' } })
    fireEvent.change(screen.getByRole('slider', { name: 'hMargin' }), { target: { value: '64' } })

    expect(settings.incFont).toHaveBeenCalledOnce()
    expect(settings.setFontWeight).toHaveBeenCalledWith(700)
    expect(settings.setFontWeight).toHaveBeenCalledWith(550)
    expect(settings.setLineHeight).toHaveBeenCalledWith(2)
    expect(settings.setHMargin).toHaveBeenCalledWith(64)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'settingsReadTab' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'settingsDisplayTab' }).getAttribute('aria-selected')).toBe('true')
})

test('display tab groups layout, themes, colors, and ZIP scale without title bar controls', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar({ readerType: 'zip' })
    await user.click(screen.getByRole('tab', { name: 'settingsDisplayTab' }))

    await user.click(screen.getByRole('button', { name: 'single' }))
    fireEvent.change(screen.getByRole('slider', { name: 'zipImageScale' }), { target: { value: '1.5' } })

    expect(settings.setLayout).toHaveBeenCalledWith('single')
    expect(settings.setZipImageScale).toHaveBeenCalledWith(1.5)
    expect(screen.queryByRole('button', { name: 'titleBar' })).toBeNull()
})

test('shared preview reflects reading and display values', () => {
    const settings = createSettings({
        bgColor: '#112233', textColor: '#f0e0d0', fontWeight: 650, fontSize: 22,
        lineHeight: 2.1, letterSpacing: 0.08, hMargin: 80, vMargin: 40, columnGap: 72,
    })
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<ReaderToolbar settings={settings} readerType="epub" />)

    const preview = screen.getByTestId('reader-settings-preview')
    const page = screen.getByTestId('reader-settings-preview-page')
    expect(preview.style.backgroundColor).toBe('rgb(17, 34, 51)')
    expect(preview.style.color).toBe('rgb(240, 224, 208)')
    expect(page.style.fontWeight).toBe('650')
    expect(page.style.lineHeight).toBe('2.1')
    expect(page.style.letterSpacing).toBe('0.08em')
    expect(page.style.columnGap).toBe('8.64px')
})

test('TXT transforms live in the advanced tab and call their existing setters', async () => {
    const user = userEvent.setup()
    const onTrimSpacesChange = vi.fn()
    const onSplitParagraphsChange = vi.fn()
    renderToolbar({ readerType: 'txt', txtTransforms: {
        trimSpaces: false, splitParagraphs: true, onTrimSpacesChange, onSplitParagraphsChange,
    } })

    expect(screen.queryByRole('checkbox', { name: 'trimSpaces' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))
    const trim = screen.getByRole('checkbox', { name: 'trimSpaces' })
    const split = screen.getByRole('checkbox', { name: 'splitParagraphs' })
    await user.click(trim)
    await user.click(split)

    expect(onTrimSpacesChange).toHaveBeenCalledWith(true)
    expect(onSplitParagraphsChange).toHaveBeenCalledWith(false)
})

test('advanced format options are contextual', async () => {
    const user = userEvent.setup()
    renderToolbar({ readerType: 'epub' })
    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))

    expect(screen.getByRole('checkbox', { name: /useEpubEmbeddedFonts/ })).toBeTruthy()
    expect(screen.queryByText('trimSpaces')).toBeNull()
    expect(screen.queryByRole('slider', { name: 'zipImageScale' })).toBeNull()
})

test('done, close, backdrop, and Escape all use the existing close callback', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar()

    await user.click(screen.getByRole('button', { name: 'done' }))
    await user.click(screen.getByRole('button', { name: 'closeSettings' }))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(settings.toggleSettings).toHaveBeenCalledTimes(4)
})

test('reset honors confirmation before calling the existing reset action', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    await user.click(screen.getByRole('button', { name: 'resetDefaults' }))
    await user.click(screen.getByRole('button', { name: 'resetDefaults' }))

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(settings.resetDefaults).toHaveBeenCalledOnce()
})

test('font upload keeps using the existing fonts endpoint and selects the saved font', async () => {
    const user = userEvent.setup()
    const settings = createSettings()
    global.fetch = vi.fn(async (_url, options) => {
        if (options?.method === 'POST') return { ok: true, json: async () => ({ id: 7 }) }
        return { ok: true, json: async () => [] }
    })
    const { container } = render(<ReaderToolbar settings={settings} readerType="epub" />)
    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))
    await user.upload(container.querySelector('input[type="file"]'), new File(['font'], 'reader.woff2', { type: 'font/woff2' }))

    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }))
    expect(settings.setFontFamily).toHaveBeenCalledWith('UserFont_7')
    expect(settings.setFontMode).toHaveBeenCalledWith('user')
})
