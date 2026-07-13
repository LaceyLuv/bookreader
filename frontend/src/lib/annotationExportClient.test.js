// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'

import { exportBookAnnotations } from './annotationExportClient'

beforeEach(() => {
    vi.restoreAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:annotation-export')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

test('requests the canonical server export and uses its UTF-8 filename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': "attachment; filename=notes.json; filename*=UTF-8''%EC%B1%85-%EC%A3%BC%EC%84%9D.json",
        },
    })))

    await expect(exportBookAnnotations('book/id', 'json')).resolves.toBe('책-주석.json')

    expect(fetch).toHaveBeenCalledWith('/api/books/book%2Fid/annotations/export?format=json')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:annotation-export')
})

test('uses the Gyeol filename when the server omits content disposition', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# notes', { status: 200 })))

    await expect(exportBookAnnotations('book-1', 'markdown')).resolves.toBe('Gyeol-annotations.md')
})

test('surfaces the server detail and rejects unsupported formats before fetching', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Export unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
    })))

    await expect(exportBookAnnotations('book-1', 'markdown')).rejects.toThrow('Export unavailable')
    await expect(exportBookAnnotations('book-1', 'csv')).rejects.toThrow('Unsupported annotation export format')
    expect(fetch).toHaveBeenCalledOnce()
})
