import { describe, expect, test, vi } from 'vitest'

import {
    checkBackendStartup,
    classifyBackendFailure,
    normalizeBackendStatus,
    restartBookReader,
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

    test('times out a health request that never responds', async () => {
        const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('aborted')
                error.name = 'AbortError'
                reject(error)
            })
        }))

        const result = await waitForBackendHealth({
            healthUrl: '/api/health',
            fetchImpl,
            attempts: 1,
            requestTimeoutMs: 5,
        })

        expect(result.ok).toBe(false)
        expect(result.message).toContain('timed out after 5ms')
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
                    code: 'sidecar_spawn_failed',
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
        expect(result.problem.code).toBe('sidecar_missing')
        expect(result.message).toContain('missing binary')
    })

    test('classifies access-denied spawn errors without recommending antivirus disablement', () => {
        const problem = classifyBackendFailure({
            state: 'failed',
            code: 'sidecar_spawn_failed',
            message: 'Access is denied (os error 5)',
            pid: null,
            owned: false,
        })

        expect(problem.code).toBe('sidecar_blocked_or_denied')
        expect(problem.recoveryKey).toBe('backendSidecarBlockedRecovery')
    })

    test('requests an application restart through the narrow Tauri command', async () => {
        const invoke = vi.fn(async () => undefined)

        await restartBookReader(invoke)

        expect(invoke).toHaveBeenCalledWith('restart_application')
    })

    test('normalizes unknown sidecar status into a user-facing fallback', () => {
        expect(normalizeBackendStatus(null)).toEqual({
            state: 'unknown',
            code: 'backend_status_unavailable',
            message: 'Backend status is unavailable.',
            pid: null,
            owned: false,
        })
    })
})
