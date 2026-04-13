// @vitest-environment jsdom
import React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { buildMeasuredPages } from '../lib/txtMeasuredPagination'
import { composeRenderPages, findRenderPageForLocator, getRenderPageStartSegment, getRenderPageStartSegments } from '../lib/txtRenderPages'

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
    default: ({ currentPage, totalPages, progress, onSeekPage, onSeekProgress }) => (
        <div data-testid="reader-progress-bar">
            <output data-testid="progress-current-page">{currentPage}</output>
            <output data-testid="progress-total-pages">{totalPages}</output>
            <output data-testid="progress-value">{progress}</output>
            <button type="button" onClick={() => onSeekPage?.(2)}>seek-to-page-2</button>
            <button type="button" onClick={() => onSeekPage?.(3)}>seek-to-page-3</button>
            <button type="button" onClick={() => onSeekProgress?.(0.5)}>seek-to-progress-mid</button>
        </div>
    ),
}))
vi.mock('./ResumeToast', () => ({ default: () => null }))
vi.mock('./ReaderAnnotationsPanel', () => ({
    default: ({ open, annotations = [], onItemClick }) => (
        open ? (
            <div data-testid="reader-annotations-panel">
                {annotations.map((annotation) => (
                    <button key={annotation.id} type="button" onClick={() => onItemClick?.(annotation)}>
                        {annotation.snippet || annotation.locator || annotation.id}
                    </button>
                ))}
            </div>
        ) : null
    ),
}))
vi.mock('./ReaderSelectionMenu', () => ({
    default: ({ selection, onHighlight }) => (
        selection ? <button type="button" onClick={() => onHighlight?.()}>create-highlight</button> : null
    ),
}))

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

function RouteControlHarness() {
    const navigate = useNavigate()

    return (
        <>
            <button type="button" onClick={() => navigate('/read/txt-1')}>open-book-1</button>
            <button type="button" onClick={() => navigate('/read/txt-2')}>open-book-2</button>
            <Routes>
                <Route path="/read/:id" element={<TxtReader />} />
            </Routes>
        </>
    )
}

function renderReaderWithRouteControls() {
    return render(
        <MemoryRouter initialEntries={['/read/txt-1']}>
            <RouteControlHarness />
        </MemoryRouter>,
    )
}

function getMeasuredTextLength(slice) {
    if (typeof slice?.displayText === 'string') return slice.displayText.length
    if (typeof slice?.display_text === 'string') return slice.display_text.length
    if (typeof slice?.text === 'string') return slice.text.length
    return 0
}

function buildExpectedMeasuredPages(segments) {
    return buildMeasuredPages(segments, {
        pageHeight: 24,
        measureSliceHeight: getMeasuredTextLength,
        measurePageHeight: (pageSlices) => pageSlices.reduce((total, slice) => total + getMeasuredTextLength(slice), 0),
    })
}

function getMeasuredPageText(page) {
    return page.segments.map((segment) => segment.displayText ?? segment.text ?? '').join('')
}

test('render-page start markers keep transformed fragment offsets for same-segment splits', () => {
    const renderPages = composeRenderPages([
        { segment_id: 0, display_text: 'first fragment text!!', source_start_offset: 0, source_end_offset: 21 },
        { segment_id: 0, display_text: 'second fragment text!', source_start_offset: 21, source_end_offset: 42 },
        { segment_id: 0, display_text: 'third fragment text!!', source_start_offset: 42, source_end_offset: 62 },
    ], { maxCharactersPerPage: 24 })

    expect(getRenderPageStartSegments(renderPages)).toEqual([
        'segment:0:offset:0',
        'segment:0:offset:21',
        'segment:0:offset:42',
    ])
    expect(getRenderPageStartSegment(renderPages, 'segment:0:offset:42')).toBe('segment:0:offset:42')
    expect(findRenderPageForLocator(renderPages, 'segment:0:offset:42')).toBe(2)
})

test('render-page locator resolution uses segment-local fragment ranges for transformed segments near the file start', () => {
    const renderPages = composeRenderPages([
        { segment_id: 4, display_text: 'alpha beta', source_start_offset: 4, source_end_offset: 14 },
        { segment_id: 4, display_text: 'gamma delta', source_start_offset: 20, source_end_offset: 31 },
    ], { maxCharactersPerPage: 12 })

    expect(findRenderPageForLocator(renderPages, {
        segment_id: 4,
        segment_local_start: 16,
    })).toBe(1)
})

function createSegmentWindow(start, count, overrides = {}) {
    return Array.from({ length: count }, (_, index) => {
        const segmentId = start + index
        const override = overrides[segmentId] || {}
        const text = override.text || `segment ${segmentId}`
        const baseOffset = override.start_offset ?? (segmentId * 10)
        return {
            segment_id: segmentId,
            text,
            start_offset: baseOffset,
            end_offset: override.end_offset ?? (baseOffset + text.length),
        }
    })
}

function createDisplayFragmentWindow(start, count, {
    segmentId = 0,
    baseOffset = 0,
    step = 18,
} = {}) {
    return Array.from({ length: count }, (_, index) => {
        const fragmentIndex = start + index
        const sourceStart = baseOffset + (fragmentIndex * step)
        return {
            segment_id: segmentId,
            display_text: `fragment ${String(fragmentIndex).padStart(3, '0')} text`,
            source_start_offset: sourceStart,
            source_end_offset: sourceStart + step - 1,
        }
    })
}

function createDeferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function countFetchCalls(fetchSpy, fragment) {
    return fetchSpy.mock.calls.filter(([url]) => String(url).includes(fragment)).length
}

