import { useState, useEffect, useCallback, useRef } from 'react'

import { API_BOOKS_BASE } from '../lib/apiBase'
import { createReaderLocator, hasMeaningfulLocator } from '../lib/readerLocator'

const STORAGE_KEY = 'bookreader_progress'
const BOOKMARK_COLORS = ['#f59e0b', '#8b5cf6', '#22c55e', '#f43f5e', '#3b82f6', '#d97706']
let fallbackBookmarkId = 0

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

function clampPosition(position, totalPages) {
    const maxPosition = Math.max(0, (Number.isFinite(totalPages) ? totalPages : 1) - 1)
    const safePosition = Number.isFinite(position) ? position : 0
    return Math.max(0, Math.min(safePosition, maxPosition))
}

function resolveBookmarkMetadata(source) {
    const candidate = typeof source === 'function' ? source() : source
    if (!candidate || typeof candidate !== 'object' || candidate.nativeEvent) return {}

    const metadata = {}
    if (typeof candidate.label === 'string' && candidate.label.trim()) metadata.label = candidate.label.trim()
    if (typeof candidate.excerpt === 'string') metadata.excerpt = candidate.excerpt.trim().slice(0, 320)
    if (typeof candidate.note === 'string') metadata.note = candidate.note.trim().slice(0, 1000)
    if (typeof candidate.tag === 'string') metadata.tag = candidate.tag.trim().slice(0, 40)
    if (typeof candidate.color === 'string' && candidate.color.trim()) metadata.color = candidate.color.trim()
    if (typeof candidate.important === 'boolean') metadata.important = candidate.important
    return metadata
}

function createBookmarkId(timestamp) {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
    fallbackBookmarkId += 1
    return `${timestamp}-${fallbackBookmarkId}`
}

function isSameBookmarkLocation(bookmark, locator, position) {
    const saved = bookmark?.locator
    if (!saved || !locator) return bookmark?.position === position

    const kind = locator.kind ?? saved.kind
    if (kind === 'epub') {
        const sameChapter = locator.chapterHref && saved.chapterHref
            ? locator.chapterHref === saved.chapterHref
            : locator.chapterIndex === saved.chapterIndex
        if (!sameChapter) return false
        if (Number.isFinite(locator.textOffset) && Number.isFinite(saved.textOffset)) {
            return locator.textOffset === saved.textOffset
        }
        const nextPage = locator.chapterPage ?? locator.fallbackPage
        const savedPage = saved.chapterPage ?? saved.fallbackPage
        return Number.isFinite(nextPage) && Number.isFinite(savedPage) && nextPage === savedPage
    }
    if (kind === 'zip') {
        if (locator.memberName && saved.memberName) return locator.memberName === saved.memberName
        const nextPage = locator.page ?? locator.fallbackPage
        const savedPage = saved.page ?? saved.fallbackPage
        return Number.isFinite(nextPage) && Number.isFinite(savedPage) && nextPage === savedPage
    }
    if (kind === 'txt') {
        if (locator.sourceRevision && saved.sourceRevision && locator.sourceRevision !== saved.sourceRevision) return false
        if (Number.isFinite(locator.segmentId) && Number.isFinite(saved.segmentId)
            && Number.isFinite(locator.sourceOffset) && Number.isFinite(saved.sourceOffset)) {
            return locator.segmentId === saved.segmentId && locator.sourceOffset === saved.sourceOffset
        }
        const nextPage = locator.page ?? locator.fallbackPage
        const savedPage = saved.page ?? saved.fallbackPage
        return Number.isFinite(nextPage) && Number.isFinite(savedPage) && nextPage === savedPage
    }

    return bookmark?.position === position
}

function isSameBookmark(bookmark, target) {
    if (target && typeof target === 'object') {
        if (target.id && bookmark.id) return target.id === bookmark.id
        if (target.savedAt && bookmark.savedAt) return target.savedAt === bookmark.savedAt
        return bookmark === target
    }
    return bookmark.position === target
}

function buildProgressEntry(currentPosition, totalPages, type, bookmarks, locator = null) {
    const position = clampPosition(currentPosition, totalPages)
    return {
        position,
        totalPages,
        type,
        percent: calculatePercent(position, totalPages),
        bookmarks,
        locator,
        updatedAt: new Date().toISOString(),
    }
}

