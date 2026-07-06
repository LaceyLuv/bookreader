// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { removeBookProgress, useReadingProgress } from './useReadingProgress'

beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
})

test('restored progress is clamped when pagination shrinks after layout changes', () => {
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

    expect(result.current.resumePrompt.position).toBe(4)

    act(() => {
        result.current.resumeReading()
        vi.runOnlyPendingTimers()
    })

    expect(result.current.currentPosition).toBe(4)
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
