import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BOOKS_BASE } from '../lib/apiBase'
import {
    createTxtTransformOptions,
    hasActiveTxtTransformOptions,
    normalizeTxtCompatibilitySegments,
    toTxtTransformQuery,
} from '../lib/txtTransformOptions'

const DEFAULT_WINDOW_SIZE = 40
const MAX_CACHED_WINDOWS = 5
const DEFAULT_TRANSFORM_OPTIONS = createTxtTransformOptions()

function normalizeTxtDisplayFragments(data, transformOptions = {}) {
    const displayFragments = Array.isArray(data?.display_fragments) ? data.display_fragments : []
    if (displayFragments.length > 0) return displayFragments
    return normalizeTxtCompatibilitySegments(data, transformOptions)
}

export function useTxtSegmentWindow(bookId, transformOptions = DEFAULT_TRANSFORM_OPTIONS, windowSize = DEFAULT_WINDOW_SIZE) {
    const [manifest, setManifest] = useState(null)
    const [windows, setWindows] = useState({})
    const [visibleStart, setVisibleStart] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const transformQuery = useMemo(() => toTxtTransformQuery(transformOptions), [transformOptions])
    const windowRequestVersionRef = useRef(0)
    const windowsRef = useRef({})
    const cacheOrderRef = useRef([])
    const inFlightRef = useRef(new Map())

    useEffect(() => {
        let cancelled = false
        windowRequestVersionRef.current += 1
        for (const request of inFlightRef.current.values()) request.controller.abort()
        inFlightRef.current.clear()
        cacheOrderRef.current = []
        setManifest(null)
        setWindows({})
        setVisibleStart(0)
        setLoading(true)
        setError(null)
        windowsRef.current = {}

        const controller = new AbortController()
        ; (async () => {
            try {
                const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-manifest?${transformQuery}`, { signal: controller.signal })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                if (!cancelled) setManifest(data)
            } catch (err) {
                if (!cancelled && err?.name !== 'AbortError') {
                    setError(err)
                    setLoading(false)
                }
            }
        })()

        return () => {
            cancelled = true
            controller.abort()
        }
    }, [bookId, transformQuery])

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
                const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-segments?start=${safeStart}&limit=${windowSize}&${transformQuery}`, { signal: controller.signal })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                const windowData = {
                    segments: normalizeTxtCompatibilitySegments(data, transformOptions),
                    displayFragments: normalizeTxtDisplayFragments(data, transformOptions),
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
    }, [bookId, transformQuery, transformOptions, windowSize])

    useEffect(() => () => {
        for (const request of inFlightRef.current.values()) request.controller.abort()
        inFlightRef.current.clear()
    }, [])

    useEffect(() => {
        if (!manifest) return
        let cancelled = false
        ; (async () => {
            try {
                const windowData = await loadWindow(0)
                if (!windowData) return
                if (!cancelled) setLoading(false)
            } catch (err) {
                if (!cancelled) {
                    setError(err)
                    setLoading(false)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [manifest, loadWindow])

    const visibleWindow = useMemo(
        () => windows[visibleStart] || { segments: [], displayFragments: [] },
        [visibleStart, windows],
    )
    const visibleSegments = visibleWindow.segments
    const visibleDisplayFragments = visibleWindow.displayFragments

    const showWindowForSegment = useCallback(async (segmentId) => {
        const centeredStart = Math.max(0, segmentId - Math.floor(windowSize / 2))
        const windowData = await loadWindow(centeredStart)
        if (!windowData) return null
        setVisibleStart(centeredStart)
        return centeredStart
    }, [loadWindow, windowSize])

    return {
        manifest,
        visibleStart,
        setVisibleStart,
        visibleSegments,
        visibleDisplayFragments,
        loadWindow,
        showWindowForSegment,
        windowSize,
        loading,
        error,
    }
}
