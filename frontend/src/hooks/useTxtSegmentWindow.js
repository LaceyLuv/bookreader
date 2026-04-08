import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BOOKS_BASE } from '../lib/apiBase'

const DEFAULT_WINDOW_SIZE = 40

export function useTxtSegmentWindow(bookId, windowSize = DEFAULT_WINDOW_SIZE) {
    const [manifest, setManifest] = useState(null)
    const [windows, setWindows] = useState({})
    const [visibleStart, setVisibleStart] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        let cancelled = false
        setManifest(null)
        setWindows({})
        setVisibleStart(0)
        setLoading(true)
        setError(null)

        ; (async () => {
            try {
                const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-manifest`)
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
    }, [bookId])

    const loadWindow = useCallback(async (start) => {
        const safeStart = Math.max(0, start)
        if (windows[safeStart]) return windows[safeStart]
        const res = await fetch(`${API_BOOKS_BASE}/${bookId}/txt-segments?start=${safeStart}&limit=${windowSize}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setWindows((prev) => ({ ...prev, [safeStart]: data.segments }))
        return data.segments
    }, [bookId, windowSize, windows])

    useEffect(() => {
        if (!manifest) return
        let cancelled = false
        ; (async () => {
            try {
                await loadWindow(0)
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

    const visibleSegments = useMemo(() => windows[visibleStart] || [], [visibleStart, windows])

    const showWindowForSegment = useCallback(async (segmentId) => {
        const centeredStart = Math.max(0, segmentId - Math.floor(windowSize / 2))
        await loadWindow(centeredStart)
        setVisibleStart(centeredStart)
        return centeredStart
    }, [loadWindow, windowSize])

    return {
        manifest,
        visibleStart,
        setVisibleStart,
        visibleSegments,
        loadWindow,
        showWindowForSegment,
        windowSize,
        loading,
        error,
    }
}
