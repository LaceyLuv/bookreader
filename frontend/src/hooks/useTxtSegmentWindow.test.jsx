import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { classifyTxtLoadError, useTxtSegmentWindow } from './useTxtSegmentWindow'

const jsonResponse = (payload) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
})

const createDeferred = () => {
    let resolve
    const promise = new Promise((resolver) => { resolve = resolver })
    return { promise, resolve }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

test('classifies every terminal TXT content error state', () => {
    const unsupported = new Error('unsupported')
    unsupported.status = 415
    const missing = new Error('missing')
    missing.status = 404
    const aborted = new DOMException('aborted', 'AbortError')

    expect(classifyTxtLoadError(unsupported)).toBe('unsupported')
    expect(classifyTxtLoadError(missing)).toBe('fatal_error')
    expect(classifyTxtLoadError(aborted)).toBe('cancelled')
    expect(classifyTxtLoadError(new Error('network'))).toBe('recoverable_error')
})

test('finishes an empty TXT load without treating it as an error', async () => {
    const fetchMock = vi.fn((url) => {
        if (url.includes('txt-manifest')) return jsonResponse({ segment_count: 0, total_chars: 0 })
        return jsonResponse({ display_fragments: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useTxtSegmentWindow('empty-book'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.contentStatus).toBe('empty')
    expect(result.current.error).toBeNull()
})

test('deduplicates concurrent window requests and evicts least-recently-used windows', async () => {
    const fetchMock = vi.fn((url) => {
        if (url.includes('txt-manifest')) return jsonResponse({ segment_count: 500 })
        const start = Number(new URL(url, 'http://localhost').searchParams.get('start'))
        return jsonResponse({
            display_fragments: [{ segment_id: start, display_text: `segment ${start}` }],
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useTxtSegmentWindow('book-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
        const first = result.current.loadWindow(40)
        const duplicate = result.current.loadWindow(40)
        await Promise.all([first, duplicate])
    })
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('start=40'))).toHaveLength(1)

    for (const start of [80, 120, 160, 200]) {
        await act(async () => { await result.current.loadWindow(start) })
    }
    await act(async () => { await result.current.loadWindow(0) })

    // Window 0 was the least recently used after five newer entries and must
    // be fetched again instead of growing the cache without bound.
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('start=0&'))).toHaveLength(2)
})

test('aborts outstanding requests when the book changes', async () => {
    const segmentSignals = []
    const fetchMock = vi.fn((url, options = {}) => {
        if (url.includes('book-2')) return new Promise(() => {})
        if (url.includes('txt-manifest')) return jsonResponse({ segment_count: 500 })
        segmentSignals.push(options.signal)
        return new Promise(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(({ bookId }) => useTxtSegmentWindow(bookId), {
        initialProps: { bookId: 'book-1' },
    })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('txt-segments'))).toBe(true))
    const firstSignal = segmentSignals[0]
    expect(firstSignal.aborted).toBe(false)

    act(() => rerender({ bookId: 'book-2' }))
    expect(firstSignal.aborted).toBe(true)
    expect(result.current.visibleSegments).toEqual([])
})

test('ignores a stale manifest that resolves after a newer book is ready', async () => {
    const staleManifest = createDeferred()
    const fetchMock = vi.fn((url) => {
        if (url.includes('book-1') && url.includes('txt-manifest')) return staleManifest.promise
        if (url.includes('book-2') && url.includes('txt-manifest')) return jsonResponse({ segment_count: 0, total_chars: 0 })
        if (url.includes('book-2') && url.includes('txt-segments')) return jsonResponse({ display_fragments: [] })
        return jsonResponse({ display_fragments: [{ segment_id: 99, display_text: 'stale' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(({ bookId }) => useTxtSegmentWindow(bookId), {
        initialProps: { bookId: 'book-1' },
    })
    rerender({ bookId: 'book-2' })
    await waitFor(() => expect(result.current.contentStatus).toBe('empty'))

    await act(async () => {
        staleManifest.resolve({ ok: true, json: () => Promise.resolve({ segment_count: 1, total_chars: 5 }) })
        await Promise.resolve()
    })

    expect(result.current.manifest.segment_count).toBe(0)
    expect(result.current.readyContentKey).toContain('book-2:')
    expect(fetchMock.mock.calls.some(([url]) => url.includes('book-1') && url.includes('txt-segments'))).toBe(false)
})
