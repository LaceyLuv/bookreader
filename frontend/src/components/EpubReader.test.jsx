// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const mockUseKeyboardNav = vi.fn()
const mockUseReaderSettings = vi.fn()
const mockUseReadingProgress = vi.fn()

vi.mock('../hooks/useReaderSettings', () => ({
    useReaderSettings: (...args) => mockUseReaderSettings(...args),
}))

vi.mock('../hooks/useKeyboardNav', () => ({
    useKeyboardNav: (...args) => mockUseKeyboardNav(...args),
}))

vi.mock('../hooks/useReadingProgress', () => ({
    useReadingProgress: (...args) => mockUseReadingProgress(...args),
}))

vi.mock('./ReaderToolbar', () => ({ default: () => <div data-testid="reader-toolbar" /> }))
vi.mock('./ReaderProgressBar', () => ({
    default: ({ currentPage, totalPages, progress }) => (
        <div data-testid="reader-progress-bar">
            <output data-testid="progress-current-page">{currentPage}</output>
            <output data-testid="progress-total-pages">{totalPages}</output>
            <output data-testid="progress-value">{progress}</output>
        </div>
    ),
}))
vi.mock('./ResumeToast', () => ({ default: () => null }))

import EpubReader from './EpubReader'

function createSettings(overrides = {}) {
    return {
        contentStyle: {
            fontFamily: 'serif',
            fontWeight: 400,
            fontSize: '16px',
        },
        themeStyle: {
            border: '#ddd',
            text: '#111',
            card: '#fff',
            bg: '#fff',
        },
        layout: 'single',
        columnGap: 32,
        hMargin: 20,
        vMargin: 20,
        lineHeight: 1.6,
        letterSpacing: 0,
        fontMode: 'custom',
        lang: 'en',
        tt: (key) => key,
        toggleTitleBar: vi.fn(),
        ...overrides,
    }
}

function createProgress(overrides = {}) {
    return {
        currentPosition: 0,
        setCurrentPosition: vi.fn(),
        bookmarks: [],
        addBookmark: vi.fn(),
        removeBookmark: vi.fn(),
        goToBookmark: vi.fn(),
        restoredProgress: null,
        startOver: vi.fn(),
        ...overrides,
    }
}

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status || 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

function renderReader() {
    return render(
        <MemoryRouter initialEntries={['/read/epub-1']}>
            <Routes>
                <Route path="/read/:id" element={<EpubReader />} />
            </Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    vi.useRealTimers()
    mockUseReaderSettings.mockReturnValue(createSettings())
    mockUseReadingProgress.mockReturnValue(createProgress())
    mockUseKeyboardNav.mockReturnValue(undefined)

    global.fetch = vi.fn(async (url) => {
        const requestUrl = String(url)
        if (requestUrl.endsWith('/api/books/epub-1/toc')) {
            return jsonResponse({
                title: 'Smoke EPUB',
                toc: [
                    { title: 'Chapter One', index: 0, href: 'Text/chapter1.xhtml' },
                    { title: 'Chapter Two', index: 1, href: 'Text/chapter2.xhtml' },
                ],
            })
        }
        if (requestUrl.endsWith('/api/books/epub-1/chapter/0')) {
            return jsonResponse({
                title: 'Chapter One',
                html: '<main><h1>Chapter One</h1><p>Hello <strong>reader</strong>.</p><a href="chapter2.xhtml#target">Next chapter</a><a href="https://evil.example/leave">External link</a><img src="/api/books/epub-1/asset/cover.jpg" onerror="window.bad=true"><script>window.bad=true</script></main>',
                index: 0,
                total: 2,
            })
        }
        if (requestUrl.endsWith('/api/books/epub-1/chapter/1')) {
            return jsonResponse({
                title: 'Chapter Two',
                html: '<main><h1 id="target">Chapter Two</h1><p>Second body.</p></main>',
                index: 1,
                total: 2,
            })
        }
        if (requestUrl.endsWith('/api/books/epub-1/diagnostics')) {
            return jsonResponse({ format: 'epub', status: 'supported', issues: [], stats: {} })
        }
        if (requestUrl.endsWith('/api/books/epub-1/annotations')) {
            return jsonResponse([])
        }
        throw new Error(`Unexpected fetch: ${requestUrl}`)
    })
})

test('loads toc and renders sanitized chapter html', async () => {
    renderReader()

    expect(await screen.findByText('Chapter One')).toBeTruthy()
    expect(screen.getByText('reader')).toBeTruthy()

    await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/toc', expect.objectContaining({ signal: expect.any(AbortSignal) }))
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/chapter/0', expect.objectContaining({ signal: expect.any(AbortSignal) }))
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/annotations')
    })

    const renderedImage = document.querySelector('.epub-content img')
    const renderedContent = document.querySelector('.epub-content')
    expect(renderedContent.textContent).toContain('Hello reader.')
    expect(renderedImage).toBeTruthy()
    expect(renderedImage.getAttribute('src')).toBe('/api/books/epub-1/asset/cover.jpg')
    expect(renderedImage.hasAttribute('onerror')).toBe(false)
    expect(document.querySelector('.epub-content script')).toBeNull()
    expect(screen.getByTestId('reader-progress-bar')).toBeTruthy()
})

