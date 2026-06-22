import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BOOKS_BASE } from '../lib/apiBase'
import {
    createTxtTransformOptions,
    hasActiveTxtTransformOptions,
    normalizeTxtCompatibilitySegments,
    toTxtTransformQuery,
} from '../lib/txtTransformOptions'

const DEFAULT_WINDOW_SIZE = 40

function normalizeTxtDisplayFragments(data, transformOptions = {}) {
    const displayFragments = Array.isArray(data?.display_fragments) ? data.display_fragments : []
    if (displayFragments.length > 0) return displayFragments
    return normalizeTxtCompatibilitySegments(data, transformOptions)
}

export function useTxtSegmentWindow(bookId, transformOptions = createTxtTransformOptions(), windowSize = DEFAULT_WINDOW_SIZE) {
    const [manifest, setManifest] = useState(null)
    const [windows, setWindows] = useState({})
    const [visibleStart, setVisibleStart] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const transformQuery = useMemo(() => toTxtTransformQuery(transformOptions), [transformOptions])
    const windowRequestVersionRef = useRef(0)
    const windowsRef = useRef({})

    useEffect(() => {
        windowsRef.current = windows
    }, [windows])

    useEffect(() => {
        let cancelled = false
        windowRequestVersionRef.current += 1
        setManifest(null)
        setWindows({})
        setVisibleStart(0)
        setLoading(true)
        setError(null)
        windowsRef.current = {}

        ; (async () => {
            try {
                const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-manifest?${transformQuery}`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                if (!cancelled) setManifest(data)
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
    }, [bookId, transformQuery])

    const loadWindow = useCallback(async (start) => {
        const safeStart = Math.max(0, start)
        const requestVersion = windowRequestVersionRef.current
        if (windowsRef.current[safeStart]) return windowsRef.current[safeStart]
        const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-segments?start=${safeStart}&limit=${windowSize}&${transformQuery}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const windowData = {
            segments: normalizeTxtCompatibilitySegments(data, transformOptions),
            displayFragments: normalizeTxtDisplayFragments(data, transformOptions),
        }
        if (windowRequestVersionRef.current !== requestVersion) return null
        setWindows((prev) => ({ ...prev, [safeStart]: windowData }))
        windowsRef.current = { ...windowsRef.current, [safeStart]: windowData }
        return windowData
    }, [bookId, transformQuery, transformOptions, windowSize])

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
