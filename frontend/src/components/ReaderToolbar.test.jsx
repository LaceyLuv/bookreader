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
        showZipBookmarkBar: true, setShowZipBookmarkBar: vi.fn(), showWindowFrame: true,
        setShowWindowFrame: vi.fn(), isFullscreen: false, toggleFullscreen: vi.fn(),
        frameControlSupported: true, fullscreenSupported: true, windowDisplayBusy: false, windowDisplayError: '',
        lang: 'ko', setLang: vi.fn(), resetDefaults: vi.fn(), resetToast: false, settingsOpen: true,
        toggleSettings: vi.fn(), THEMES: { light: { text: '#38342f' } },
        FONTS: { system: { family: 'system-ui' } },
        tt: (key) => key,
        ...overrides,
    }
}

function renderToolbar({ settings = createSettings(), readerType = 'epub', txtTransforms = null, txtEncoding = null } = {}) {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<ReaderToolbar settings={settings} readerType={readerType} txtTransforms={txtTransforms} txtEncoding={txtEncoding} />)
    return settings
}

afterEach(() => {
    vi.restoreAllMocks()
})

test('basic and advanced tabs keep typography controls connected', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar()

    const basicTab = screen.getByRole('tab', { name: 'settingsBasicTab' })
    const advancedTab = screen.getByRole('tab', { name: 'settingsAdvancedTab' })
    expect(basicTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'increaseFontSize' }))
    await user.click(screen.getByRole('button', { name: 'boldWeight' }))
    fireEvent.change(screen.getByRole('slider', { name: 'lineHeight' }), { target: { value: '2' } })
    expect(screen.queryByRole('slider', { name: 'fontWeightDetail' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'hMargin' })).toBeNull()

    fireEvent.keyDown(basicTab, { key: 'ArrowRight' })
    expect(advancedTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.change(screen.getByRole('slider', { name: 'fontWeightDetail' }), { target: { value: '550' } })
    fireEvent.change(screen.getByRole('slider', { name: 'hMargin' }), { target: { value: '64' } })

    expect(settings.incFont).toHaveBeenCalledOnce()
    expect(settings.setFontWeight).toHaveBeenCalledWith(700)
    expect(settings.setFontWeight).toHaveBeenCalledWith(550)
    expect(settings.setLineHeight).toHaveBeenCalledWith(2)
    expect(settings.setHMargin).toHaveBeenCalledWith(64)

    fireEvent.keyDown(advancedTab, { key: 'Home' })
    expect(basicTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(basicTab, { key: 'End' })
    expect(advancedTab.getAttribute('aria-selected')).toBe('true')
})

test('settings panel presents the supplied Gyeol lockup', () => {
    renderToolbar()

    const brand = screen.getByRole('img', { name: 'appTitle' })
    expect(brand.querySelector('img')?.getAttribute('src')).toContain('gyeol-lockup.png')
})

test('ZIP basic shows only effective theme, layout, and image controls', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar({ readerType: 'zip' })

    await user.click(screen.getByRole('button', { name: 'single' }))
    fireEvent.change(screen.getByRole('slider', { name: 'zipImageScale' }), { target: { value: '1.5' } })

    expect(settings.setLayout).toHaveBeenCalledWith('single')
    expect(settings.setZipImageScale).toHaveBeenCalledWith(1.5)
    expect(screen.queryByRole('combobox', { name: 'font' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'lineHeight' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'regularWeight' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'titleBar' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))
    expect(screen.getByRole('slider', { name: 'hMargin' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'vMargin' })).toBeTruthy()
    expect(screen.queryByRole('slider', { name: 'letterSpacing' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'splitMargin' })).toBeNull()
    expect(screen.queryByText('fontManagement')).toBeNull()
})

test('window, fullscreen, and ZIP bookmark-bar controls call their display actions', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar({ readerType: 'zip' })

    await user.click(screen.getByRole('checkbox', { name: 'showWindowFrame' }))
    await user.click(screen.getByRole('checkbox', { name: 'showZipBookmarkBar' }))
    await user.click(screen.getByRole('button', { name: 'hideZipBookmarkBar' }))
    await user.click(screen.getAllByRole('button', { name: 'enterFullscreen' })[0])

    expect(settings.setShowWindowFrame).toHaveBeenCalledWith(false)
    expect(settings.setShowZipBookmarkBar).toHaveBeenCalledTimes(2)
    expect(settings.setShowZipBookmarkBar).toHaveBeenNthCalledWith(1, false)
    expect(settings.setShowZipBookmarkBar).toHaveBeenNthCalledWith(2, false)
    expect(settings.toggleFullscreen).toHaveBeenCalledOnce()
})

test('shared preview reflects settings on basic and is hidden on advanced', async () => {
    const user = userEvent.setup()
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
    expect(page.style.paddingLeft).toBe('0px')
    expect(page.style.paddingRight).toBe('0px')
    const leftPreviewPage = screen.getByTestId('reader-settings-preview-left-page')
    const rightPreviewPage = screen.getByTestId('reader-settings-preview-right-page')
    expect(leftPreviewPage.style.paddingLeft).toBe('12.8px')
    expect(rightPreviewPage.style.paddingRight).toBe('12.8px')
    expect(leftPreviewPage.style.width).toBe('calc(100% - 2.88px)')
    expect(leftPreviewPage.style.justifySelf).toBe('end')
    expect(rightPreviewPage.style.width).toBe('calc(100% - 2.88px)')
    expect(rightPreviewPage.style.justifySelf).toBe('start')

    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))
    expect(screen.queryByTestId('reader-settings-preview')).toBeNull()
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

test('TXT advanced settings show the effective encoding and open the comparison dialog', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const settings = renderToolbar({
        readerType: 'txt',
        txtEncoding: { encoding: 'cp949', source: 'override', confidence: null, onOpen },
    })

    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))
    expect(screen.getByText(/cp949/)).toBeTruthy()
    expect(screen.getByText(/manualEncoding/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'changeEncoding' }))

    expect(settings.toggleSettings).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()
})

test('EPUB keeps its embedded-font toggle in basic and explanation in advanced', async () => {
    const user = userEvent.setup()
    const settings = renderToolbar({ readerType: 'epub' })

    await user.click(screen.getByRole('checkbox', { name: 'useEpubEmbeddedFonts' }))
    expect(settings.setFontMode).toHaveBeenCalledWith('embedded')
    await user.click(screen.getByRole('tab', { name: 'settingsAdvancedTab' }))

    expect(screen.getByText('embeddedFontsHint')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'useEpubEmbeddedFonts' })).toBeNull()
    expect(screen.queryByText('trimSpaces')).toBeNull()
    expect(screen.queryByRole('slider', { name: 'zipImageScale' })).toBeNull()
})

test.each([
    ['txt', true, false],
    ['epub', true, false],
    ['zip', false, true],
])('%s basic settings expose only controls relevant to that reader', (readerType, hasTypography, hasImageScale) => {
    renderToolbar({ readerType })

    expect(Boolean(screen.queryByRole('combobox', { name: 'font' }))).toBe(hasTypography)
    expect(Boolean(screen.queryByRole('slider', { name: 'lineHeight' }))).toBe(hasTypography)
    expect(Boolean(screen.queryByRole('slider', { name: 'zipImageScale' }))).toBe(hasImageScale)
    expect(screen.getByRole('button', { name: 'single' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'dual' })).toBeTruthy()
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
