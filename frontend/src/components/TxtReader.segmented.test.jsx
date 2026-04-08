import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

const mockUseKeyboardNav = vi.fn()
const mockUseReaderSettings = vi.fn()

vi.mock('../hooks/useReaderSettings', () => ({
    useReaderSettings: (...args) => mockUseReaderSettings(...args),
}))

vi.mock('../hooks/useKeyboardNav', () => ({
    useKeyboardNav: (...args) => mockUseKeyboardNav(...args),
}))

vi.mock('../hooks/useReadingProgress', () => ({
    useReadingProgress: (_bookId, { totalPages = 1 } = {}) => {
        const [currentPosition, setCurrentPosition] = React.useState(0)
        return {
            currentPosition,
            setCurrentPosition,
            bookmarks: [],
            addBookmark: vi.fn(),
            removeBookmark: vi.fn(),
            goToBookmark: setCurrentPosition,
            resumePrompt: null,
            resumeReading: vi.fn(),
            dismissResume: vi.fn(),
            totalPages,
        }
    },
}))

vi.mock('./ReaderToolbar', () => ({ default: () => <div data-testid="reader-toolbar" /> }))
vi.mock('./ReaderProgressBar', () => ({
    default: ({ onSeekPage }) => (
        <div data-testid="reader-progress-bar">
            <button type="button" onClick={() => onSeekPage?.(3)}>seek-to-page-3</button>
        </div>
    ),
}))
vi.mock('./ResumeToast', () => ({ default: () => null }))
vi.mock('./ReaderAnnotationsPanel', () => ({ default: () => null }))
vi.mock('./ReaderSelectionMenu', () => ({ default: () => null }))

import TxtReader from './TxtReader'

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
        lang: 'en',
        tt: (key) => key,
        toggleTitleBar: vi.fn(),
        ...overrides,
    }
}

function renderReader() {
    return render(
        <MemoryRouter initialEntries={['/read/txt-1']}>
            <Routes>
                <Route path="/read/:id" element={<TxtReader />} />
            </Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    mockUseKeyboardNav.mockReset()
    mockUseReaderSettings.mockImplementation(() => createSettings())
})

test('TXT reader renders only the requested segment window on first load', async () => {
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 120000, segment_count: 500 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 500,
                segments: [{ segment_id: 0, text: 'alpha block', start_offset: 0, end_offset: 11 }],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await waitFor(() => expect(screen.getByText('alpha block')).toBeTruthy())
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-manifest'))
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=0&limit=40'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/content'))
})

test('search-result click loads the target segment window and scrolls directly to the match', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 120000, segment_count: 500 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 500,
                segments: [{ segment_id: 0, text: 'alpha block', start_offset: 0, end_offset: 11 }],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=100&limit=40')) {
            return new Response(JSON.stringify({
                start: 100,
                limit: 40,
                total: 500,
                segments: [{ segment_id: 120, text: 'before target after', start_offset: 1000, end_offset: 1019 }],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search?q=target')) {
            return new Response(JSON.stringify({
                query: 'target',
                total: 1,
                results: [{
                    index: 0,
                    locator: 'segment:120:offset:7',
                    segment_id: 120,
                    segment_local_start: 7,
                    segment_local_end: 13,
                    snippet: 'target',
                }],
            }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await waitFor(() => expect(screen.getByText('alpha block')).toBeTruthy())
    await user.click(screen.getByTitle('search'))
    await user.type(screen.getByPlaceholderText('searchTextPlaceholder'), 'target')
    await user.click(screen.getAllByRole('button', { name: 'search' })[1])

    await waitFor(() => expect(screen.getByText('target')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /target/i }))

    await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=100&limit=40'))
    })
    await waitFor(() => {
        expect(document.querySelector('mark[data-active-search-mark="true"]')).toBeTruthy()
    })
})

test('Space moves TXT reader to the next visible viewport page', async () => {
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 120000, segment_count: 500 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 500,
                segments: [
                    { segment_id: 0, text: 'page zero body', start_offset: 0, end_offset: 14 },
                    { segment_id: 1, text: 'page one body', start_offset: 15, end_offset: 28 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await screen.findByText('page zero body')
    const keyboardConfig = mockUseKeyboardNav.mock.calls.at(-1)?.[0]
    await userEvent.setup()
    await React.act(async () => {
        await keyboardConfig.onNext()
    })

    await waitFor(() => expect(screen.getByText('page one body')).toBeTruthy())
    expect(screen.queryByText('page zero body')).toBeNull()
})

test('progress-bar seek updates visible TXT content, not only the page indicator', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 120000, segment_count: 500 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 500,
                segments: [
                    { segment_id: 0, text: 'alpha page', start_offset: 0, end_offset: 10 },
                    { segment_id: 1, text: 'beta page', start_offset: 11, end_offset: 20 },
                    { segment_id: 2, text: 'gamma page', start_offset: 21, end_offset: 31 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await screen.findByText('alpha page')
    await user.click(screen.getByRole('button', { name: 'seek-to-page-3' }))

    await waitFor(() => expect(screen.getByText('gamma page')).toBeTruthy())
    expect(screen.queryByText('alpha page')).toBeNull()
})
