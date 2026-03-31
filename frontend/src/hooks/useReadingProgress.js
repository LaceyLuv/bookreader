import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'bookreader_progress'

function getAllProgress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

function saveAllProgress(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function calculatePercent(position, totalPages) {
    if (totalPages <= 0) return 0
    return Math.round(((position + 1) / totalPages) * 100)
}

function buildProgressEntry(currentPosition, totalPages, type, bookmarks) {
    return {
        position: currentPosition,
        totalPages,
        type,
        percent: calculatePercent(currentPosition, totalPages),
        bookmarks,
        updatedAt: new Date().toISOString(),
    }
}

function normalizeProgressEntry(entry, fallbackType = 'txt') {
    const position = Number.isFinite(entry?.position) ? entry.position : 0
    const totalPages = Number.isFinite(entry?.totalPages) && entry.totalPages > 0 ? entry.totalPages : 1
    const type = typeof entry?.type === 'string' ? entry.type : fallbackType
    const bookmarks = Array.isArray(entry?.bookmarks) ? entry.bookmarks : []
    return {
        position,
        totalPages,
        type,
        percent: Number.isFinite(entry?.percent) ? entry.percent : calculatePercent(position, totalPages),
        bookmarks,
        updatedAt: entry?.updatedAt || new Date().toISOString(),
    }
}

function resolveStoredEntry(allProgress, bookId, legacyId) {
    if (bookId && allProgress[bookId]) {
        return { entry: allProgress[bookId], sourceKey: bookId }
    }
    if (legacyId && allProgress[legacyId]) {
        return { entry: allProgress[legacyId], sourceKey: legacyId }
    }
    return { entry: null, sourceKey: null }
}

function persistProgressEntry(bookId, legacyId, entry) {
    if (!bookId) return
    const all = getAllProgress()
    all[bookId] = entry
    if (legacyId && legacyId !== bookId && Object.prototype.hasOwnProperty.call(all, legacyId)) {
        delete all[legacyId]
    }
    saveAllProgress(all)
}

/**
 * Hook for managing reading progress for a specific book.
 */
export function useReadingProgress(bookId, { totalPages = 1, type = 'txt', legacyId = null } = {}) {
    const [currentPosition, setCurrentPosition] = useState(0)
    const [bookmarks, setBookmarks] = useState([])
    const [resumePrompt, setResumePrompt] = useState(null)
    const latestEntryRef = useRef(buildProgressEntry(0, totalPages, type, []))

    useEffect(() => {
        setCurrentPosition(0)
        setBookmarks([])
        setResumePrompt(null)
        latestEntryRef.current = buildProgressEntry(0, totalPages, type, [])

        if (!bookId) return
        const all = getAllProgress()
        const { entry, sourceKey } = resolveStoredEntry(all, bookId, legacyId)
        if (!entry) return

        const normalized = normalizeProgressEntry(entry, type)
        latestEntryRef.current = normalized
        setBookmarks(normalized.bookmarks)
        if (normalized.position > 0) {
            setResumePrompt({
                position: normalized.position,
                percent: calculatePercent(normalized.position, totalPages),
            })
        }

        if (sourceKey && sourceKey !== bookId) {
            persistProgressEntry(bookId, legacyId, normalized)
        }
    }, [bookId, legacyId])

    useEffect(() => {
        latestEntryRef.current = buildProgressEntry(currentPosition, totalPages, type, bookmarks)
    }, [currentPosition, totalPages, type, bookmarks])

    useEffect(() => {
        if (!bookId) return
        const timer = window.setTimeout(() => {
            persistProgressEntry(bookId, legacyId, latestEntryRef.current)
        }, 180)
        return () => window.clearTimeout(timer)
    }, [bookId, legacyId, currentPosition, totalPages, type, bookmarks])

    useEffect(() => {
        if (!bookId) return
        const flush = () => {
            persistProgressEntry(bookId, legacyId, latestEntryRef.current)
        }
        window.addEventListener('pagehide', flush)
        return () => {
            window.removeEventListener('pagehide', flush)
            flush()
        }
    }, [bookId, legacyId])

    const resumeReading = useCallback(() => {
        if (resumePrompt) {
            setCurrentPosition(resumePrompt.position)
            setResumePrompt(null)
        }
    }, [resumePrompt])

    const dismissResume = useCallback(() => {
        setResumePrompt(null)
    }, [])

    const addBookmark = useCallback(() => {
        const label = `Page ${currentPosition + 1}`
        const ts = new Date().toISOString()
        setBookmarks(prev => {
            if (prev.some(b => b.position === currentPosition)) return prev
            return [...prev, { position: currentPosition, label, savedAt: ts }]
        })
    }, [currentPosition])

    const removeBookmark = useCallback((position) => {
        setBookmarks(prev => prev.filter(b => b.position !== position))
    }, [])

    const goToBookmark = useCallback((position) => {
        setCurrentPosition(position)
    }, [])

    const percent = calculatePercent(currentPosition, totalPages)

    return {
        currentPosition, setCurrentPosition,
        percent,
        bookmarks, addBookmark, removeBookmark, goToBookmark,
        resumePrompt, resumeReading, dismissResume,
    }
}

/**
 * Get reading progress summary for a book (used by Dashboard).
 */
export function getBookProgress(bookId, legacyId = null) {
    const all = getAllProgress()
    const { entry } = resolveStoredEntry(all, bookId, legacyId)
    const saved = entry ? normalizeProgressEntry(entry) : null
    if (!saved || saved.position === 0) return null
    return {
        percent: saved.percent || 0,
        position: saved.position,
        totalPages: saved.totalPages,
    }
}