function createMockSelection(range, { anchorNode = range.endContainer, anchorOffset = range.endOffset, focusNode = range.startContainer, focusOffset = range.startOffset } = {}) {
    range.getBoundingClientRect = () => ({
        left: 120,
        top: 120,
        bottom: 144,
        width: 80,
        height: 24,
        right: 200,
        x: 120,
        y: 120,
        toJSON: () => null,
    })

    return {
        rangeCount: 1,
        isCollapsed: false,
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
        getRangeAt: () => range,
        toString: () => range.toString(),
        removeAllRanges: vi.fn(),
    }
}

beforeEach(() => {
    mockUseKeyboardNav.mockReset()
    mockUseReaderSettings.mockImplementation(() => createSettings())
})

test('TXT reader fills one visible render page with multiple short segments on first load', async () => {
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 37, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                segments: [
                    { segment_id: 0, text: 'alpha block', start_offset: 0, end_offset: 11 },
                    { segment_id: 1, text: 'beta block', start_offset: 12, end_offset: 22 },
                    { segment_id: 2, text: 'overflow block', start_offset: 23, end_offset: 37 },
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

    const spread = await screen.findByTestId('txt-spread')
    const pageSurfaces = within(spread).getAllByTestId('txt-page-surface')

    expect(pageSurfaces).toHaveLength(1)
    expect(within(pageSurfaces[0]).getByText('alpha block')).toBeTruthy()
    expect(within(pageSurfaces[0]).getByText('beta block')).toBeTruthy()
    expect(within(pageSurfaces[0]).queryByText('overflow block')).toBeNull()
    expect(screen.queryByText('overflow block')).toBeNull()
    expect(screen.queryByTestId('txt-segment-card')).toBeNull()
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-manifest'))
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=0&limit=40'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/content'))
})

test('TXT reader renders a shared dual spread with two page surfaces and no segment cards', async () => {
    mockUseReaderSettings.mockImplementation(() => createSettings({ layout: 'dual' }))
    const segments = [
        { segment_id: 0, text: 'left page text', start_offset: 0, end_offset: 14 },
        { segment_id: 1, text: 'right page text', start_offset: 15, end_offset: 30 },
        { segment_id: 2, text: 'overflow spread text', start_offset: 31, end_offset: 50 },
    ]
    const expectedPages = buildExpectedMeasuredPages(segments)

    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 50, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                segments,
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

    const spread = await screen.findByTestId('txt-spread')
    const pageSurfaces = within(spread).getAllByTestId('txt-page-surface')

    expect(pageSurfaces).toHaveLength(2)
    expect(pageSurfaces[0].textContent).toBe(getMeasuredPageText(expectedPages[0]))
    expect(pageSurfaces[1].textContent).toBe(getMeasuredPageText(expectedPages[1]))
    expect(within(spread).queryByText(getMeasuredPageText(expectedPages[2]))).toBeNull()
    expect(screen.queryByTestId('txt-segment-card')).toBeNull()
})

test('TXT reader renders oversized content as measured slices instead of one clipped fragment block', async () => {
    const oversizedText = `${'A'.repeat(24)}${'B'.repeat(24)}${'C'.repeat(12)}`
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: oversizedText.length, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: oversizedText, start_offset: 0, end_offset: oversizedText.length },
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

    const spread = await screen.findByTestId('txt-spread')
    const pageSurface = within(spread).getByTestId('txt-page-surface')

    await waitFor(() => {
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
    })
    expect(pageSurface.textContent).toContain('A'.repeat(24))
    expect(pageSurface.textContent).not.toContain('B'.repeat(24))
    expect(pageSurface.textContent).not.toContain('C'.repeat(12))
})

test('TXT reader advances exactly one measured page from first load when next navigation fires', async () => {
    const oversizedText = `${'A'.repeat(24)}${'B'.repeat(24)}${'C'.repeat(12)}`
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: oversizedText.length, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: oversizedText, start_offset: 0, end_offset: oversizedText.length },
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

    await waitFor(() => {
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
        expect(screen.getByTestId('progress-current-page').textContent).toBe('1')
    })

    await act(async () => {
        mockUseKeyboardNav.mock.lastCall[0].onNext()
    })

    await waitFor(() => {
        expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
    })
    expect(screen.getByTestId('txt-reader-content').textContent).toContain('B'.repeat(24))
    expect(screen.getByTestId('txt-reader-content').textContent).not.toContain('A'.repeat(24))
})

test('TXT reader uses measured pages as the visible source of truth instead of whole-fragment grouping', async () => {
    const firstFragment = 'A'.repeat(18)
    const secondFragment = 'B'.repeat(18)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 36, segment_count: 2 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 2,
                segments: [
                    { segment_id: 0, text: firstFragment, start_offset: 0, end_offset: 18 },
                    { segment_id: 1, text: secondFragment, start_offset: 18, end_offset: 36 },
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

    await waitFor(() => {
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('2')
    })
    const firstPageText = screen.getByTestId('txt-page-surface').textContent ?? ''
    expect(firstPageText).toContain(firstFragment)
    expect(firstPageText).toContain('B'.repeat(6))
    expect(firstPageText).not.toContain(secondFragment)

    await act(async () => {
        mockUseKeyboardNav.mock.lastCall[0].onNext()
    })

    await waitFor(() => {
        expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
    })
    expect(screen.getByTestId('txt-page-surface').textContent).toBe('B'.repeat(12))
})

test('TXT reader keeps the first-load measured total stable while a later full-book page map hydrates', async () => {
    const oversizedText = `${'A'.repeat(24)}${'B'.repeat(24)}${'C'.repeat(12)}`
    const deferredWindow = createDeferred()
    const fetchSpy = vi.fn((url) => {
        if (String(url).includes('/txt-manifest')) {
            return Promise.resolve(new Response(JSON.stringify({ encoding: 'utf-8', total_chars: oversizedText.length, segment_count: 41 }), { status: 200 }))
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return Promise.resolve(new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 41,
                segments: [
                    { segment_id: 0, text: oversizedText, start_offset: 0, end_offset: oversizedText.length },
                ],
            }), { status: 200 }))
        }
        if (String(url).includes('/txt-segments?start=40&limit=40')) {
            return deferredWindow.promise
        }
        if (String(url).includes('/annotations')) {
            return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        if (String(url).includes('/search')) {
            return Promise.resolve(new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 }))
        }
        return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await waitFor(() => {
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
    })

    await userEvent.click(screen.getByRole('button', { name: 'seek-to-page-2' }))

    await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=40&limit=40'))
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
    })

    deferredWindow.resolve(new Response(JSON.stringify({
        start: 40,
        limit: 40,
        total: 41,
        segments: [
            { segment_id: 40, text: '', start_offset: oversizedText.length, end_offset: oversizedText.length },
        ],
    }), { status: 200 }))

    await waitFor(() => {
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
        expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
    })
})

