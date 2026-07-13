import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BOOKS_BASE } from '../lib/apiBase'
import {
    createTxtTransformOptions,
    hasActiveTxtTransformOptions,
    normalizeTxtCompatibilitySegments,
    toTxtTransformQuery,
} from '../lib/txtTransformOptions'
import { emitTxtLoadEvent, getTxtLoadTimestamp } from '../lib/txtLoadTelemetry'

const DEFAULT_WINDOW_SIZE = 40
const MAX_CACHED_WINDOWS = 5
const DEFAULT_TRANSFORM_OPTIONS = createTxtTransformOptions()
const MANIFEST_TIMEOUT_MS = 30_000
const WINDOW_TIMEOUT_MS = 15_000
const PAGINATION_TIMEOUT_MS = 60_000
const WINDOW_MAX_CHARS = 128 * 1024
const PAGINATION_MAX_CHARS = 1024 * 1024

function createHttpError(status) {
    const error = new Error(`HTTP ${status}`)
    error.status = status
    return error
}

export function classifyTxtLoadError(error) {
    if (error?.name === 'AbortError') return 'cancelled'
    if (error?.status === 400 || error?.status === 415) return 'unsupported'
    if (error?.status === 404 || error?.status === 410 || error instanceof SyntaxError) return 'fatal_error'
    return 'recoverable_error'
}

