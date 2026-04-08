import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../hooks/useReaderSettings', () => ({
    useReaderSettings: () => ({
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
    }),
}))

vi.mock('../hooks/useKeyboardNav', () => ({
    useKeyboardNav: vi.fn(),
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
    default: () => <div data-testid="reader-progress-bar" />,
}))
vi.mock('./ResumeToast', () => ({ default: () => null }))
vi.mock('./ReaderAnnotationsPanel', () => ({ default: () => null }))
vi.mock('./ReaderSelectionMenu', () => ({ default: () => null }))

import TxtReader from './TxtReader'

function renderReader() {
    return render(
        <MemoryRouter initialEntries={['/read/txt-1']}>
            <Routes>
                <Route path="/read/:id" element={<TxtReader />} />
            </Routes>
        </MemoryRouter>,
    )
}

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
