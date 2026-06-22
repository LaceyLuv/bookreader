// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
        resumePrompt: null,
        resumeReading: vi.fn(),
        dismissResume: vi.fn(),
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
    mockUseReaderSettings.mockReturnValue(createSettings())
    mockUseReadingProgress.mockReturnValue(createProgress())
    mockUseKeyboardNav.mockReturnValue(undefined)

    global.fetch = vi.fn(async (url) => {
        const requestUrl = String(url)
        if (requestUrl.endsWith('/api/books/epub-1/toc')) {
            return jsonResponse({
                title: 'Smoke EPUB',
                toc: [
                    { title: 'Chapter One', index: 0 },
                    { title: 'Chapter Two', index: 1 },
                ],
            })
        }
        if (requestUrl.endsWith('/api/books/epub-1/chapter/0')) {
            return jsonResponse({
                title: 'Chapter One',
                html: '<main><h1>Chapter One</h1><p>Hello <strong>reader</strong>.</p><img src="/api/books/epub-1/asset/cover.jpg" onerror="window.bad=true"><script>window.bad=true</script></main>',
                index: 0,
                total: 2,
            })
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
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/toc')
        expect(global.fetch).toHaveBeenCalledWith('/api/books/epub-1/chapter/0')
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
