// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    default: ({ currentPage, totalPages, extraInfo, onSeekPage }) => (
        <div data-testid="reader-progress-bar">
            <output data-testid="progress-current-page">{currentPage}</output>
            <output data-testid="progress-total-pages">{totalPages}</output>
            <output data-testid="progress-extra">{extraInfo}</output>
            <button type="button" onClick={() => onSeekPage?.(3)}>seek-last-page</button>
        </div>
    ),
}))
vi.mock('./ResumeToast', () => ({ default: () => null }))

import ZipReader from './ZipReader'

function createSettings(overrides = {}) {
    return {
        themeStyle: {
            border: '#ddd',
            text: '#111',
            card: '#fff',
            bg: '#fff',
        },
        layout: 'single',
        hMargin: 20,
        vMargin: 20,
        zipImageScale: 1,
        tt: (key) => key,
        toggleTitleBar: vi.fn(),
        ...overrides,
    }
}

function createProgress(overrides = {}) {
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
        ...overrides,
    }
}

function renderReader() {
    return render(
        <MemoryRouter initialEntries={['/read/zip-1']}>
            <Routes>
                <Route path="/read/:id" element={<ZipReader />} />
            </Routes>
        </MemoryRouter>,
    )
}

beforeEach(() => {
    mockUseKeyboardNav.mockReturnValue(undefined)
    mockUseReaderSettings.mockImplementation(() => createSettings())
    mockUseReadingProgress.mockImplementation((_bookId, _options) => createProgress())
    vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (String(url).endsWith('/api/books/zip-1/images')) {
            return new Response(JSON.stringify({ images: ['1.jpg', '2.jpg', '3.jpg'], total: 3 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        return new Response('{}', { status: 404 })
    }))
})

test('dual ZIP view shows only the final odd page after seeking to the last image', async () => {
    mockUseReaderSettings.mockImplementation(() => createSettings({ layout: 'dual' }))
    renderReader()

    await screen.findByAltText('Page 1')
    fireEvent.click(screen.getByRole('button', { name: 'seek-last-page' }))

    await waitFor(() => {
        expect(screen.getByAltText('Page 3')).toBeTruthy()
    })
    expect(screen.queryByAltText('Page 4')).toBeNull()
    expect(screen.getByTestId('progress-extra').textContent).toBe('ZIP  3/3')
})

test('ZIP image load failures show a per-page error without removing the reader', async () => {
    renderReader()

    const image = await screen.findByAltText('Page 1')
    fireEvent.error(image)

    expect(screen.getByText('imageLoadFailed')).toBeTruthy()
    expect(screen.getByTestId('reader-progress-bar')).toBeTruthy()
})
