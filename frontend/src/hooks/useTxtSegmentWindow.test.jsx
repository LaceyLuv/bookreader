import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useTxtSegmentWindow } from './useTxtSegmentWindow'

const jsonResponse = (payload) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
})

afterEach(() => {
    vi.unstubAllGlobals()
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