function normalizeProgressEntry(entry, fallbackType = 'txt', currentTotalPages = null) {
    const totalPages = Number.isFinite(entry?.totalPages) && entry.totalPages > 0 ? entry.totalPages : 1
    const effectiveTotalPages = Number.isFinite(currentTotalPages) && currentTotalPages > 0 ? currentTotalPages : totalPages
    const position = clampPosition(entry?.position, effectiveTotalPages)
    const type = typeof entry?.type === 'string' ? entry.type : fallbackType
    const bookmarks = Array.isArray(entry?.bookmarks) ? entry.bookmarks : []
    return {
        position,
        totalPages,
        type,
        percent: calculatePercent(position, effectiveTotalPages),
        bookmarks,
        locator: entry?.locator && typeof entry.locator === 'object' ? entry.locator : null,
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

export function clearLocalBookProgress(bookId, legacyId = null) {
    if (!bookId && !legacyId) return
    const all = getAllProgress()
    if (bookId) delete all[bookId]
    if (legacyId && legacyId !== bookId) delete all[legacyId]
    try {
        saveAllProgress(all)
    } catch {
        // Ignore storage failures; deletion already succeeded server-side.
    }
}

export function pruneLocalBookProgress(books) {
    if (!Array.isArray(books)) return
    const validIds = new Set()
    books.forEach((book) => {
        if (book?.id) validIds.add(String(book.id))
        if (book?.legacy_id) validIds.add(String(book.legacy_id))
    })
    const all = getAllProgress()
    const retained = Object.fromEntries(Object.entries(all).filter(([bookId]) => validIds.has(bookId)))
    if (Object.keys(retained).length !== Object.keys(all).length) {
        try {
            saveAllProgress(retained)
        } catch {
            // A stale local entry is harmless until storage is writable again.
        }
    }
}

export function removeBookProgress(bookId, legacyId = null) {
    clearLocalBookProgress(bookId, legacyId)
    if (bookId && typeof fetch === 'function') {
        void fetch(`${API_BOOKS_BASE}/${encodeURIComponent(bookId)}/progress`, { method: 'DELETE' }).catch(() => {})
    }
}

function isNewer(candidate, current) {
    const candidateTime = Date.parse(candidate?.updatedAt || '')
    const currentTime = Date.parse(current?.updatedAt || '')
    if (!Number.isFinite(candidateTime)) return false
    if (!Number.isFinite(currentTime)) return true
    return candidateTime > currentTime
}

async function readRemoteProgress(bookId) {
    const response = await fetch(`${API_BOOKS_BASE}/${encodeURIComponent(bookId)}/progress`)
    if (response.status === 204) return null
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
}

async function writeRemoteProgress(bookId, entry) {
    const response = await fetch(`${API_BOOKS_BASE}/${encodeURIComponent(bookId)}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

/**
 * Hook for managing reading progress for a specific book.
 */
export function useReadingProgress(bookId, {
    totalPages = 1,
    type = 'txt',
    legacyId = null,
    paginationReady = true,
    locator = null,
    locatorToPosition = null,
    bookmarkSnapshot = null,
} = {}) {
    const [currentPosition, setCurrentPosition] = useState(0)
    const [bookmarks, setBookmarks] = useState([])
    const [restoredProgress, setRestoredProgress] = useState(null)
    const [hydratedBookId, setHydratedBookId] = useState(null)
    const [remoteHydratedBookId, setRemoteHydratedBookId] = useState(null)
    const latestEntryRef = useRef(buildProgressEntry(0, totalPages, type, []))
    const progressVersionRef = useRef(0)
    const locatorToPositionRef = useRef(locatorToPosition)
    const appliedLocatorKeyRef = useRef(null)
    locatorToPositionRef.current = locatorToPosition
    const canPersist = hydratedBookId === bookId && paginationReady
    const canPersistRemote = remoteHydratedBookId === bookId
    const canAdjustPagination = hydratedBookId === bookId && paginationReady
    const resolveLocator = useCallback(() => {
        const value = typeof locator === 'function' ? locator() : locator
        return createReaderLocator(type, value)
    }, [locator, type])

    useEffect(() => {
        progressVersionRef.current += 1
        setCurrentPosition(0)
        setBookmarks([])
        setRestoredProgress(null)
        setHydratedBookId(null)
        setRemoteHydratedBookId(null)
        latestEntryRef.current = buildProgressEntry(0, totalPages, type, [])
        appliedLocatorKeyRef.current = null

        if (!bookId) {
            setHydratedBookId(bookId)
            return
        }
        const all = getAllProgress()
        const { entry, sourceKey } = resolveStoredEntry(all, bookId, legacyId)
        if (!entry) {
            setHydratedBookId(bookId)
            return
        }

        // Restore against the saved page count first. The live page count may still
        // be a loading placeholder and must not destroy a valid saved location.
        const normalized = normalizeProgressEntry(entry, type)
        latestEntryRef.current = normalized
        setCurrentPosition(normalized.position)
        setBookmarks(normalized.bookmarks)
        if (normalized.position > 0 || hasMeaningfulLocator(normalized.locator)) {
            setRestoredProgress({
                position: normalized.position,
                percent: calculatePercent(normalized.position, totalPages),
                locator: normalized.locator,
                updatedAt: normalized.updatedAt,
            })
        }

        if (sourceKey && sourceKey !== bookId) {
            persistProgressEntry(bookId, legacyId, normalized)
        }
        setHydratedBookId(bookId)
    }, [bookId, legacyId])

    useEffect(() => {
        let cancelled = false
        if (!bookId) {
            setRemoteHydratedBookId(bookId)
            return () => { cancelled = true }
        }
        if (typeof fetch !== 'function') {
            setRemoteHydratedBookId(bookId)
            return () => { cancelled = true }
        }
        const localAtRequestStart = resolveStoredEntry(getAllProgress(), bookId, legacyId).entry
        const progressVersionAtRequestStart = progressVersionRef.current
        ;(async () => {
            try {
                const remote = await readRemoteProgress(bookId)
                if (cancelled) return
                if (progressVersionRef.current !== progressVersionAtRequestStart) return
                if (remote && (!localAtRequestStart || isNewer(remote, localAtRequestStart))) {
                    const normalized = normalizeProgressEntry(remote, type)
                    persistProgressEntry(bookId, legacyId, normalized)
                    latestEntryRef.current = normalized
                    appliedLocatorKeyRef.current = null
                    setCurrentPosition(normalized.position)
                    setBookmarks(normalized.bookmarks)
                    if (normalized.position > 0 || hasMeaningfulLocator(normalized.locator)) {
                        setRestoredProgress({
                            position: normalized.position,
                            percent: normalized.percent,
                            locator: normalized.locator,
                            updatedAt: normalized.updatedAt,
                        })
                    } else {
                        setRestoredProgress(null)
                    }
                }
            } catch {
                // Offline and browser-only use continue safely with local storage.
            } finally {
                if (!cancelled) setRemoteHydratedBookId(bookId)
            }
        })()
        return () => { cancelled = true }
    }, [bookId, legacyId, type])

    useEffect(() => {
        if (!canAdjustPagination) return
        const maxPosition = Math.max(0, totalPages - 1)
        const savedLocator = latestEntryRef.current?.locator
        const locatorKey = savedLocator ? `${bookId}:${JSON.stringify(savedLocator)}:${totalPages}` : null
        const resolvedPosition = locatorKey && locatorKey !== appliedLocatorKeyRef.current && typeof locatorToPositionRef.current === 'function'
            ? locatorToPositionRef.current(savedLocator)
            : null
        if (locatorKey) appliedLocatorKeyRef.current = locatorKey
        setCurrentPosition((position) => clampPosition(
            Number.isFinite(resolvedPosition) ? resolvedPosition : position,
            totalPages,
        ))
        setBookmarks((items) => items.map((bookmark) => {
            const anchored = typeof locatorToPositionRef.current === 'function' && bookmark?.locator
                ? locatorToPositionRef.current(bookmark.locator)
                : null
            return Number.isFinite(anchored) ? { ...bookmark, position: clampPosition(anchored, totalPages) } : bookmark
        }).filter((bookmark) => Number.isFinite(bookmark?.position) && bookmark.position >= 0 && bookmark.position <= maxPosition))
    }, [bookId, canAdjustPagination, remoteHydratedBookId, totalPages])

    useEffect(() => {
        if (!canPersist) return
        latestEntryRef.current = buildProgressEntry(currentPosition, totalPages, type, bookmarks, resolveLocator())
    }, [bookmarks, canPersist, currentPosition, resolveLocator, totalPages, type])

    useEffect(() => {
        if (!bookId || !canPersist) return
        const timer = window.setTimeout(() => {
            persistProgressEntry(bookId, legacyId, latestEntryRef.current)
            if (canPersistRemote) void writeRemoteProgress(bookId, latestEntryRef.current).catch(() => {})
        }, 180)
        return () => window.clearTimeout(timer)
    }, [bookId, legacyId, currentPosition, totalPages, type, bookmarks, canPersist, canPersistRemote])

    useEffect(() => {
        if (!bookId || !canPersist) return
        const flush = () => {
            persistProgressEntry(bookId, legacyId, latestEntryRef.current)
            if (canPersistRemote) void writeRemoteProgress(bookId, latestEntryRef.current).catch(() => {})
        }
        window.addEventListener('pagehide', flush)
        return () => {
            window.removeEventListener('pagehide', flush)
            flush()
        }
    }, [bookId, legacyId, canPersist, canPersistRemote])

    const startOver = useCallback(() => {
        progressVersionRef.current += 1
        const resetEntry = buildProgressEntry(0, Math.max(1, totalPages), type, bookmarks, null)
        latestEntryRef.current = resetEntry
        setCurrentPosition(0)
        setRestoredProgress(null)
        appliedLocatorKeyRef.current = null
        if (bookId) {
            persistProgressEntry(bookId, legacyId, resetEntry)
            if (canPersistRemote) void writeRemoteProgress(bookId, resetEntry).catch(() => {})
        }
    }, [bookId, bookmarks, canPersistRemote, legacyId, totalPages, type])

    const addBookmark = useCallback((metadataOverride = null) => {
        const metadata = {
            ...resolveBookmarkMetadata(bookmarkSnapshot),
            ...resolveBookmarkMetadata(metadataOverride),
        }
        const ts = new Date().toISOString()
        const nextLocator = resolveLocator()
        progressVersionRef.current += 1
        setBookmarks(prev => {
            if (prev.some((bookmark) => {
                if (isSameBookmarkLocation(bookmark, nextLocator, currentPosition)) {
                    const nextExcerpt = metadata.excerpt || ''
                    const savedExcerpt = typeof bookmark.excerpt === 'string' ? bookmark.excerpt : ''
                    return !nextExcerpt || !savedExcerpt || nextExcerpt === savedExcerpt
                }
                return false
            })) return prev
            return [...prev, {
                id: createBookmarkId(ts),
                position: currentPosition,
                ...(metadata.label ? { label: metadata.label } : {}),
                savedAt: ts,
                locator: nextLocator,
                excerpt: metadata.excerpt || '',
                note: metadata.note || '',
                tag: metadata.tag || '',
                color: metadata.color || BOOKMARK_COLORS[prev.length % BOOKMARK_COLORS.length],
                important: metadata.important === true,
            }]
        })
    }, [bookmarkSnapshot, currentPosition, resolveLocator])

    const removeBookmark = useCallback((target) => {
        progressVersionRef.current += 1
        setBookmarks((items) => items.filter((bookmark) => !isSameBookmark(bookmark, target)))
    }, [])

    const updateBookmark = useCallback((target, patch) => {
        const metadata = resolveBookmarkMetadata(patch)
        if (Object.keys(metadata).length === 0) return
        progressVersionRef.current += 1
        setBookmarks((items) => items.map((bookmark) => (
            isSameBookmark(bookmark, target)
                ? { ...bookmark, ...metadata, updatedAt: new Date().toISOString() }
                : bookmark
        )))
    }, [])

    const goToBookmark = useCallback((target) => {
        const position = target && typeof target === 'object' ? target.position : target
        if (Number.isFinite(position)) setCurrentPosition(position)
    }, [])

    const percent = calculatePercent(currentPosition, totalPages)
    const isCurrentPageBookmarked = bookmarks.some((bookmark) => bookmark.position === currentPosition)

    return {
        currentPosition, setCurrentPosition,
        percent,
        bookmarks, addBookmark, removeBookmark, updateBookmark, goToBookmark, isCurrentPageBookmarked,
        restoredProgress, startOver,
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
