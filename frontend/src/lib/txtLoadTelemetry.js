export const TXT_LOAD_EVENT = 'bookreader:txt-load-phase'

const SAFE_FIELD_NAMES = new Set([
    'bookId',
    'requestId',
    'durationMs',
    'sizeBytes',
    'totalChars',
    'segmentCount',
    'fragmentCount',
    'status',
    'reason',
])

export function getTxtLoadTimestamp() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now()
    }
    return Date.now()
}

export function emitTxtLoadEvent(phase, fields = {}) {
    const detail = {
        phase,
        timestamp: getTxtLoadTimestamp(),
    }

    for (const [key, value] of Object.entries(fields)) {
        if (!SAFE_FIELD_NAMES.has(key)) continue
        if (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) {
            detail[key] = value
        }
    }

    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(`bookreader:txt:${phase}`)
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(TXT_LOAD_EVENT, { detail }))
    }

    return detail
}
