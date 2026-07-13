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
        restoredProgress: null,
        startOver: vi.fn(),
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

    await screen.findByAltText('page 1')
    fireEvent.click(screen.getByRole('button', { name: 'seek-last-page' }))

    await waitFor(() => {
        expect(screen.getByAltText('page 3')).toBeTruthy()
    })
    expect(screen.queryByAltText('page 4')).toBeNull()
    expect(screen.getByTestId('progress-extra').textContent).toBe('ZIP  3/3')
})

test('disables page keyboard navigation while reader settings are open', async () => {
    mockUseReaderSettings.mockImplementation(() => createSettings({ settingsOpen: true }))
    renderReader()

    await screen.findByAltText('page 1')
    expect(mockUseKeyboardNav.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ enabled: false }))
})

test('ZIP image load failures show a per-page error without removing the reader', async () => {
    renderReader()

    const image = await screen.findByAltText('page 1')
    fireEvent.error(image)

    expect(screen.getByText('imageLoadFailed')).toBeTruthy()
    expect(screen.getByTestId('reader-progress-bar')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'retryImage' }))
    const retriedImage = await screen.findByAltText('page 1')
    expect(retriedImage.getAttribute('src')).toContain('?retry=1')
})

test('automatically shows the restored ZIP image', async () => {
    mockUseReadingProgress.mockImplementation(() => createProgress({
        currentPosition: 1,
        restoredProgress: {
            position: 1,
            locator: { kind: 'zip', memberName: '2.jpg', page: 1 },
            updatedAt: '2026-07-12T00:00:00.000Z',
        },
    }))

    renderReader()

    expect(await screen.findByAltText('page 2')).toBeTruthy()
    expect(screen.getByTestId('progress-extra').textContent).toBe('ZIP  2/3')
})

test('ZIP listing errors are distinct from an empty archive and can be retried', async () => {
    global.fetch
        .mockResolvedValueOnce(new Response(JSON.stringify({
            detail: {
                code: 'zip.invalid_archive',
                message: 'Damaged ZIP archive',
                severity: 'error',
                stage: 'archive',
                retryable: false,
                recovery: 'choose_another_file',
                context: {},
            },
        }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ images: ['1.jpg'], total: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }))

    renderReader()

    expect((await screen.findByRole('alert')).textContent).toContain('Damaged ZIP archive')
    expect(screen.queryByText('noImagesFound')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    expect(await screen.findByAltText('page 1')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
})

test('a successful empty ZIP keeps the separate no-images state', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ images: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    }))

    renderReader()

    expect(await screen.findByText('noImagesFound')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
})

test('shows skipped ZIP entries as a non-blocking safety warning', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        images: ['1.jpg'],
        total: 1,
        diagnostics: [{ code: 'unsafe_member', severity: 'warning' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderReader()

    expect((await screen.findByText(/archiveEntriesSkipped/)).textContent).toContain('unsafe_member')
    expect(await screen.findByAltText('page 1')).toBeTruthy()
})