test('shows a non-blocking warning for EPUB features limited by safe rendering', async () => {
    const regularFetch = global.fetch.getMockImplementation()
    global.fetch.mockImplementation((url, options = {}) => {
        if (String(url).endsWith('/api/books/epub-1/diagnostics')) {
            return Promise.resolve(jsonResponse({
                format: 'epub',
                status: 'degraded',
                issues: [{ code: 'epub_mathml_limited', severity: 'warning' }],
                stats: {},
            }))
        }
        return regularFetch(url, options)
    })

    renderReader()

    expect((await screen.findByText(/limitedFormatSupport/)).textContent).toContain('epub_mathml_limited')
    expect(await screen.findByText('reader')).toBeTruthy()
})

test('shows a structured initial EPUB error instead of a blank stage and retries', async () => {
    const regularFetch = global.fetch.getMockImplementation()
    let tocAttempts = 0
    global.fetch.mockImplementation((url, options = {}) => {
        if (String(url).endsWith('/api/books/epub-1/toc') && tocAttempts++ === 0) {
            return Promise.resolve(jsonResponse({
                detail: {
                    code: 'epub.invalid_archive',
                    message: 'Damaged EPUB archive',
                    severity: 'error',
                    stage: 'archive',
                    retryable: false,
                    recovery: 'choose_another_file',
                    context: {},
                },
            }, { status: 422 }))
        }
        return regularFetch(url, options)
    })

    renderReader()

    expect((await screen.findByRole('alert')).textContent).toContain('Damaged EPUB archive')
    expect(screen.getByTestId('epub-reader-stage').childNodes.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    expect(await screen.findByText('reader')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
})

test('keeps the last good EPUB chapter when the next chapter fails and retries it', async () => {
    const regularFetch = global.fetch.getMockImplementation()
    let chapterTwoAttempts = 0
    global.fetch.mockImplementation((url, options = {}) => {
        if (String(url).endsWith('/api/books/epub-1/chapter/1') && chapterTwoAttempts++ === 0) {
            return Promise.resolve(jsonResponse({
                detail: {
                    code: 'epub.chapter_unreadable',
                    message: 'Chapter payload is damaged',
                    severity: 'error',
                    stage: 'chapter',
                    retryable: false,
                    recovery: null,
                    context: { chapter_index: 1 },
                },
            }, { status: 422 }))
        }
        return regularFetch(url, options)
    })

    renderReader()
    await screen.findByText('Next chapter')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    fireEvent.click(screen.getByText('Next chapter'))

    expect((await screen.findByRole('alert')).textContent).toContain('Chapter payload is damaged')
    expect(screen.getByText('reader')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    expect(await screen.findByText('Second body.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
})

test('dual EPUB layout uses the original outer horizontal margin behavior', async () => {
    mockUseReaderSettings.mockReturnValue(createSettings({ layout: 'dual', hMargin: 20, columnGap: 32 }))
    renderReader()

    await screen.findByText('Chapter One')
    const stage = screen.getByTestId('epub-reader-stage')
    const content = document.querySelector('.epub-content')

    expect(stage.style.paddingLeft).toBe('20px')
    expect(stage.style.paddingRight).toBe('20px')
    expect(content.style.columnGap).toBe('32px')
})

test('automatically opens the restored EPUB chapter', async () => {
    mockUseReadingProgress.mockReturnValue(createProgress({
        currentPosition: 1,
        restoredProgress: {
            position: 1,
            locator: { kind: 'epub', chapterIndex: 1, chapterPage: 0 },
            updatedAt: '2026-07-12T00:00:00.000Z',
        },
    }))

    renderReader()

    expect(await screen.findByText('Second body.')).toBeTruthy()
    expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/chapter/1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

test('restores chapter zero progress by href before a stale chapter index', async () => {
    mockUseReadingProgress.mockReturnValue(createProgress({
        currentPosition: 0,
        restoredProgress: {
            position: 0,
            locator: {
                version: 2,
                kind: 'epub',
                chapterHref: 'Text/chapter2.xhtml',
                chapterIndex: 0,
                chapterPage: 0,
            },
            updatedAt: '2026-07-12T00:00:00.000Z',
        },
    }))

    renderReader()

    expect(await screen.findByText('Second body.')).toBeTruthy()
    expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/chapter/1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

test('clicking an internal chapter link loads the mapped chapter', async () => {
    renderReader()

    await screen.findByText('Next chapter')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    fireEvent.click(screen.getByText('Next chapter'))

    await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/chapter/1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    })
    expect(await screen.findByText('Second body.')).toBeTruthy()
})

test('EPUB links cannot trigger the WebView default navigation', async () => {
    renderReader()

    const externalLink = await screen.findByText('External link')
    // The sanitizer strips external hrefs, so the text remains readable without
    // retaining a browser navigation target.
    expect(externalLink.closest('a').hasAttribute('href')).toBe(false)

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const internalLink = screen.getByText('Next chapter').closest('a')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(internalLink, click)
    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/chapter/1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    })
    expect(await screen.findByText('Second body.')).toBeTruthy()
})

test('closing search aborts the active request and disables page keyboard navigation', async () => {
    const regularFetch = global.fetch.getMockImplementation()
    let searchSignal
    global.fetch.mockImplementation((url, options = {}) => {
        if (String(url).includes('/search?q=target')) {
            searchSignal = options.signal
            return new Promise(() => {})
        }
        return regularFetch(url, options)
    })
    renderReader()
    await screen.findByText('Chapter One')

    fireEvent.click(screen.getByTitle('search'))
    fireEvent.change(screen.getByLabelText('searchTextPlaceholder'), { target: { value: 'target' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'search' }).at(-1))

    await waitFor(() => expect(searchSignal).toBeInstanceOf(AbortSignal))
    expect(mockUseKeyboardNav.mock.calls.at(-1)[0].enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(searchSignal.aborted).toBe(true)
})
