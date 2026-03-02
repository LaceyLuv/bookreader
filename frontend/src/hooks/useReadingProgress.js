import { useState, useEffect, useCallback } from 'react'

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

/**
 * Hook for managing reading progress for a specific book.
 */
export function useReadingProgress(bookId, { totalPages = 1, type = 'txt' } = {}) {
    const [currentPosition, setCurrentPosition] = useState(0)
    const [bookmarks, setBookmarks] = useState([])
    const [resumePrompt, setResumePrompt] = useState(null)

    useEffect(() => {
        if (!bookId) return
        const all = getAllProgress()
        const saved = all[bookId]
        if (saved && saved.position > 0) {
            setResumePrompt({
                position: saved.position,
                percent: totalPages > 0 ? Math.round((saved.position / totalPages) * 100) : 0,
            })
            setBookmarks(saved.bookmarks || [])
        }
    }, [bookId])

    useEffect(() => {
        if (!bookId) return
        const all = getAllProgress()
        all[bookId] = {
            position: currentPosition,
            totalPages,
            type,
            percent: totalPages > 0 ? Math.round((currentPosition / totalPages) * 100) : 0,
            bookmarks: bookmarks,
            updatedAt: new Date().toISOString(),
        }
        saveAllProgress(all)
    }, [bookId, currentPosition, totalPages, type, bookmarks])

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

    const percent = totalPages > 0 ? Math.round(((currentPosition + 1) / totalPages) * 100) : 0

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
export function getBookProgress(bookId) {
    const all = getAllProgress()
    const saved = all[bookId]
    if (!saved || saved.position === 0) return null
    return {
        percent: saved.percent || 0,
        position: saved.position,
        totalPages: saved.totalPages,
    }
}
