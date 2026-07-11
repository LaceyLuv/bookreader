import { describe, expect, test, vi } from 'vitest'

import {
    buildApiPath,
    detectTauriRuntime,
    getApiBase,
    getApiBooksBase,
    getApiFontsBase,
    getApiHealthUrl,
    configureDesktopBackend,
    installDesktopFetchAuthentication,
    authenticateAssetUrl,
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

describe('desktop backend authentication', () => {
    test('authenticates only requests to the Tauri-provided origin', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
        const windowLike = {
            __TAURI_INTERNALS__: {},
            location: { href: 'http://tauri.localhost/' },
            fetch: fetchImpl,
        }
        configureDesktopBackend({ apiBase: 'http://127.0.0.1:43123', nonce: 'a'.repeat(64), assetToken: 'b'.repeat(64) }, windowLike)
        installDesktopFetchAuthentication(windowLike)

        await windowLike.fetch('http://127.0.0.1:43123/api/health')
        expect(fetchImpl.mock.calls[0][1].headers.get('X-BookReader-Nonce')).toBe('a'.repeat(64))

        await windowLike.fetch('https://example.com/resource')
        expect(fetchImpl.mock.calls[1][1]).toEqual({})
        expect(authenticateAssetUrl('http://127.0.0.1:43123/api/books/1/asset/cover.png'))
            .toBe(`http://127.0.0.1:43123/api/books/1/asset/cover.png?asset_token=${'b'.repeat(64)}`)
        expect(authenticateAssetUrl('http://127.0.0.1:43123/api/health'))
            .toBe('http://127.0.0.1:43123/api/health')
    })
})