test('search-result click opens the rendered page containing the target segment and scrolls to the match', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 1039, segment_count: 121 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 121,
                segments: [{ segment_id: 0, text: 'alpha block', start_offset: 0, end_offset: 11 }],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=40&limit=40')) {
            return new Response(JSON.stringify({
                start: 40,
                limit: 40,
                total: 121,
                segments: [{ segment_id: 40, text: 'filler forty', start_offset: 400, end_offset: 412 }],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=80&limit=40')) {
            return new Response(JSON.stringify({
                start: 80,
                limit: 40,
                total: 121,
                segments: [{ segment_id: 80, text: 'filler eighty', start_offset: 800, end_offset: 813 }],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=120&limit=40')) {
            return new Response(JSON.stringify({
                start: 120,
                limit: 40,
                total: 121,
                segments: [{ segment_id: 120, text: 'before target after', start_offset: 1000, end_offset: 1019 }],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=100&limit=40')) {
            return new Response(JSON.stringify({
                start: 100,
                limit: 40,
                total: 121,
                segments: [
                    { segment_id: 119, text: 'lead', start_offset: 995, end_offset: 999 },
                    { segment_id: 120, text: 'before target after', start_offset: 1000, end_offset: 1019 },
                    { segment_id: 121, text: 'overflow page text', start_offset: 1020, end_offset: 1038 },
                ],
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
        expect(screen.getByText('lead')).toBeTruthy()
    })
    await waitFor(() => {
        expect(document.querySelector('mark[data-active-search-mark="true"]')).toBeTruthy()
    })
})

test('far search jump stays on the target render page even before the full-book map finishes loading', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 1039, segment_count: 121 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(0, 40, {
                    0: { text: 'alpha block', start_offset: 0, end_offset: 11 },
                }),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=40&limit=40')) {
            return new Response(JSON.stringify({
                start: 40,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(40, 40),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=80&limit=40')) {
            return new Response(JSON.stringify({
                start: 80,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(80, 40, {
                    119: { text: 'lead', start_offset: 995, end_offset: 999 },
                }),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=120&limit=40')) {
            return new Response(JSON.stringify({
                start: 120,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(120, 1, {
                    120: { text: 'before target after', start_offset: 1000, end_offset: 1019 },
                }),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=100&limit=40')) {
            return new Response(JSON.stringify({
                start: 100,
                limit: 40,
                total: 121,
                segments: [
                    { segment_id: 119, text: 'lead', start_offset: 995, end_offset: 999 },
                    { segment_id: 120, text: 'before target after', start_offset: 1000, end_offset: 1019 },
                ],
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
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=40&limit=40'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=80&limit=40'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=120&limit=40'))
    await user.click(screen.getByTitle('search'))
    await user.type(screen.getByPlaceholderText('searchTextPlaceholder'), 'target')
    await user.click(screen.getAllByRole('button', { name: 'search' })[1])
    await waitFor(() => expect(screen.getByText('target')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /target/i }))

    await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=100&limit=40'))
    })
    await waitFor(() => expect(screen.getByText('lead')).toBeTruthy())
    expect(screen.queryByText('alpha block')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=40&limit=40'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=80&limit=40'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=120&limit=40'))
    expect(screen.getByText((_, element) => element?.textContent === 'before target after')).toBeTruthy()
    expect(screen.queryByText('alpha block')).toBeNull()
})

test('global render-page map can reuse the real zero window after a far jump before using page navigation', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 1039, segment_count: 121 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(0, 40, {
                    0: { text: 'alpha block', start_offset: 0, end_offset: 11 },
                }),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=40&limit=40')) {
            return new Response(JSON.stringify({
                start: 40,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(40, 40),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=80&limit=40')) {
            return new Response(JSON.stringify({
                start: 80,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(80, 40),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=120&limit=40')) {
            return new Response(JSON.stringify({
                start: 120,
                limit: 40,
                total: 121,
                segments: createSegmentWindow(120, 1, {
                    120: { text: 'before target after', start_offset: 1000, end_offset: 1019 },
                }),
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=100&limit=40')) {
            return new Response(JSON.stringify({
                start: 100,
                limit: 40,
                total: 121,
                segments: [
                    { segment_id: 119, text: 'lead', start_offset: 995, end_offset: 999 },
                    { segment_id: 120, text: 'before target after', start_offset: 1000, end_offset: 1019 },
                ],
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
    await waitFor(() => expect(screen.getByText('lead')).toBeTruthy())
    expect(countFetchCalls(fetchSpy, '/txt-segments?start=0&limit=40')).toBe(1)

    await user.click(screen.getByRole('button', { name: 'seek-to-page-2' }))

    await waitFor(() => {
        expect(countFetchCalls(fetchSpy, '/txt-segments?start=0&limit=40')).toBe(1)
        expect(countFetchCalls(fetchSpy, '/txt-segments?start=40&limit=40')).toBe(1)
        expect(countFetchCalls(fetchSpy, '/txt-segments?start=80&limit=40')).toBe(1)
        expect(countFetchCalls(fetchSpy, '/txt-segments?start=120&limit=40')).toBe(1)
    })
})

test('keyboard navigation next callback moves TXT reader to the next visible viewport page', async () => {
    const segments = [
        { segment_id: 0, text: 'page zero body', start_offset: 0, end_offset: 14 },
        { segment_id: 1, text: 'page one body', start_offset: 15, end_offset: 28 },
    ]
    const expectedPages = buildExpectedMeasuredPages(segments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 28, segment_count: 2 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 2,
                segments,
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

    await waitFor(() => expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedPages[1])))
    expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
    expect(screen.queryByText('page zero body')).toBeNull()
})

test('progress bar uses render-page totals and seeks by render-page progress', async () => {
    const user = userEvent.setup()
    const segments = [
        { segment_id: 0, text: 'alpha', start_offset: 0, end_offset: 5 },
        { segment_id: 1, text: 'beta window', start_offset: 6, end_offset: 17 },
        { segment_id: 2, text: 'gamma overflow', start_offset: 18, end_offset: 32 },
    ]
    const expectedPages = buildExpectedMeasuredPages(segments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 32, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                segments,
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

    await screen.findByText('alpha')
    expect(screen.getByTestId('progress-current-page').textContent).toBe('1')
    expect(screen.getByTestId('progress-total-pages').textContent).toBe('2')
    expect(screen.getByTestId('progress-value').textContent).toBe('0')

    await user.click(screen.getByRole('button', { name: 'seek-to-progress-mid' }))

    await waitFor(() => expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedPages[1])))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.queryByText('beta window')).toBeNull()
    expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
    expect(screen.getByTestId('progress-total-pages').textContent).toBe('2')
    expect(screen.getByTestId('progress-value').textContent).toBe('1')
})

test('trimSpaces updates TXT pagination totals and grouping to match transformed display text', async () => {
    const user = userEvent.setup()
    const rawSegments = [
        { segment_id: 0, text: 'alpha          beta', start_offset: 0, end_offset: 20 },
        { segment_id: 1, text: 'gamma', start_offset: 21, end_offset: 26 },
    ]
    const transformedFragments = [
        { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 20 },
        { segment_id: 1, display_text: 'gamma', source_start_offset: 21, source_end_offset: 26 },
    ]
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 41, segment_count: 2 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 2,
                segments: rawSegments,
                display_fragments: transformedFragments,
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 2,
                segments: rawSegments,
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

    const spread = await screen.findByTestId('txt-spread')
    const firstPageSurface = within(spread).getAllByTestId('txt-page-surface')[0]
    expect(firstPageSurface.textContent).toContain('alpha          beta')
    expect(screen.getByTestId('progress-total-pages').textContent).toBe(String(buildExpectedMeasuredPages(rawSegments).length))
    expect(within(spread).getAllByTestId('txt-page-surface')).toHaveLength(1)
    expect(within(spread).getByText('gamma')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))

    await waitFor(() => expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(buildExpectedMeasuredPages(transformedFragments)[0])))
    await waitFor(() => expect(screen.getByText('gamma')).toBeTruthy())
    expect(screen.getByTestId('progress-total-pages').textContent).toBe('1')
    expect(within(screen.getByTestId('txt-spread')).getAllByTestId('txt-page-surface')).toHaveLength(1)
})

test('splitParagraphs page seeks distinguish later transformed fragments from the same source segment', async () => {
    const user = userEvent.setup()
    const transformedFragments = [
        { segment_id: 0, display_text: 'first fragment text!!', source_start_offset: 0, source_end_offset: 21 },
        { segment_id: 0, display_text: 'second fragment text!', source_start_offset: 21, source_end_offset: 42 },
        { segment_id: 0, display_text: 'third fragment text!!', source_start_offset: 42, source_end_offset: 62 },
    ]
    const expectedPages = buildExpectedMeasuredPages(transformedFragments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest?trim_spaces=false&remove_empty_lines=false&split_paragraphs=false')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 62, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-manifest?trim_spaces=false&remove_empty_lines=false&split_paragraphs=true')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 62, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=false&remove_empty_lines=false&split_paragraphs=false')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'first fragment text!! second fragment text! third fragment text!!', start_offset: 0, end_offset: 62 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=false&remove_empty_lines=false&split_paragraphs=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                segments: [
                    { segment_id: 0, text: 'first fragment text!! second fragment text! third fragment text!!', start_offset: 0, end_offset: 62 },
                ],
                display_fragments: transformedFragments,
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

    await waitFor(() => {
        expect(screen.getByTestId('txt-reader-content').textContent).toContain('first fragment text!! se')
    })
    await user.click(screen.getByRole('button', { name: 'splitParagraphs' }))

    await waitFor(() => {
        expect(screen.getByText('first fragment text!!')).toBeTruthy()
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('3')
    })

    await user.click(screen.getByRole('button', { name: 'seek-to-page-3' }))

    await waitFor(() => {
        expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedPages[2]))
    })
    expect(screen.queryByText('first fragment text!!')).toBeNull()
    expect(screen.queryByText('second fragment text!')).toBeNull()
    expect(screen.getByTestId('progress-current-page').textContent).toBe('3')
})

test('splitParagraphs progress seeks load transformed windows by display-fragment position instead of raw segment id', async () => {
    const user = userEvent.setup()
    const initialDisplayFragments = createDisplayFragmentWindow(0, 40)
    const fullDisplayFragments = createDisplayFragmentWindow(0, 81)
    const targetWindowDisplayFragments = createDisplayFragmentWindow(40, 40)
    const expectedInitialPages = buildExpectedMeasuredPages(initialDisplayFragments)
    const expectedGlobalPages = buildExpectedMeasuredPages(fullDisplayFragments)
    const expectedTargetWindowPages = buildExpectedMeasuredPages(targetWindowDisplayFragments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest?trim_spaces=false&remove_empty_lines=false&split_paragraphs=false')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 1458, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-manifest?trim_spaces=false&remove_empty_lines=false&split_paragraphs=true')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 1458, segment_count: 81 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=false&remove_empty_lines=false&split_paragraphs=false')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'raw combined segment text', start_offset: 0, end_offset: 1458 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=false&remove_empty_lines=false&split_paragraphs=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 81,
                segments: [
                    { segment_id: 0, text: 'raw combined segment text', start_offset: 0, end_offset: 1458 },
                ],
                display_fragments: initialDisplayFragments,
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=40&limit=40&trim_spaces=false&remove_empty_lines=false&split_paragraphs=true')) {
            return new Response(JSON.stringify({
                start: 40,
                limit: 40,
                total: 81,
                segments: [
                    { segment_id: 0, text: 'raw combined segment text', start_offset: 0, end_offset: 1458 },
                ],
                display_fragments: targetWindowDisplayFragments,
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=80&limit=40&trim_spaces=false&remove_empty_lines=false&split_paragraphs=true')) {
            return new Response(JSON.stringify({
                start: 80,
                limit: 40,
                total: 81,
                segments: [
                    { segment_id: 0, text: 'raw combined segment text', start_offset: 0, end_offset: 1458 },
                ],
                display_fragments: createDisplayFragmentWindow(80, 1),
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

    await waitFor(() => {
        expect(screen.getByTestId('txt-reader-content').textContent).toContain('raw combined segment tex')
    })
    await user.click(screen.getByRole('button', { name: 'splitParagraphs' }))

    await waitFor(() => {
        expect(screen.getByText('fragment 000 text')).toBeTruthy()
        expect(screen.getByTestId('progress-total-pages').textContent).toBe(String(expectedInitialPages.length))
    })

    await user.click(screen.getByRole('button', { name: 'seek-to-progress-mid' }))

    await waitFor(() => {
        expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedTargetWindowPages[0]))
    })
    expect(screen.queryByText('fragment 000 text')).toBeNull()
    expect(screen.getByTestId('progress-current-page').textContent).toBe('30')
    expect(screen.getByTestId('progress-total-pages').textContent).toBe(String(expectedGlobalPages.length))
})

test('changing TXT transform options refetches the manifest with compatibility parameters', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({
                encoding: 'utf-8',
                total_chars: 20,
                segment_count: 1,
                segments: [],
                display_fragments: [],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha    beta', start_offset: 0, end_offset: 13 },
                ],
                display_fragments: [
                    { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 13 },
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

    await waitFor(() => {
        expect(screen.getByTestId('txt-page-surface').textContent).toContain('alpha    beta')
    })
    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))

    await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-manifest?trim_spaces=true'))
    })
})

test('compatibility-mode search refetches with the active TXT transform parameters', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({
                encoding: 'utf-8',
                total_chars: 20,
                segment_count: 1,
                segments: [],
                display_fragments: [],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha    beta', start_offset: 0, end_offset: 13 },
                ],
                display_fragments: [
                    { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 13 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha    beta', start_offset: 0, end_offset: 13 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({
                query: 'beta',
                total: 1,
                results: [{
                    index: 0,
                    locator: 'segment:0:offset:8',
                    segment_id: 0,
                    segment_local_start: 8,
                    segment_local_end: 12,
                    snippet: 'alpha beta',
                }],
            }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => expect(screen.getByText('alpha beta')).toBeTruthy())

    await user.click(screen.getByTitle('search'))
    await user.type(screen.getByPlaceholderText('searchTextPlaceholder'), 'beta')
    await user.click(screen.getAllByRole('button', { name: 'search' })[1])

    await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/search?q=beta&trim_spaces=true&remove_empty_lines=true&split_paragraphs=false'))
    })
})

test('compatibility transforms render multiple display fragments for one source segment as separate reader blocks', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 48, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
                display_fragments: [
                    { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 10 },
                    { segment_id: 0, display_text: 'gamma delta', source_start_offset: 11, source_end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
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

    await waitFor(() => {
        expect(screen.getByTestId('txt-page-surface').textContent).toContain('alpha beta gamma delta')
    })

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))

    await waitFor(() => {
        expect(screen.getByTestId('txt-page-surface').textContent).toContain('alpha beta')
        expect(screen.getByTestId('txt-page-surface').textContent).toContain('gamma delta')
    })

    const fragmentNodes = document.querySelectorAll('[data-segment-id="0"]')
    expect(fragmentNodes).toHaveLength(2)
    expect(fragmentNodes[0]?.textContent).toBe('alpha beta')
    expect(fragmentNodes[1]?.textContent).toBe('gamma delta')
})

test('search targeting highlights the later transformed fragment when a locator lands beyond the first fragment', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 48, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
                display_fragments: [
                    { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 10 },
                    { segment_id: 0, display_text: 'gamma delta', source_start_offset: 11, source_end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search?q=delta')) {
            return new Response(JSON.stringify({
                query: 'delta',
                total: 1,
                results: [{
                    index: 0,
                    locator: 'segment:0:offset:17',
                    segment_id: 0,
                    segment_local_start: 17,
                    segment_local_end: 22,
                    snippet: 'delta',
                }],
            }), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => {
        expect(screen.getByText('gamma delta')).toBeTruthy()
    })
    await user.click(screen.getByTitle('search'))
    await user.type(screen.getByPlaceholderText('searchTextPlaceholder'), 'delta')
    await user.click(screen.getAllByRole('button', { name: 'search' })[1])
    await waitFor(() => expect(screen.getByText('delta')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /delta/i }))

    await waitFor(() => {
        const activeMark = document.querySelector('mark[data-active-search-mark="true"]')
        expect(activeMark).toBeTruthy()
        expect(activeMark?.closest('[data-segment-start="11"]')?.textContent).toContain('gamma delta')
        expect(activeMark?.textContent).toBe('delta')
    })
})

test('search targeting resolves later transformed fragments for nonzero-start source segments', async () => {
    const user = userEvent.setup()
    const displayFragments = [
        { segment_id: 4, display_text: 'alpha beta gamma', source_start_offset: 100, source_end_offset: 116 },
        { segment_id: 4, display_text: 'delta epsilon', source_start_offset: 116, source_end_offset: 129 },
        { segment_id: 5, display_text: 'omega tail', source_start_offset: 129, source_end_offset: 139 },
    ]
    const expectedPages = buildExpectedMeasuredPages(displayFragments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 48, segment_count: 2 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 2,
                segments: [
                    { segment_id: 4, text: 'alpha beta gamma delta epsilon', start_offset: 100, end_offset: 129 },
                    { segment_id: 5, text: 'omega tail', start_offset: 129, end_offset: 139 },
                ],
                display_fragments: displayFragments,
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 2,
                segments: [
                    { segment_id: 4, text: 'alpha beta gamma delta epsilon', start_offset: 100, end_offset: 129 },
                    { segment_id: 5, text: 'omega tail', start_offset: 129, end_offset: 139 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search?q=delta')) {
            return new Response(JSON.stringify({
                query: 'delta',
                total: 1,
                results: [{
                    index: 0,
                    locator: 'segment:4:offset:16',
                    segment_id: 4,
                    segment_local_start: 16,
                    segment_local_end: 21,
                    snippet: 'delta epsilon',
                }],
            }), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => expect(screen.getByText('alpha beta gamma')).toBeTruthy())

    await user.click(screen.getByTitle('search'))
    await user.type(screen.getByPlaceholderText('searchTextPlaceholder'), 'delta')
    await user.click(screen.getAllByRole('button', { name: 'search' })[1])
    await waitFor(() => expect(screen.getByText('delta')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /delta epsilon/i }))

    await waitFor(() => {
        expect(screen.getByTestId('progress-current-page').textContent).toBe('1')
        expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedPages[0]))
        const activeMark = document.querySelector('mark[data-active-search-mark="true"]')
        expect(activeMark).toBeTruthy()
        expect(activeMark?.textContent).toBe('delta')
        expect(activeMark?.closest('[data-segment-start="116"]')?.textContent).toContain('delta ep')
    })
})

test('search targeting maps compacted whitespace matches into transformed display positions', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 13, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha    beta', start_offset: 0, end_offset: 13 },
                ],
                display_fragments: [
                    {
                        segment_id: 0,
                        display_text: 'alpha beta',
                        source_start_offset: 0,
                        source_end_offset: 13,
                        display_to_source: [0, 1, 2, 3, 4, 5, 8, 9, 10, 11],
                    },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha    beta', start_offset: 0, end_offset: 13 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([]), { status: 200 })
        }
        if (String(url).includes('/search?q=beta')) {
            return new Response(JSON.stringify({
                query: 'beta',
                total: 1,
                results: [{
                    index: 0,
                    locator: 'segment:0:offset:8',
                    segment_id: 0,
                    segment_local_start: 8,
                    segment_local_end: 12,
                    start_offset: 8,
                    end_offset: 12,
                    snippet: 'beta',
                }],
            }), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => {
        expect(screen.getByText('alpha beta')).toBeTruthy()
    })
    await user.click(screen.getByTitle('search'))
    await user.type(screen.getByPlaceholderText('searchTextPlaceholder'), 'beta')
    await user.click(screen.getAllByRole('button', { name: 'search' })[1])
    await waitFor(() => expect(screen.getByText('beta')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: /beta/i }))

    await waitFor(() => {
        const activeMark = document.querySelector('mark[data-active-search-mark="true"]')
        expect(activeMark).toBeTruthy()
        expect(activeMark?.textContent).toBe('beta')
    })
})

test('annotation highlighting targets the later transformed fragment using source-segment-relative offsets', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 48, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
                display_fragments: [
                    { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 10 },
                    { segment_id: 0, display_text: 'gamma delta', source_start_offset: 11, source_end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([
                {
                    id: 'later-fragment-annotation',
                    snippet: 'later fragment annotation',
                    segment_id: 0,
                    segment_local_start: 17,
                    segment_local_end: 22,
                    start_offset: 17,
                    end_offset: 22,
                    kind: 'highlight',
                },
            ]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => {
        expect(screen.getByText('gamma delta')).toBeTruthy()
    })
    await user.click(screen.getByTitle('annotations'))

    await waitFor(() => {
        expect(screen.getByRole('button', { name: /later fragment annotation/i })).toBeTruthy()
    })

    await waitFor(() => {
        const annotationNode = document.querySelector('span[data-bookreader-annotation-id="later-fragment-annotation"]')
        expect(annotationNode).toBeTruthy()
        expect(annotationNode?.closest('[data-segment-start="11"]')?.textContent).toContain('gamma delta')
        expect(annotationNode?.textContent).toBe('delta')
    })
})

test('annotation highlighting preserves transformed ranges that span multiple display fragments', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 48, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
                display_fragments: [
                    {
                        segment_id: 0,
                        display_text: 'alpha beta',
                        source_start_offset: 0,
                        source_end_offset: 10,
                        display_to_source: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                    },
                    {
                        segment_id: 0,
                        display_text: 'gamma delta',
                        source_start_offset: 11,
                        source_end_offset: 22,
                        display_to_source: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
                    },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([
                {
                    id: 'cross-fragment-annotation',
                    snippet: 'cross fragment annotation',
                    segment_id: 0,
                    segment_local_start: 6,
                    segment_local_end: 16,
                    start_offset: 6,
                    end_offset: 16,
                    kind: 'highlight',
                },
            ]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => {
        expect(screen.getByText('alpha beta')).toBeTruthy()
        expect(screen.getByText('gamma delta')).toBeTruthy()
    })

    await user.click(screen.getByTitle('annotations'))

    await waitFor(() => {
        expect(screen.getByRole('button', { name: /cross fragment annotation/i })).toBeTruthy()
    })

    await waitFor(() => {
        const annotationNodes = document.querySelectorAll('span[data-bookreader-annotation-id="cross-fragment-annotation"]')
        expect(annotationNodes).toHaveLength(2)
        expect(Array.from(annotationNodes).map((node) => node.textContent)).toEqual(['beta', 'gamma'])
    })
})

test('backward transformed selection recovers source offsets from normalized range boundaries when creating an annotation', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn(async (url, options = {}) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 48, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
                display_fragments: [
                    {
                        segment_id: 0,
                        display_text: 'alpha beta',
                        source_start_offset: 0,
                        source_end_offset: 10,
                        display_to_source: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                    },
                    {
                        segment_id: 0,
                        display_text: 'gamma delta',
                        source_start_offset: 11,
                        source_end_offset: 22,
                        display_to_source: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
                    },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma delta', start_offset: 0, end_offset: 22 },
                ],
            }), { status: 200 })
        }
        if (String(url).includes('/annotations') && options.method === 'POST') {
            const payload = JSON.parse(options.body)
            return new Response(JSON.stringify({ id: 'created-highlight', ...payload }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

    const getSelectionSpy = vi.spyOn(window, 'getSelection')

    try {
        renderReader()

        await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
        await waitFor(() => {
            expect(screen.getByText('alpha beta')).toBeTruthy()
            expect(screen.getByText('gamma delta')).toBeTruthy()
        })

        const fragmentNodes = document.querySelectorAll('[data-segment-id="0"]')
        const firstTextNode = fragmentNodes[0]?.firstChild
        const secondTextNode = fragmentNodes[1]?.firstChild
        expect(firstTextNode?.textContent).toBe('alpha beta')
        expect(secondTextNode?.textContent).toBe('gamma delta')

        const range = document.createRange()
        range.setStart(firstTextNode, 6)
        range.setEnd(secondTextNode, 5)
        const selection = createMockSelection(range, {
            anchorNode: secondTextNode,
            anchorOffset: 5,
            focusNode: firstTextNode,
            focusOffset: 6,
        })
        getSelectionSpy.mockImplementation(() => selection)

        await act(async () => {
            document.dispatchEvent(new Event('selectionchange'))
        })

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'create-highlight' })).toBeTruthy()
        })

        await user.click(screen.getByRole('button', { name: 'create-highlight' }))

        await waitFor(() => {
            const postCall = fetchSpy.mock.calls.find(([url, options]) => (
                String(url).includes('/annotations') && options?.method === 'POST'
            ))
            expect(postCall).toBeTruthy()
            const payload = JSON.parse(postCall[1].body)
            expect(payload.segment_id).toBe(0)
            expect(payload.segment_local_start).toBe(6)
            expect(payload.segment_local_end).toBe(16)
            expect(payload.start_offset).toBe(6)
            expect(payload.end_offset).toBe(16)
            expect(payload.locator).toBe('segment:0:offset:6')
        })
    } finally {
        getSelectionSpy.mockRestore()
    }
})

test('TXT reader delays selection menu updates until pointerup during drag selection', async () => {
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 18, segment_count: 1 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha beta gamma', start_offset: 0, end_offset: 16 },
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

    const getSelectionSpy = vi.spyOn(window, 'getSelection')

    try {
        renderReader()

        const segmentNode = await screen.findByText('alpha beta gamma')
        const textNode = segmentNode.firstChild
        const range = document.createRange()
        range.setStart(textNode, 6)
        range.setEnd(textNode, 10)
        const selection = createMockSelection(range)
        getSelectionSpy.mockImplementation(() => selection)

        await act(async () => {
            screen.getByTestId('txt-reader-content').dispatchEvent(new Event('pointerdown', { bubbles: true }))
            document.dispatchEvent(new Event('selectionchange'))
        })

        expect(screen.queryByRole('button', { name: 'create-highlight' })).toBeNull()

        await act(async () => {
            window.dispatchEvent(new Event('pointerup', { bubbles: true }))
        })

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'create-highlight' })).toBeTruthy()
        })
    } finally {
        getSelectionSpy.mockRestore()
    }
})

test('stale lazy global render-page loads do not apply after the reader switches books', async () => {
    const user = userEvent.setup()
    const deferredWindow = createDeferred()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchSpy = vi.fn((url) => {
        if (String(url).includes('/txt-1/txt-manifest')) {
            return Promise.resolve(new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 61, segment_count: 41 }), { status: 200 }))
        }
        if (String(url).includes('/txt-1/txt-segments?start=0&limit=40')) {
            return Promise.resolve(new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 41,
                segments: [
                    { segment_id: 0, text: 'abcdefghijklmnopqrst', start_offset: 0, end_offset: 20 },
                ],
            }), { status: 200 }))
        }
        if (String(url).includes('/txt-1/txt-segments?start=40&limit=40')) {
            return deferredWindow.promise
        }
        if (String(url).includes('/txt-2/txt-manifest')) {
            return Promise.resolve(new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 12, segment_count: 1 }), { status: 200 }))
        }
        if (String(url).includes('/txt-2/txt-segments?start=0&limit=40')) {
            return Promise.resolve(new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'book two', start_offset: 0, end_offset: 8 },
                ],
            }), { status: 200 }))
        }
        if (String(url).includes('/annotations')) {
            return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        if (String(url).includes('/search')) {
            return Promise.resolve(new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 }))
        }
        return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
        renderReaderWithRouteControls()

        await screen.findByText('abcdefghijklmnopqrst')
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('1')

        await user.click(screen.getByRole('button', { name: 'seek-to-page-2' }))
        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-1/txt-segments?start=40&limit=40'))
        })

        await user.click(screen.getByRole('button', { name: 'open-book-2' }))
        await screen.findByText('book two')
        expect(screen.getByTestId('progress-total-pages').textContent).toBe('1')

        deferredWindow.resolve(new Response(JSON.stringify({
            start: 40,
            limit: 40,
            total: 41,
            segments: [
                { segment_id: 40, text: 'uvwxyzabcd', start_offset: 50, end_offset: 60 },
            ],
        }), { status: 200 }))

        await waitFor(() => {
            expect(screen.getByText('book two')).toBeTruthy()
            expect(screen.getByTestId('progress-total-pages').textContent).toBe('1')
        })
        expect(screen.queryByText('abcdefghijklmnopqrst')).toBeNull()
        expect(screen.queryByText('uvwxyzabcd')).toBeNull()
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
            'Failed to navigate TXT render page',
            expect.anything(),
        )
    } finally {
        consoleErrorSpy.mockRestore()
    }
})

