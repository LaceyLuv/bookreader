// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'

import { downloadResponseBlob, responseFilename } from './downloadResponseBlob'

beforeEach(() => {
    vi.restoreAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:annotation-export')
    URL.revokeObjectURL = vi.fn()
})

test('prefers the RFC 5987 filename and strips path separators', () => {
    const response = {
        headers: new Headers({
            'Content-Disposition': "attachment; filename=annotations.md; filename*=UTF-8''..%2F%ED%95%9C%EA%B8%80.md",
        }),
    }

    expect(responseFilename(response, 'fallback.md')).toBe('..-한글.md')
})

test('downloads a response blob and always cleans up the temporary URL', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const response = {
        headers: new Headers({ 'Content-Disposition': 'attachment; filename="notes.json"' }),
        blob: vi.fn(async () => new Blob(['{}'], { type: 'application/json' })),
    }

    await expect(downloadResponseBlob(response, 'fallback.json')).resolves.toBe('notes.json')

    expect(click).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:annotation-export')
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
})