async function fetchJsonWithTimeout(url, controller, timeoutMs) {
    let timedOut = false
    const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, timeoutMs)

    try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw createHttpError(response.status)
        return await response.json()
    } catch (error) {
        if (timedOut) {
            const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`)
            timeoutError.name = 'TimeoutError'
            throw timeoutError
        }
        throw error
    } finally {
        clearTimeout(timeoutId)
    }
}

function normalizeTxtDisplayFragments(data, transformOptions = {}) {
    const displayFragments = Array.isArray(data?.display_fragments) ? data.display_fragments : []
    if (displayFragments.length > 0) return displayFragments
    return normalizeTxtCompatibilitySegments(data, transformOptions)
}

export function useTxtSegmentWindow(
    bookId,
    transformOptions = DEFAULT_TRANSFORM_OPTIONS,
    windowSize = DEFAULT_WINDOW_SIZE,
    contentVersion = 0,
) {
    const [manifest, setManifest] = useState(null)
    const [windows, setWindows] = useState({})
    const [visibleStart, setVisibleStart] = useState(0)
    const [contentStatus, setContentStatus] = useState('loading_manifest')
    const [error, setError] = useState(null)
    const [readyContentKey, setReadyContentKey] = useState(null)
    const [reloadToken, setReloadToken] = useState(0)
    const transformQuery = useMemo(() => toTxtTransformQuery(transformOptions), [transformOptions])
    const windowRequestVersionRef = useRef(0)
    const windowsRef = useRef({})
    const cacheOrderRef = useRef([])
    const inFlightRef = useRef(new Map())

    useEffect(() => {
        let cancelled = false
        windowRequestVersionRef.current += 1
        const requestId = windowRequestVersionRef.current
        const manifestStartedAt = getTxtLoadTimestamp()
        emitTxtLoadEvent('manifest:start', { bookId, requestId })
        for (const request of inFlightRef.current.values()) request.controller.abort()
        inFlightRef.current.clear()
        cacheOrderRef.current = []
        setManifest(null)
        setWindows({})
        setVisibleStart(0)
        setContentStatus('loading_manifest')
        setError(null)
        setReadyContentKey(null)
        windowsRef.current = {}

        const controller = new AbortController()
        ; (async () => {
            try {
                const data = await fetchJsonWithTimeout(
                    `${API_BOOKS_BASE}/${bookId}/txt-manifest?${transformQuery}`,
                    controller,
                    MANIFEST_TIMEOUT_MS,
                )
                if (!cancelled) {
                    emitTxtLoadEvent('manifest:ready', {
                        bookId,
                        requestId,
                        durationMs: getTxtLoadTimestamp() - manifestStartedAt,
                        totalChars: data?.total_chars,
                        segmentCount: data?.segment_count,
                    })
                    setContentStatus('loading_first_window')
                    setManifest(data)
                }
            } catch (err) {
                if (!cancelled) {
                    const nextStatus = classifyTxtLoadError(err)
                    emitTxtLoadEvent('manifest:error', {
                        bookId,
                        requestId,
                        durationMs: getTxtLoadTimestamp() - manifestStartedAt,
                        reason: err?.message || 'unknown',
                    })
                    setContentStatus(nextStatus)
                    if (nextStatus !== 'cancelled') setError(err)
                }
            }
        })()

        return () => {
            cancelled = true
            controller.abort()
            emitTxtLoadEvent('manifest:cancelled', { bookId, requestId, reason: 'superseded' })
        }
    }, [bookId, contentVersion, reloadToken, transformQuery])

    const loadWindow = useCallback(async (start) => {
        const safeStart = Math.max(0, start)
        const requestVersion = windowRequestVersionRef.current
        const cached = windowsRef.current[safeStart]
        if (cached) {
            cacheOrderRef.current = cacheOrderRef.current.filter((key) => key !== safeStart).concat(safeStart)
            return cached
        }
        const existing = inFlightRef.current.get(safeStart)
        if (existing) return existing.promise

        const controller = new AbortController()
        const promise = (async () => {
            try {
                const data = await fetchJsonWithTimeout(
                    `${API_BOOKS_BASE}/${bookId}/txt-segments?start=${safeStart}&limit=${windowSize}&${transformQuery}&max_chars=${WINDOW_MAX_CHARS}`,
                    controller,
                    WINDOW_TIMEOUT_MS,
                )
                const windowData = {
                    segments: normalizeTxtCompatibilitySegments(data, transformOptions),
                    displayFragments: normalizeTxtDisplayFragments(data, transformOptions),
                    nextCursor: data?.next_cursor ?? null,
                    hasMore: Boolean(data?.has_more),
                }
                if (windowRequestVersionRef.current !== requestVersion) return null

                const order = cacheOrderRef.current.filter((key) => key !== safeStart).concat(safeStart)
                const evicted = order.length > MAX_CACHED_WINDOWS ? order.shift() : null
                cacheOrderRef.current = order
                const next = { ...windowsRef.current, [safeStart]: windowData }
                if (evicted !== null) delete next[evicted]
                windowsRef.current = next
                setWindows(next)
                return windowData
            } finally {
                if (inFlightRef.current.get(safeStart)?.promise === promise) inFlightRef.current.delete(safeStart)
            }
        })()
        inFlightRef.current.set(safeStart, { controller, promise })
        return promise
    }, [bookId, contentVersion, transformQuery, transformOptions, windowSize])

    const loadPaginationWindow = useCallback(async (start, limit = windowSize, cursor = null) => {
        const safeStart = Math.max(0, start)
        const safeLimit = Math.max(1, limit)
        const requestVersion = windowRequestVersionRef.current
        const safeCursor = typeof cursor === 'string' && cursor ? cursor : null
        const requestKey = `pagination:${safeStart}:${safeLimit}:${safeCursor ?? ''}`
        const existing = inFlightRef.current.get(requestKey)
        if (existing) return existing.promise

        const controller = new AbortController()
        const promise = (async () => {
            try {
                const cursorQuery = safeCursor ? `&cursor=${encodeURIComponent(safeCursor)}` : ''
                const data = await fetchJsonWithTimeout(
                    `${API_BOOKS_BASE}/${bookId}/txt-segments?start=${safeStart}&limit=${safeLimit}&${transformQuery}&max_chars=${PAGINATION_MAX_CHARS}${cursorQuery}`,
                    controller,
                    PAGINATION_TIMEOUT_MS,
                )
                if (windowRequestVersionRef.current !== requestVersion) return null
                return {
                    segments: normalizeTxtCompatibilitySegments(data, transformOptions),
                    displayFragments: normalizeTxtDisplayFragments(data, transformOptions),
                    nextCursor: data?.next_cursor ?? null,
                    hasMore: Boolean(data?.has_more),
                }
            } finally {
                if (inFlightRef.current.get(requestKey)?.promise === promise) inFlightRef.current.delete(requestKey)
            }
        })()
        inFlightRef.current.set(requestKey, { controller, promise })
        return promise
    }, [bookId, contentVersion, transformOptions, transformQuery, windowSize])

    useEffect(() => () => {
        for (const request of inFlightRef.current.values()) request.controller.abort()
        inFlightRef.current.clear()
    }, [])

    useEffect(() => {
        if (!manifest) return
        let cancelled = false
        const requestId = windowRequestVersionRef.current
        const windowStartedAt = getTxtLoadTimestamp()
        emitTxtLoadEvent('first_window:start', { bookId, requestId })
        ; (async () => {
            try {
                const windowData = await loadWindow(0)
                if (!windowData) return
                if (!cancelled) {
                    emitTxtLoadEvent('first_window:ready', {
                        bookId,
                        requestId,
                        durationMs: getTxtLoadTimestamp() - windowStartedAt,
                        fragmentCount: windowData.displayFragments.length,
                    })
                    setReadyContentKey(`${bookId}:${transformQuery}:${contentVersion}`)
                    setContentStatus(windowData.displayFragments.length > 0 ? 'ready' : 'empty')
                }
            } catch (err) {
                if (!cancelled) {
                    const nextStatus = classifyTxtLoadError(err)
                    emitTxtLoadEvent('first_window:error', {
                        bookId,
                        requestId,
                        durationMs: getTxtLoadTimestamp() - windowStartedAt,
                        reason: err?.message || 'unknown',
                    })
                    setContentStatus(nextStatus)
                    if (nextStatus !== 'cancelled') setError(err)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [bookId, contentVersion, manifest, loadWindow, transformQuery])

    const visibleWindow = useMemo(
        () => windows[visibleStart] || { segments: [], displayFragments: [] },
        [visibleStart, windows],
    )
    const visibleSegments = visibleWindow.segments
    const visibleDisplayFragments = visibleWindow.displayFragments
    const visibleWindowHasMore = Boolean(visibleWindow.hasMore)

    const showWindowForSegment = useCallback(async (segmentId) => {
        const centeredStart = Math.max(0, segmentId - Math.floor(windowSize / 2))
        const windowData = await loadWindow(centeredStart)
        if (!windowData) return null
        setVisibleStart(centeredStart)
        return centeredStart
    }, [loadWindow, windowSize])

    const retryContent = useCallback(() => {
        setReloadToken((value) => value + 1)
    }, [])

    const loading = contentStatus === 'loading_manifest' || contentStatus === 'loading_first_window'

    return {
        manifest,
        visibleStart,
        setVisibleStart,
        visibleSegments,
        visibleDisplayFragments,
        visibleWindowHasMore,
        loadWindow,
        loadPaginationWindow,
        showWindowForSegment,
        windowSize,
        loading,
        error,
        readyContentKey,
        contentStatus,
        retryContent,
    }
}
