// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { removeBookProgress, useReadingProgress } from './useReadingProgress'

beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
})

afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
})

test('prefers newer backend progress then dual-writes locator and bookmarks', async () => {
    localStorage.setItem('bookreader_progress', JSON.stringify({
        'epub-1': {
            position: 1, totalPages: 8, type: 'epub', bookmarks: [],
            updatedAt: '2026-01-01T00:00:00.000Z',
        },
    }))
    const requests = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options = {}) => {
        requests.push(options)
        if (!options.method) {
            return {
                status: 200,
                ok: true,
                json: async () => ({
                    position: 3, totalPages: 8, type: 'epub', percent: 50,
                    bookmarks: [{ position: 2 }],
                    locator: { version: 1, kind: 'epub', chapterHref: 'chapter-3.xhtml', chapterIndex: 3 },
                    updatedAt: '2026-07-01T00:00:00.000Z',
                }),
            }
        }
        return { ok: true, status: 200 }
    }))

    const locator = { kind: 'epub', chapterHref: 'chapter-3.xhtml', chapterIndex: 3, chapterPage: 2 }
    const { result } = renderHook(() => useReadingProgress('epub-1', {
        totalPages: 8, type: 'epub', locator,
    }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(result.current.currentPosition).toBe(3)
    expect(result.current.bookmarks).toEqual([{ position: 2 }])
    act(() => {
        result.current.addBookmark()
    })
    act(() => {
        vi.advanceTimersByTime(200)
    })
    await act(async () => { await Promise.resolve() })

    const put = requests.find((options) => options.method === 'PUT')
    const written = JSON.parse(put.body)
    expect(written.locator).toEqual({ version: 1, ...locator })
    expect(written.bookmarks.at(-1).locator).toEqual({ version: 1, ...locator })
})

test('restored progress is clamped when pagination shrinks after layout changes', async () => {
    localStorage.setItem('bookreader_progress', JSON.stringify({
        'txt-1': {
            position: 12,
            totalPages: 20,
            type: 'txt',
            percent: 65,
            bookmarks: [],
        },
    }))

    const { result } = renderHook(() => useReadingProgress('txt-1', { totalPages: 5, type: 'txt' }))
    await act(async () => { await Promise.resolve() })

    expect(result.current.resumePrompt.position).toBe(4)

    act(() => {
        result.current.resumeReading()
        vi.runOnlyPendingTimers()
    })

    expect(result.current.currentPosition).toBe(4)
})

test('hydrates position and preserves saved data until pagination is ready', async () => {
    localStorage.setItem('bookreader_progress', JSON.stringify({
        'txt-1': {
            position: 12,
            totalPages: 20,
            type: 'txt',
            percent: 65,
            bookmarks: [{ position: 12 }, { position: 18 }],
        },
    }))

    const { result, rerender } = renderHook(
        ({ totalPages, paginationReady }) => useReadingProgress('txt-1', {
            totalPages,
            type: 'txt',
            paginationReady,
        }),
        { initialProps: { totalPages: 1, paginationReady: false } },
    )
    await act(async () => { await Promise.resolve() })

    expect(result.current.currentPosition).toBe(12)
    expect(result.current.bookmarks).toEqual([{ position: 12 }, { position: 18 }])

    act(() => {
        vi.runOnlyPendingTimers()
    })
    expect(JSON.parse(localStorage.getItem('bookreader_progress'))['txt-1'].position).toBe(12)

    act(() => {
        rerender({ totalPages: 5, paginationReady: true })
    })
    expect(result.current.currentPosition).toBe(4)
    expect(result.current.bookmarks).toEqual([])

    act(() => {
        vi.runOnlyPendingTimers()
    })
    expect(JSON.parse(localStorage.getItem('bookreader_progress'))['txt-1'].position).toBe(4)
})

test('removeBookProgress deletes current and legacy progress entries', () => {
    localStorage.setItem('bookreader_progress', JSON.stringify({
        'book-1': { position: 3, totalPages: 10, type: 'txt', bookmarks: [{ position: 3 }] },
        'legacy-1': { position: 4, totalPages: 10, type: 'txt', bookmarks: [] },
        'book-2': { position: 1, totalPages: 5, type: 'txt', bookmarks: [] },
    }))

    removeBookProgress('book-1', 'legacy-1')

    expect(JSON.parse(localStorage.getItem('bookreader_progress'))).toEqual({
        'book-2': { position: 1, totalPages: 5, type: 'txt', bookmarks: [] },
    })
})
