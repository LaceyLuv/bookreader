import { API_BASE, API_HEALTH_URL, IS_TAURI_RUNTIME, buildApiPath } from './apiBase'

const DEFAULT_ATTEMPTS = 50
const DEFAULT_INTERVAL_MS = 200

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeBackendStatus(status) {
    if (!status || typeof status !== 'object') {
        return {
            state: 'unknown',
            message: 'Backend status is unavailable.',
            pid: null,
            owned: false,
        }
    }

    return {
        state: typeof status.state === 'string' && status.state ? status.state : 'unknown',
        message: typeof status.message === 'string' && status.message ? status.message : null,
        pid: Number.isFinite(status.pid) ? status.pid : null,
        owned: Boolean(status.owned),
    }
}

export async function invokeTauriCommand(command, payload, windowLike = globalThis.window) {
    const invoke = windowLike?.__TAURI_INTERNALS__?.invoke
    if (typeof invoke !== 'function') {
        throw new Error('Tauri invoke API is unavailable.')
    }
    return invoke(command, payload)
}

export async function waitForBackendHealth({
    healthUrl = API_HEALTH_URL,
    fetchImpl = globalThis.fetch,
    sleep: sleepImpl = sleep,
    attempts = DEFAULT_ATTEMPTS,
    intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
    let lastMessage = 'Backend did not become ready.'

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetchImpl(healthUrl, { cache: 'no-store' })
            if (response.ok) {
                const payload = await response.json().catch(() => null)
                if (payload?.ok === true) {
                    return { ok: true, attempts: attempt, message: null }
                }
                lastMessage = 'Health check response did not report ok.'
            } else {
                lastMessage = `Health check returned HTTP ${response.status}.`
            }
        } catch (err) {
            lastMessage = err?.message || String(err)
        }

        if (attempt < attempts) {
            await sleepImpl(intervalMs)
        }
    }

    return { ok: false, attempts, message: lastMessage }
}

export async function checkBackendStartup({
    isTauri = IS_TAURI_RUNTIME,
    apiBase = API_BASE,
    fetchImpl = globalThis.fetch,
    invokeImpl = invokeTauriCommand,
    sleep: sleepImpl = sleep,
    attempts = DEFAULT_ATTEMPTS,
    intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
    const health = await waitForBackendHealth({
        healthUrl: buildApiPath(apiBase, '/api/health'),
        fetchImpl,
        sleep: sleepImpl,
        attempts,
        intervalMs,
    })

    if (health.ok) {
        return {
            ready: true,
            message: null,
            health,
            status: normalizeBackendStatus({ state: 'ready', message: null, owned: false, pid: null }),
        }
    }

    let status = normalizeBackendStatus(null)
    if (isTauri) {
        try {
            status = normalizeBackendStatus(await invokeImpl('backend_status'))
        } catch (err) {
            status = normalizeBackendStatus({
                state: 'unknown',
                message: err?.message || 'Unable to query backend sidecar status.',
                pid: null,
                owned: false,
            })
        }
    }

    const message = status.message || health.message || 'Backend is not ready.'
    return {
        ready: false,
        message,
        health,
        status,
    }
}