test('stale TXT segment-window responses are ignored after a transform toggle resets the reader state', async () => {
    const user = userEvent.setup()
    const deferredRawWindow = createDeferred()
    const fetchSpy = vi.fn((url) => {
        if (String(url).includes('/txt-manifest?trim_spaces=false')) {
            return Promise.resolve(new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 61, segment_count: 41 }), { status: 200 }))
        }
        if (String(url).includes('/txt-manifest?trim_spaces=true')) {
            return Promise.resolve(new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 20, segment_count: 1 }), { status: 200 }))
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=false')) {
            return deferredRawWindow.promise
        }
        if (String(url).includes('/txt-segments?start=0&limit=40&trim_spaces=true')) {
            return Promise.resolve(new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 1,
                segments: [
                    { segment_id: 0, text: 'alpha    beta', start_offset: 0, end_offset: 13 },
                ],
                display_fragments: [
                    { segment_id: 0, display_text: 'alpha beta', source_start_offset: 0, source_end_offset: 13 },
                ],
            }), { status: 200 }))
        }
        if (String(url).includes('/annotations')) {
            return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        if (String(url).includes('/search')) {
            return Promise.resolve(new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 }))
        }
        return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/txt-segments?start=0&limit=40&trim_spaces=false'))
    })

    await user.click(screen.getByRole('button', { name: 'trimSpaces' }))
    await waitFor(() => {
        expect(screen.getByText('alpha beta')).toBeTruthy()
    })

    deferredRawWindow.resolve(new Response(JSON.stringify({
        start: 0,
        limit: 40,
        total: 41,
        segments: [
            { segment_id: 0, text: 'stale raw window', start_offset: 0, end_offset: 16 },
        ],
    }), { status: 200 }))

    await waitFor(() => {
        expect(screen.getByText('alpha beta')).toBeTruthy()
    })
    expect(screen.queryByText('stale raw window')).toBeNull()
})

