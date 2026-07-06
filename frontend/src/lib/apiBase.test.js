import { describe, expect, test } from 'vitest'

import {
    buildApiPath,
    detectTauriRuntime,
    getApiBase,
    getApiBooksBase,
    getApiFontsBase,
    getApiHealthUrl,
} from './apiBase'

describe('apiBase', () => {
    test('uses relative API paths in the web runtime', () => {
        const windowLike = {}

        expect(detectTauriRuntime(windowLike)).toBe(false)
        expect(getApiBase(windowLike)).toBe('')
        expect(getApiBooksBase(windowLike)).toBe('/api/books')
        expect(getApiFontsBase(windowLike)).toBe('/api/fonts')
        expect(getApiHealthUrl(windowLike)).toBe('/api/health')
    })

    test('uses localhost backend URLs in the Tauri runtime', () => {
        const windowLike = { __TAURI_INTERNALS__: { invoke: () => {} } }

        expect(detectTauriRuntime(windowLike)).toBe(true)
        expect(getApiBase(windowLike)).toBe('http://127.0.0.1:8000')
        expect(getApiBooksBase(windowLike)).toBe('http://127.0.0.1:8000/api/books')
        expect(getApiFontsBase(windowLike)).toBe('http://127.0.0.1:8000/api/fonts')
        expect(getApiHealthUrl(windowLike)).toBe('http://127.0.0.1:8000/api/health')
    })

    test('joins API paths without duplicate slashes', () => {
        expect(buildApiPath('', '/api/books')).toBe('/api/books')
        expect(buildApiPath('http://127.0.0.1:8000/', '/api/books')).toBe('http://127.0.0.1:8000/api/books')
        expect(buildApiPath('http://127.0.0.1:8000', 'api/books')).toBe('http://127.0.0.1:8000/api/books')
    })
})
