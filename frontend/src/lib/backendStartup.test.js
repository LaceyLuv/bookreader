import { describe, expect, test, vi } from 'vitest'

import {
    checkBackendStartup,
    normalizeBackendStatus,
    waitForBackendHealth,
} from './backendStartup'

describe('backendStartup', () => {
    test('waits until /api/health returns ok', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
        const sleep = vi.fn(async () => {})

        const result = await waitForBackendHealth({
            healthUrl: 'http://127.0.0.1:8000/api/health',
            fetchImpl,
            sleep,
            attempts: 3,
            intervalMs: 5,
        })

        expect(result.ok).toBe(true)
        expect(result.attempts).toBe(2)
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledTimes(1)
    })

    test('reports readiness failure after retries are exhausted', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'))

        const result = await waitForBackendHealth({
            healthUrl: '/api/health',
            fetchImpl,
            sleep: async () => {},
            attempts: 2,
            intervalMs: 1,
        })

        expect(result).toMatchObject({
            ok: false,
            attempts: 2,
            message: 'connection refused',
        })
    })

    test('includes sidecar spawn failure status when desktop readiness fails', async () => {
        const result = await checkBackendStartup({
            isTauri: true,
            apiBase: 'http://127.0.0.1:8000',
            fetchImpl: vi.fn().mockRejectedValue(new Error('connection refused')),
            invokeImpl: vi.fn(async (command) => {
                expect(command).toBe('backend_status')
                return {
                    state: 'failed',
                    message: 'backend sidecar spawn failed: missing binary',
                    pid: null,
                    owned: false,
                }
            }),
            sleep: async () => {},
            attempts: 1,
            intervalMs: 1,
        })

        expect(result.ready).toBe(false)
        expect(result.status.state).toBe('failed')
        expect(result.message).toContain('missing binary')
    })

    test('normalizes unknown sidecar status into a user-facing fallback', () => {
        expect(normalizeBackendStatus(null)).toEqual({
            state: 'unknown',
            message: 'Backend status is unavailable.',
            pid: null,
            owned: false,
        })
    })
})
