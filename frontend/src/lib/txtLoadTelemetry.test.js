import { afterEach, expect, test, vi } from 'vitest'
import { emitTxtLoadEvent, TXT_LOAD_EVENT } from './txtLoadTelemetry'

afterEach(() => {
    vi.restoreAllMocks()
})

test('emits phase timing metadata without accepting text content', () => {
    const listener = vi.fn()
    window.addEventListener(TXT_LOAD_EVENT, listener)

    const detail = emitTxtLoadEvent('first_window:ready', {
        bookId: 'book-1',
        requestId: 3,
        durationMs: 12.5,
        fragmentCount: 40,
        text: 'must not be recorded',
        query: 'must not be recorded',
    })

    expect(detail).toMatchObject({
        phase: 'first_window:ready',
        bookId: 'book-1',
        requestId: 3,
        durationMs: 12.5,
        fragmentCount: 40,
    })
    expect(detail).not.toHaveProperty('text')
    expect(detail).not.toHaveProperty('query')
    expect(listener).toHaveBeenCalledTimes(1)

    window.removeEventListener(TXT_LOAD_EVENT, listener)
})