test('annotation click treats page locator strings as render-page indexes', async () => {
    const user = userEvent.setup()
    const segments = [
        { segment_id: 0, text: 'alpha', start_offset: 0, end_offset: 5 },
        { segment_id: 1, text: 'beta window', start_offset: 6, end_offset: 17 },
        { segment_id: 2, text: 'gamma overflow', start_offset: 18, end_offset: 32 },
    ]
    const expectedPages = buildExpectedMeasuredPages(segments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 32, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                segments,
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([
                { id: 'page-string', snippet: 'jump with string page', locator: 'page:1' },
            ]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await screen.findByText('alpha')
    await user.click(screen.getByTitle('annotations'))
    await user.click(screen.getByRole('button', { name: /jump with string page/i }))

    await waitFor(() => expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedPages[1])))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.queryByText('beta window')).toBeNull()
    expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
})

test('annotation click treats object page locators as render-page indexes', async () => {
    const user = userEvent.setup()
    const segments = [
        { segment_id: 0, text: 'alpha', start_offset: 0, end_offset: 5 },
        { segment_id: 1, text: 'beta window', start_offset: 6, end_offset: 17 },
        { segment_id: 2, text: 'gamma overflow', start_offset: 18, end_offset: 32 },
    ]
    const expectedPages = buildExpectedMeasuredPages(segments)
    const fetchSpy = vi.fn(async (url) => {
        if (String(url).includes('/txt-manifest')) {
            return new Response(JSON.stringify({ encoding: 'utf-8', total_chars: 32, segment_count: 3 }), { status: 200 })
        }
        if (String(url).includes('/txt-segments?start=0&limit=40')) {
            return new Response(JSON.stringify({
                start: 0,
                limit: 40,
                total: 3,
                segments,
            }), { status: 200 })
        }
        if (String(url).includes('/annotations')) {
            return new Response(JSON.stringify([
                { id: 'page-object', snippet: 'jump with object page', page: 1 },
            ]), { status: 200 })
        }
        if (String(url).includes('/search')) {
            return new Response(JSON.stringify({ query: '', total: 0, results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderReader()

    await screen.findByText('alpha')
    await user.click(screen.getByTitle('annotations'))
    await user.click(screen.getByRole('button', { name: /jump with object page/i }))

    await waitFor(() => expect(screen.getByTestId('txt-page-surface').textContent).toBe(getMeasuredPageText(expectedPages[1])))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.queryByText('beta window')).toBeNull()
    expect(screen.getByTestId('progress-current-page').textContent).toBe('2')
})
