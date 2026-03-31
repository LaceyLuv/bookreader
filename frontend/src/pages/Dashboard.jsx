import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { getBookProgress } from '../hooks/useReadingProgress'
import { createT } from '../i18n'
import { readErrorDetail } from '../lib/readErrorDetail'

const API = API_BOOKS_BASE
const FOLDER_API = API_BOOKS_BASE.replace(/\/books$/, '/library/folders')
const STATUS_VALUES = ['unread', 'reading', 'completed', 'paused']
const SORT_VALUES = ['recent_read', 'recent_added', 'title', 'author', 'completed']
const FLAG_FILTER_VALUES = ['all', 'favorite', 'pinned', 'duplicates']

function parseTimestamp(value) {
    const parsed = Date.parse(value || '')
    return Number.isNaN(parsed) ? 0 : parsed
}

function getLastActivity(book) {
    return book.last_read_at || book.last_opened_at || null
}

function getFolderStats(books, folderId) {
    const folderBooks = books.filter((book) => book.library_folder_id === folderId)
    return {
        total: folderBooks.length,
        reading: folderBooks.filter((book) => book.reading_status === 'reading').length,
        completed: folderBooks.filter((book) => book.reading_status === 'completed').length,
    }
}

function parseNameList(value) {
    if (!value) return []
    const seen = new Set()
    return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
            const key = item.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
}

function compareNullableText(left, right) {
    const leftText = (left || '').trim()
    const rightText = (right || '').trim()
    if (!leftText && !rightText) return 0
    if (!leftText) return 1
    if (!rightText) return -1
    return leftText.localeCompare(rightText, undefined, { sensitivity: 'base' })
}

function compareRecentRead(left, right) {
    const activityDiff = parseTimestamp(getLastActivity(right)) - parseTimestamp(getLastActivity(left))
    if (activityDiff !== 0) return activityDiff
    return parseTimestamp(right.upload_date) - parseTimestamp(left.upload_date)
}

function normalizeSeriesName(value) {
    return String(value || '').trim()
}

function getSeriesKey(value) {
    return normalizeSeriesName(value).toLowerCase()
}

function parseSeriesIndexInput(value) {
    const text = String(value || '').trim()
    if (!text) return null
    const parsed = Number.parseInt(text, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return parsed
}

function normalizeDuplicateToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^0-9a-zㄱ-ㆎ가-힣]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
}

function getDuplicateGroupName(book) {
    return String(book?.duplicate_group || '').trim()
}

function getFallbackDuplicateLabel(book) {
    const title = String(book?.title || book?.filename || 'Untitled').trim()
    const author = String(book?.author || '').trim()
    return author ? `${title} - ${author}` : title
}

function getDuplicateGroupKey(book) {
    const manualName = getDuplicateGroupName(book)
    if (manualName) return `manual:${normalizeDuplicateToken(manualName)}`
    const title = normalizeDuplicateToken(book?.title || book?.filename)
    if (!title) return ''
    const author = normalizeDuplicateToken(book?.author)
    return `meta:${title}::${author || '_'}`
}

function getDuplicateGroupLabel(book) {
    return getDuplicateGroupName(book) || getFallbackDuplicateLabel(book)
}

function compareSeriesMembers(left, right) {
    const leftIndex = Number.isFinite(left.series_index) ? left.series_index : Number.MAX_SAFE_INTEGER
    const rightIndex = Number.isFinite(right.series_index) ? right.series_index : Number.MAX_SAFE_INTEGER
    if (leftIndex !== rightIndex) return leftIndex - rightIndex
    const titleDiff = compareNullableText(left.title, right.title)
    if (titleDiff !== 0) return titleDiff
    return compareNullableText(left.author, right.author)
}

function compareLibraryBooks(left, right, sortBy) {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1

    if (sortBy === 'recent_added') {
        const uploadDiff = parseTimestamp(right.upload_date) - parseTimestamp(left.upload_date)
        if (uploadDiff !== 0) return uploadDiff
        return compareRecentRead(left, right)
    }

    if (sortBy === 'title') {
        const titleDiff = compareNullableText(left.title, right.title)
        if (titleDiff !== 0) return titleDiff
        return compareNullableText(left.author, right.author)
    }

    if (sortBy === 'author') {
        const authorDiff = compareNullableText(left.author, right.author)
        if (authorDiff !== 0) return authorDiff
        return compareNullableText(left.title, right.title)
    }

    if (sortBy === 'completed') {
        const leftCompleted = left.reading_status === 'completed'
        const rightCompleted = right.reading_status === 'completed'
        if (leftCompleted !== rightCompleted) return leftCompleted ? -1 : 1
    }

    return compareRecentRead(left, right)
}

function compareDuplicateMembers(left, right) {
    if (Boolean(left.duplicate_lead) !== Boolean(right.duplicate_lead)) return left.duplicate_lead ? -1 : 1
    const versionDiff = compareNullableText(left.version_label, right.version_label)
    if (versionDiff !== 0) return versionDiff
    const formatDiff = compareNullableText(left.file_type, right.file_type)
    if (formatDiff !== 0) return formatDiff
    return compareLibraryBooks(left, right, 'recent_read')
}

function buildDuplicateIndex(books) {
    const fingerprintCounts = new Map()
    for (const book of books) {
        const fingerprint = String(book.content_fingerprint || '').trim().toLowerCase()
        if (!fingerprint) continue
        fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) || 0) + 1)
    }

    const groups = new Map()
    for (const book of books) {
        const key = getDuplicateGroupKey(book)
        if (!key) continue
        const existing = groups.get(key) || {
            key,
            label: getDuplicateGroupLabel(book),
            books: [],
        }
        existing.books.push(book)
        groups.set(key, existing)
    }

    const byBookId = {}
    const normalizedGroups = new Map()

    for (const [key, group] of groups.entries()) {
        if (group.books.length < 2) continue
        const sortedBooks = [...group.books].sort(compareDuplicateMembers)
        const exactDuplicateCount = sortedBooks.reduce((maxCount, book) => {
            const fingerprint = String(book.content_fingerprint || '').trim().toLowerCase()
            if (!fingerprint) return maxCount
            return Math.max(maxCount, fingerprintCounts.get(fingerprint) || 1)
        }, 1)
        const normalizedGroup = {
            key,
            label: group.label || getFallbackDuplicateLabel(sortedBooks[0]),
            books: sortedBooks,
            count: sortedBooks.length,
            exactDuplicateCount,
        }
        normalizedGroups.set(key, normalizedGroup)
        for (const book of sortedBooks) {
            const fingerprint = String(book.content_fingerprint || '').trim().toLowerCase()
            byBookId[book.id] = {
                key,
                label: normalizedGroup.label,
                count: normalizedGroup.count,
                exactDuplicateCount,
                exactDuplicate: Boolean(fingerprint) && (fingerprintCounts.get(fingerprint) || 0) > 1,
            }
        }
    }

    return { groups: normalizedGroups, byBookId }
}

function buildSeriesEntries(books, expandedSeries, groupSeries) {
    if (!groupSeries) {
        return books.map((book) => ({ type: 'book', key: book.id, book, nested: false, seriesKey: null }))
    }

    const groupedSeries = new Map()
    for (const book of books) {
        const key = getSeriesKey(book.series_name)
        if (!key) continue
        const existing = groupedSeries.get(key) || []
        existing.push(book)
        groupedSeries.set(key, existing)
    }

    for (const [key, items] of groupedSeries.entries()) {
        if (items.length < 2) {
            groupedSeries.delete(key)
            continue
        }
        groupedSeries.set(key, [...items].sort(compareSeriesMembers))
    }

    const emittedSeries = new Set()
    const entries = []

    for (const book of books) {
        const key = getSeriesKey(book.series_name)
        if (!key || !groupedSeries.has(key)) {
            entries.push({ type: 'book', key: book.id, book, nested: false, seriesKey: null })
            continue
        }
        if (emittedSeries.has(key)) continue
        emittedSeries.add(key)
        const seriesBooks = groupedSeries.get(key) || []
        const expanded = Boolean(expandedSeries[key])
        entries.push({
            type: 'series',
            key: `series:${key}`,
            seriesKey: key,
            seriesName: normalizeSeriesName(seriesBooks[0]?.series_name || book.series_name),
            books: seriesBooks,
            expanded,
        })
        if (expanded) {
            for (const member of seriesBooks) {
                entries.push({ type: 'book', key: member.id, book: member, nested: true, seriesKey: key })
            }
        }
    }

    return entries
}

function buildLibraryEntries(books, expandedSeries, groupSeries, duplicateIndex, expandedDuplicateGroups, groupDuplicates) {
    if (!groupDuplicates) {
        return buildSeriesEntries(books, expandedSeries, groupSeries)
    }

    const entries = []
    const emittedGroups = new Set()

    for (const book of books) {
        const duplicateMeta = duplicateIndex.byBookId[book.id]
        const duplicateGroup = duplicateMeta ? duplicateIndex.groups.get(duplicateMeta.key) : null
        if (!duplicateGroup) {
            entries.push({ type: 'book', key: book.id, book, nested: false, seriesKey: null })
            continue
        }
        if (emittedGroups.has(duplicateGroup.key)) continue
        emittedGroups.add(duplicateGroup.key)
        const expanded = Boolean(expandedDuplicateGroups[duplicateGroup.key])
        entries.push({
            type: 'duplicate',
            key: `duplicate:${duplicateGroup.key}`,
            duplicateKey: duplicateGroup.key,
            duplicateLabel: duplicateGroup.label,
            books: duplicateGroup.books,
            expanded,
            exactDuplicateCount: duplicateGroup.exactDuplicateCount,
        })
        if (expanded) {
            for (const member of duplicateGroup.books) {
                entries.push({ type: 'book', key: member.id, book: member, nested: true, duplicateKey: duplicateGroup.key })
            }
        }
    }

    return entries
}

function includesName(list, target) {
    const needle = (target || '').trim().toLowerCase()
    if (!needle) return false
    return (Array.isArray(list) ? list : []).some((item) => String(item).trim().toLowerCase() === needle)
}

function getStatusLabel(status, statusOptions, fallbackLabel) {
    return statusOptions.find((option) => option.value === status)?.label || fallbackLabel
}

function Dashboard() {
    const navigate = useNavigate()
    const [books, setBooks] = useState([])
    const [folders, setFolders] = useState([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [infoLoading, setInfoLoading] = useState(false)
    const [selectedInfo, setSelectedInfo] = useState(null)
    const [infoDraft, setInfoDraft] = useState(null)
    const [updatingIds, setUpdatingIds] = useState({})
    const [searchQuery, setSearchQuery] = useState('')
    const [sortBy, setSortBy] = useState('recent_read')
    const [statusFilter, setStatusFilter] = useState('all')
    const [flagFilter, setFlagFilter] = useState('all')
    const [selectedTag, setSelectedTag] = useState('all')
    const [selectedCollection, setSelectedCollection] = useState('all')
    const [selectedFolderId, setSelectedFolderId] = useState('all')
    const [groupSeries, setGroupSeries] = useState(true)
    const [expandedSeries, setExpandedSeries] = useState({})
    const [groupDuplicates, setGroupDuplicates] = useState(true)
    const [expandedDuplicateGroups, setExpandedDuplicateGroups] = useState({})
    const [folderDraft, setFolderDraft] = useState('')
    const [folderSaving, setFolderSaving] = useState(false)
    const [selectedBookIds, setSelectedBookIds] = useState([])
    const [bulkFolderId, setBulkFolderId] = useState('')
    const [bulkMoving, setBulkMoving] = useState(false)
    const fileInputRef = useRef(null)

    const savedLang = (() => {
        try {
            const s = localStorage.getItem('bookreader_settings')
            return s ? JSON.parse(s).lang || 'en' : 'en'
        } catch {
            return 'en'
        }
    })()
    const tt = createT(savedLang)
    const dateLocale = savedLang === 'ko' ? 'ko-KR' : 'en-US'
    const isKo = savedLang === 'ko'
    const statusOptions = STATUS_VALUES.map((value) => ({
        value,
        label: tt(`status${value.charAt(0).toUpperCase()}${value.slice(1)}`),
    }))
    const sortOptions = [
        { value: 'recent_read', label: tt('sortRecentRead') },
        { value: 'recent_added', label: tt('sortRecentAdded') },
        { value: 'title', label: tt('sortTitle') },
        { value: 'author', label: tt('sortAuthor') },
        { value: 'completed', label: tt('sortCompletedFirst') },
    ]
    const flagFilterOptions = [
        { value: 'all', label: tt('flagAllBooks') },
        { value: 'favorite', label: tt('flagFavorites') },
        { value: 'pinned', label: tt('flagPinned') },
        { value: 'duplicates', label: tt('flagDuplicates') },
    ]

    const fetchBooks = useCallback(async () => {
        try {
            const res = await fetch(API)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const list = Array.isArray(data) ? data : (Array.isArray(data?.books) ? data.books : [])
            setBooks(list)
        } catch (err) {
            console.error('Failed to fetch books', err)
        }
        setLoading(false)
    }, [])

    const fetchFolders = useCallback(async () => {
        try {
            const res = await fetch(FOLDER_API)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setFolders(Array.isArray(data) ? data : [])
        } catch (err) {
            console.error('Failed to fetch library folders', err)
        }
    }, [])

    useEffect(() => {
        fetchBooks()
        fetchFolders()
    }, [fetchBooks, fetchFolders])

    useEffect(() => {
        const bookIdSet = new Set(books.map((book) => book.id))
        setSelectedBookIds((prev) => prev.filter((bookId) => bookIdSet.has(bookId)))
        setSelectedInfo((prev) => {
            if (!prev) return prev
            const nextBook = books.find((book) => book.id === prev.id)
            return nextBook ? { ...prev, ...nextBook } : prev
        })
    }, [books])

    useEffect(() => {
        if (selectedFolderId !== 'all' && selectedFolderId !== 'none' && !folders.some((folder) => folder.id === selectedFolderId)) {
            setSelectedFolderId('all')
        }
        if (bulkFolderId && !folders.some((folder) => folder.id === bulkFolderId)) {
            setBulkFolderId('')
        }
        setSelectedInfo((prev) => {
            if (!prev) return prev
            if (!prev.library_folder_id) return { ...prev, library_folder_name: null }
            const matchedFolder = folders.find((folder) => folder.id === prev.library_folder_id)
            if (!matchedFolder) {
                return { ...prev, library_folder_id: null, library_folder_name: null }
            }
            if (prev.library_folder_name === matchedFolder.name) return prev
            return { ...prev, library_folder_name: matchedFolder.name }
        })
    }, [bulkFolderId, folders, selectedFolderId])

    useEffect(() => {
        if (!selectedInfo) {
            setInfoDraft(null)
            return
        }
        setInfoDraft({
            title: selectedInfo.title || '',
            author: selectedInfo.author || '',
            tagsText: Array.isArray(selectedInfo.tags) ? selectedInfo.tags.join(', ') : '',
            collectionsText: Array.isArray(selectedInfo.collections) ? selectedInfo.collections.join(', ') : '',
            folderId: selectedInfo.library_folder_id || '',
            seriesName: selectedInfo.series_name || '',
            seriesIndexText: Number.isFinite(selectedInfo.series_index) ? String(selectedInfo.series_index) : '',
            duplicateGroup: selectedInfo.duplicate_group || '',
            versionLabel: selectedInfo.version_label || '',
            duplicateLead: Boolean(selectedInfo.duplicate_lead),
        })
    }, [selectedInfo])

    const setBookUpdating = useCallback((bookId, busy) => {
        setUpdatingIds((prev) => {
            if (busy) return { ...prev, [bookId]: true }
            const next = { ...prev }
            delete next[bookId]
            return next
        })
    }, [])

    const mergeBook = useCallback((updatedBook) => {
        setBooks((prev) => prev.map((book) => (book.id === updatedBook.id ? { ...book, ...updatedBook } : book)))
        setSelectedInfo((prev) => (prev?.id === updatedBook.id ? { ...prev, ...updatedBook } : prev))
    }, [])

    const patchBook = useCallback(async (bookId, patch) => {
        setBookUpdating(bookId, true)
        try {
            const res = await fetch(`${API}/${bookId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            })
            if (!res.ok) throw new Error(await readErrorDetail(res, 'Update failed'))
            const data = await res.json()
            mergeBook(data)
            return data
        } finally {
            setBookUpdating(bookId, false)
        }
    }, [mergeBook, setBookUpdating])

    const handleUpload = async (file) => {
        if (!file) return
        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch(API, { method: 'POST', body: formData })
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('uploadFailed')))
            await fetchBooks()
        } catch (err) {
            console.error('Upload failed', err)
            alert(err.message || tt('uploadFailed'))
        }
        setUploading(false)
    }

    const handleAddFolder = useCallback(async () => {
        const name = folderDraft.trim()
        if (!name) {
            alert(tt('folderNameRequired'))
            return
        }
        setFolderSaving(true)
        try {
            const res = await fetch(FOLDER_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            })
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('createFolderFailed')))
            setFolderDraft('')
            await fetchFolders()
        } catch (err) {
            console.error('Failed to create folder', err)
            alert(err.message || tt('createFolderFailed'))
        }
        setFolderSaving(false)
    }, [fetchFolders, folderDraft])

    const handleRenameFolder = useCallback(async (folder) => {
        const nextName = window.prompt(tt('renameFolderPrompt'), folder.name)
        if (nextName === null) return
        const normalizedName = nextName.trim()
        if (!normalizedName || normalizedName === folder.name) return
        try {
            const res = await fetch(`${FOLDER_API}/${folder.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: normalizedName }),
            })
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('renameFolderFailed')))
            await Promise.all([fetchFolders(), fetchBooks()])
        } catch (err) {
            console.error('Failed to rename folder', err)
            alert(err.message || tt('renameFolderFailed'))
        }
    }, [fetchBooks, fetchFolders])

    const handleRemoveFolder = useCallback(async (folder) => {
        if (!window.confirm(formatDeleteFolderConfirm(folder.name))) return
        try {
            const res = await fetch(`${FOLDER_API}/${folder.id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('deleteFolderFailed')))
            setSelectedFolderId((prev) => (prev === folder.id ? 'all' : prev))
            setSelectedInfo((prev) => {
                if (!prev || prev.library_folder_id !== folder.id) return prev
                return { ...prev, library_folder_id: null, library_folder_name: null }
            })
            await Promise.all([fetchFolders(), fetchBooks()])
        } catch (err) {
            console.error('Failed to delete folder', err)
            alert(err.message || tt('deleteFolderFailed'))
        }
    }, [fetchBooks, fetchFolders])

    const toggleBookSelection = useCallback((bookId, checked) => {
        setSelectedBookIds((prev) => {
            const next = new Set(prev)
            if (checked) next.add(bookId)
            else next.delete(bookId)
            return Array.from(next)
        })
    }, [])

    const clearSelection = useCallback(() => {
        setSelectedBookIds([])
    }, [])

    const handleBulkMove = useCallback(async (targetFolderId = bulkFolderId || null) => {
        if (selectedBookIds.length === 0) {
            alert(tt('selectAtLeastOneBook'))
            return
        }
        setBulkMoving(true)
        const normalizedFolderId = targetFolderId || null
        try {
            const res = await fetch(`${FOLDER_API}/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    book_ids: selectedBookIds,
                    folder_id: normalizedFolderId,
                }),
            })
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('moveSelectedFailed')))
            const nextFolderName = folders.find((folder) => folder.id === normalizedFolderId)?.name || null
            setSelectedInfo((prev) => {
                if (!prev || !selectedBookIds.includes(prev.id)) return prev
                return {
                    ...prev,
                    library_folder_id: normalizedFolderId,
                    library_folder_name: nextFolderName,
                }
            })
            await Promise.all([fetchBooks(), fetchFolders()])
            setSelectedBookIds([])
        } catch (err) {
            console.error('Failed to move selected books', err)
            alert(err.message || tt('moveSelectedFailed'))
        }
        setBulkMoving(false)
    }, [bulkFolderId, fetchBooks, fetchFolders, folders, selectedBookIds])

    const handleDelete = async (book) => {
        if (!window.confirm(tt('deleteConfirm'))) return
        try {
            const res = await fetch(`${API}/${book.id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setBooks((prev) => prev.filter((item) => item.id !== book.id))
            setSelectedInfo((prev) => (prev?.id === book.id ? null : prev))
            setSelectedBookIds((prev) => prev.filter((id) => id !== book.id))
            await fetchFolders()
        } catch (err) {
            console.error('Delete failed', err)
        }
    }

    const openBook = useCallback((book) => {
        navigate(`/read/${book.file_type}/${book.id}`, {
            state: { legacyId: book.legacy_id ?? null },
        })
    }, [navigate])

    const openInfo = useCallback(async (book, event) => {
        event?.stopPropagation()
        setInfoLoading(true)
        setSelectedInfo({ ...book, path: '', stored_filename: book.filename })
        try {
            const res = await fetch(`${API}/${book.id}`)
            if (!res.ok) throw new Error(await readErrorDetail(res, tt('loadFileInfoFailed')))
            const data = await res.json()
            setSelectedInfo(data)
        } catch (err) {
            console.error('Failed to load file info', err)
            alert(err.message || tt('loadFileInfoFailed'))
        }
        setInfoLoading(false)
    }, [])

    const closeInfo = useCallback(() => {
        setSelectedInfo(null)
        setInfoLoading(false)
    }, [])

    const updateInfoDraft = useCallback((field, value) => {
        setInfoDraft((prev) => (prev ? { ...prev, [field]: value } : prev))
    }, [])

    const saveInfoDraft = useCallback(async () => {
        if (!selectedInfo || !infoDraft) return
        try {
            await patchBook(selectedInfo.id, {
                title: infoDraft.title.trim(),
                author: infoDraft.author.trim(),
                tags: parseNameList(infoDraft.tagsText),
                collections: parseNameList(infoDraft.collectionsText),
                library_folder_id: infoDraft.folderId || null,
                series_name: infoDraft.seriesName.trim() || null,
                series_index: parseSeriesIndexInput(infoDraft.seriesIndexText),
                duplicate_group: infoDraft.duplicateGroup.trim() || null,
                version_label: infoDraft.versionLabel.trim() || null,
                duplicate_lead: Boolean(infoDraft.duplicateLead),
            })
            await fetchFolders()
        } catch (err) {
            console.error('Metadata update failed', err)
            alert(err.message || tt('metadataUpdateFailed'))
        }
    }, [fetchFolders, infoDraft, patchBook, selectedInfo])

    const handleToggleFavorite = useCallback(async (book, event) => {
        event.stopPropagation()
        try {
            await patchBook(book.id, { favorite: !book.favorite })
        } catch (err) {
            console.error('Favorite update failed', err)
            alert(err.message || tt('favoriteUpdateFailed'))
        }
    }, [patchBook])

    const handleTogglePinned = useCallback(async (book, event) => {
        event.stopPropagation()
        try {
            await patchBook(book.id, { pinned: !book.pinned })
        } catch (err) {
            console.error('Pin update failed', err)
            alert(err.message || tt('pinnedUpdateFailed'))
        }
    }, [patchBook])

    const handleStatusChange = useCallback(async (book, nextStatus) => {
        try {
            await patchBook(book.id, { reading_status: nextStatus })
        } catch (err) {
            console.error('Status update failed', err)
            alert(err.message || tt('statusUpdateFailed'))
        }
    }, [patchBook])

    const handleDrop = (event) => {
        event.preventDefault()
        setDragOver(false)
        if (event.dataTransfer.files[0]) handleUpload(event.dataTransfer.files[0])
    }

    const handleDragOver = (event) => {
        event.preventDefault()
        setDragOver(true)
    }

    const handleDragLeave = () => setDragOver(false)

    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const formatDateTime = (value) => {
        if (!value) return tt('never')
        const parsed = parseTimestamp(value)
        if (!parsed) return value
        return new Intl.DateTimeFormat(dateLocale, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(parsed))
    }

    const formatBookCount = (count) => (isKo ? `${count}?` : `${count} books`)
    const formatReadingCount = (count) => (isKo ? `?? ? ${count}?` : `${count} reading`)
    const formatCompletedCount = (count) => (isKo ? `?? ${count}?` : `${count} completed`)
    const formatUpdatedLabel = (value) => `${tt('updated')} ${formatDateTime(value)}`
    const formatLastOpenedLabel = (value) => `${tt('lastOpened')} ${formatDateTime(value)}`
    const formatProgressLabel = (progress) => (progress ? (isKo ? `${tt('read')} ${progress.percent}%` : `${progress.percent}% read`) : tt('noSavedProgress'))
    const formatNotesCount = (count) => (isKo ? `${tt('note')} ${count}?` : `${count} notes`)
    const formatAnnotationsCount = (count) => (isKo ? `${tt('annotations')} ${count}?` : `${count} annotations`)
    const formatVersionsCount = (count) => (isKo ? `${tt('version')} ${count}?` : `${count} versions`)
    const formatExactCopiesCount = (count) => (isKo ? `${tt('sameFile')} ${count}?` : `${count} exact copies`)
    const formatLeadVersion = (value) => (isKo ? `${tt('lead')} ${value}` : `Lead ${value}`)
    const formatEditionLabel = (value) => (isKo ? `?? ${value}` : `Editions ${value}`)
    const formatVersionDetailLabel = (value) => (isKo ? `${tt('version')} ${value}` : `Version ${value}`)
    const formatFolderDetailLabel = (value) => (isKo ? `${tt('folder')} ${value}` : `Folder ${value}`)
    const formatShownSummary = (shown, total) => (isKo ? `${shown}? ?? / ?? ${total}?` : `${shown} shown / ${total} total`)
    const formatSelectedSummary = (count) => (isKo ? `?? ????? ???? ${count}? ???.` : `${count} selected across the current library view.`)
    const formatSeriesVolume = (index) => (isKo ? `? ${index}` : `Vol. ${index}`)
    const formatSeriesDisplay = (name, index) => {
        if (!name) return tt('none')
        if (!Number.isFinite(index)) return name
        return `${name} - ${formatSeriesVolume(index)}`
    }
    const formatDeleteFolderConfirm = (name) => (isKo
        ? `?? "${name}"? ?????? ?? ?????? ?? ??? ?????.`
        : `Delete folder "${name}"? Books will stay in the library and become unassigned.`)

    const typeBadgeClass = (type) => {
        if (type === 'txt') return 'badge badge-txt'
        if (type === 'epub') return 'badge badge-epub'
        return 'badge badge-zip'
    }

    const allTags = useMemo(() => {
        return Array.from(new Set(books.flatMap((book) => book.tags || []).map((tag) => String(tag).trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    }, [books])

    const allCollections = useMemo(() => {
        return Array.from(new Set(books.flatMap((book) => book.collections || []).map((name) => String(name).trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    }, [books])

    const folderStatsById = useMemo(() => Object.fromEntries(folders.map((folder) => [folder.id, getFolderStats(books, folder.id)])), [books, folders])
    const duplicateIndex = useMemo(() => buildDuplicateIndex(books), [books])
    const selectedBookIdSet = useMemo(() => new Set(selectedBookIds), [selectedBookIds])

    const recentBooks = useMemo(() => {
        return [...books]
            .filter((book) => getLastActivity(book))
            .sort(compareRecentRead)
            .slice(0, 4)
    }, [books])

    const filteredBooks = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        return [...books]
            .filter((book) => {
                if (query) {
                    const haystack = [
                        book.title,
                        book.author,
                        book.filename,
                        book.series_name,
                        book.duplicate_group,
                        book.version_label,
                        book.library_folder_name,
                        ...(book.tags || []),
                        ...(book.collections || []),
                    ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase()
                    if (!haystack.includes(query)) return false
                }
                if (statusFilter !== 'all' && book.reading_status !== statusFilter) return false
                if (flagFilter === 'favorite' && !book.favorite) return false
                if (flagFilter === 'pinned' && !book.pinned) return false
                if (flagFilter === 'duplicates' && !duplicateIndex.byBookId[book.id]?.count) return false
                if (selectedTag !== 'all' && !includesName(book.tags, selectedTag)) return false
                if (selectedCollection !== 'all' && !includesName(book.collections, selectedCollection)) return false
                if (selectedFolderId === 'none' && book.library_folder_id) return false
                if (selectedFolderId !== 'all' && selectedFolderId !== 'none' && book.library_folder_id !== selectedFolderId) return false
                return true
            })
            .sort((left, right) => compareLibraryBooks(left, right, sortBy))
    }, [books, duplicateIndex, flagFilter, searchQuery, selectedCollection, selectedFolderId, selectedTag, sortBy, statusFilter])

    const activeFilterCount = [
        searchQuery.trim() ? 1 : 0,
        statusFilter !== 'all' ? 1 : 0,
        flagFilter !== 'all' ? 1 : 0,
        selectedTag !== 'all' ? 1 : 0,
        selectedCollection !== 'all' ? 1 : 0,
        selectedFolderId !== 'all' ? 1 : 0,
    ].reduce((total, value) => total + value, 0)

    const clearFilters = useCallback(() => {
        setSearchQuery('')
        setStatusFilter('all')
        setFlagFilter('all')
        setSelectedTag('all')
        setSelectedCollection('all')
        setSelectedFolderId('all')
        setSortBy('recent_read')
    }, [])

    const toggleSeriesExpanded = useCallback((seriesKey) => {
        setExpandedSeries((prev) => ({ ...prev, [seriesKey]: !prev[seriesKey] }))
    }, [])

    const toggleDuplicateExpanded = useCallback((duplicateKey) => {
        setExpandedDuplicateGroups((prev) => ({ ...prev, [duplicateKey]: !prev[duplicateKey] }))
    }, [])

    const libraryEntries = useMemo(
        () => buildLibraryEntries(filteredBooks, expandedSeries, groupSeries, duplicateIndex, expandedDuplicateGroups, groupDuplicates),
        [duplicateIndex, expandedDuplicateGroups, expandedSeries, filteredBooks, groupDuplicates, groupSeries],
    )

    const visibleBookIds = useMemo(
        () => libraryEntries.filter((entry) => entry.type === 'book').map((entry) => entry.book.id),
        [libraryEntries],
    )
    const allVisibleSelected = visibleBookIds.length > 0 && visibleBookIds.every((bookId) => selectedBookIdSet.has(bookId))

    const toggleVisibleSelection = useCallback(() => {
        setSelectedBookIds((prev) => {
            const next = new Set(prev)
            const shouldClear = visibleBookIds.length > 0 && visibleBookIds.every((bookId) => next.has(bookId))
            for (const bookId of visibleBookIds) {
                if (shouldClear) next.delete(bookId)
                else next.add(bookId)
            }
            return Array.from(next)
        })
    }, [visibleBookIds])

    const mutedTextColor = 'color-mix(in srgb, var(--app-fg) 72%, var(--app-bg) 28%)'
    const subtleTextColor = 'color-mix(in srgb, var(--app-fg) 58%, var(--app-bg) 42%)'
    const buttonBorder = '1px solid color-mix(in srgb, var(--app-fg) 10%, var(--app-bg) 90%)'
    const chipBaseStyle = { border: buttonBorder, color: 'var(--app-fg)' }
    const inputStyle = { border: buttonBorder, backgroundColor: 'transparent', color: 'var(--app-fg)' }

    const renderBookCard = (book, { nested = false } = {}) => {
        const prog = getBookProgress(book.id, book.legacy_id)
        const isUpdating = Boolean(updatingIds[book.id])
        const isSelected = selectedBookIdSet.has(book.id)
        const seriesLabel = normalizeSeriesName(book.series_name)
        const seriesVolume = Number.isFinite(book.series_index) ? formatSeriesVolume(book.series_index) : null
        const duplicateMeta = duplicateIndex.byBookId[book.id] || null
        const duplicateLabel = duplicateMeta?.label || getDuplicateGroupName(book)
        const versionLabel = String(book.version_label || '').trim()
        const folderLabel = String(book.library_folder_name || '').trim()

        return (
            <div key={book.id} className={nested ? 'ml-4 border-l pl-4' : ''} style={nested ? { borderColor: 'color-mix(in srgb, var(--app-fg) 10%, var(--app-bg) 90%)' } : undefined}>
                <div className="glass-card flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start">
                    <label className="flex items-start pt-1" onClick={(event) => event.stopPropagation()}>
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => toggleBookSelection(book.id, event.target.checked)}
                            className="mt-1 h-4 w-4 rounded"
                        />
                    </label>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openBook(book)}>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className={typeBadgeClass(book.file_type)}>{book.file_type.toUpperCase()}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{getStatusLabel(book.reading_status, statusOptions, tt('statusUnread'))}</span>
                            {folderLabel && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#2f9e44]">{tt('folder')}</span>}
                            {book.pinned && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#d9480f]">{tt('pinned')}</span>}
                            {book.favorite && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#f59f00]">{tt('favorite')}</span>}
                            {book.annotation_count > 0 && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#5f3dc4]">{formatNotesCount(book.annotation_count)}</span>}
                            {duplicateMeta && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#1c7ed6]">{formatVersionsCount(duplicateMeta.count)}</span>}
                            {book.duplicate_lead && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#2b8a3e]">{tt('primary')}</span>}
                            {duplicateMeta?.exactDuplicate && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#0b7285]">{tt('sameFile')}</span>}
                        </div>
                        <div className="truncate text-sm font-semibold">{book.title}</div>
                        {seriesLabel && (
                            <div className="mt-1 text-[11px]" style={{ color: mutedTextColor }}>
                                {seriesLabel}{seriesVolume ? ` - ${seriesVolume}` : ''}
                            </div>
                        )}
                        {(duplicateLabel || versionLabel || folderLabel) && (
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: mutedTextColor }}>
                                {duplicateLabel && <span>{formatEditionLabel(duplicateLabel)}</span>}
                                {versionLabel && <span>{formatVersionDetailLabel(versionLabel)}</span>}
                                {folderLabel && <span>{formatFolderDetailLabel(folderLabel)}</span>}
                            </div>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: subtleTextColor }}>
                            <span>{formatSize(book.size)}</span>
                            <span>{book.author || tt('unknownAuthor')}</span>
                            {prog && <span className="text-[#5c7cfa]">{prog.percent}%</span>}
                            <span>{formatLastOpenedLabel(getLastActivity(book))}</span>
                            {book.annotation_count > 0 && <span className="text-[#5f3dc4]">{formatAnnotationsCount(book.annotation_count)}</span>}
                        </div>
                        {((book.tags || []).length > 0 || (book.collections || []).length > 0) && (
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                {(book.tags || []).map((tag) => (
                                    <span key={`${book.id}-tag-${tag}`} className="rounded-full px-2.5 py-1" style={chipBaseStyle}>#{tag}</span>
                                ))}
                                {(book.collections || []).map((collection) => (
                                    <span key={`${book.id}-collection-${collection}`} className="rounded-full px-2.5 py-1" style={chipBaseStyle}>{collection}</span>
                                ))}
                            </div>
                        )}
                    </button>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <select
                            value={book.reading_status || 'unread'}
                            disabled={isUpdating}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => handleStatusChange(book, event.target.value)}
                            className="h-8 rounded-lg px-2 text-[11px]"
                            style={inputStyle}
                        >
                            {statusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={isUpdating}
                            onClick={(event) => handleToggleFavorite(book, event)}
                            className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed"
                            style={{ ...chipBaseStyle, color: book.favorite ? '#f59f00' : 'var(--app-fg)' }}
                        >
                            {tt('favorite')}
                        </button>
                        <button
                            type="button"
                            disabled={isUpdating}
                            onClick={(event) => handleTogglePinned(book, event)}
                            className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed"
                            style={{ ...chipBaseStyle, color: book.pinned ? '#d9480f' : 'var(--app-fg)' }}
                        >
                            {tt('pinned')}
                        </button>
                        <button
                            type="button"
                            onClick={(event) => openInfo(book, event)}
                            className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80"
                            style={chipBaseStyle}
                        >
                            {tt('info')}
                        </button>
                        <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); handleDelete(book) }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                            style={chipBaseStyle}
                            title={tt('deleteLabel')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    const hasUnassignedBooks = books.some((book) => !book.library_folder_id)

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)' }}>
            <div className="mx-auto max-w-6xl px-6 py-12">
                <div className="mb-10 text-center">
                    <h1 className="mb-2 text-3xl font-bold tracking-tight">{tt('appTitle')}</h1>
                    <p className="text-sm" style={{ color: mutedTextColor }}>{tt('appSubtitle')}</p>
                </div>

                <div
                    className={`glass-card mb-8 flex cursor-pointer flex-col items-center justify-center px-6 py-10 transition-all ${dragOver ? 'scale-[1.01] ring-2 ring-[#5c7cfa]' : 'hover:shadow-sm'}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.epub,.zip"
                        className="hidden"
                        onChange={(event) => {
                            if (event.target.files[0]) handleUpload(event.target.files[0])
                            event.target.value = ''
                        }}
                    />
                    {uploading ? (
                        <div className="flex items-center gap-3">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" />
                            <span className="text-sm" style={{ color: mutedTextColor }}>{tt('uploading')}</span>
                        </div>
                    ) : (
                        <>
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-30"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                            <p className="mb-1 text-sm" style={{ color: mutedTextColor }}>{tt('uploadPrompt')}</p>
                            <p className="text-[11px]" style={{ color: subtleTextColor }}>{tt('supportedFiles')}</p>
                        </>
                    )}
                </div>

                <div className="glass-card mb-8 px-5 py-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                            <h2 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('libraryFoldersTitle')}</h2>
                            <p className="mt-2 text-sm" style={{ color: subtleTextColor }}>{tt('libraryFoldersDescription')}</p>
                        </div>
                        <div className="flex w-full gap-3 xl:max-w-xl">
                            <input
                                value={folderDraft}
                                onChange={(event) => setFolderDraft(event.target.value)}
                                placeholder={tt('folderNamePlaceholder')}
                                className="h-10 flex-1 rounded-xl px-3 text-sm"
                                style={inputStyle}
                            />
                            <button type="button" onClick={handleAddFolder} disabled={folderSaving} className="h-10 rounded-xl px-4 text-sm font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed" style={chipBaseStyle}>
                                {folderSaving ? tt('adding') : tt('addFolder')}
                            </button>
                        </div>
                    </div>

                    {folders.length === 0 ? (
                        <p className="mt-4 text-sm" style={{ color: mutedTextColor }}>{tt('noFoldersYet')}</p>
                    ) : (
                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            {folders.map((folder) => {
                                const stats = folderStatsById[folder.id] || { total: 0, reading: 0, completed: 0 }
                                return (
                                    <div key={folder.id} className="rounded-2xl px-4 py-4" style={{ border: buttonBorder }}>
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('shelf')}</div>
                                                <div className="truncate text-sm font-semibold">{folder.name}</div>
                                                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: subtleTextColor }}>
                                                    <span>{formatBookCount(stats.total)}</span>
                                                    {stats.reading > 0 && <span>{formatReadingCount(stats.reading)}</span>}
                                                    {stats.completed > 0 && <span>{formatCompletedCount(stats.completed)}</span>}
                                                    <span>{formatUpdatedLabel(folder.updated_at)}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button type="button" onClick={() => setSelectedFolderId((prev) => prev === folder.id ? 'all' : folder.id)} className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80" style={selectedFolderId === folder.id ? { ...chipBaseStyle, color: '#2f9e44' } : chipBaseStyle}>
                                                    {selectedFolderId === folder.id ? tt('filtered') : tt('filter')}
                                                </button>
                                                {selectedBookIds.length > 0 && (
                                                    <button type="button" onClick={() => handleBulkMove(folder.id)} disabled={bulkMoving} className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed" style={chipBaseStyle}>
                                                        {tt('moveSelected')}
                                                    </button>
                                                )}
                                                <button type="button" onClick={() => handleRenameFolder(folder)} className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80" style={chipBaseStyle}>
                                                    {tt('rename')}
                                                </button>
                                                <button type="button" onClick={() => handleRemoveFolder(folder)} className="h-8 rounded-lg px-3 text-[11px] font-medium transition-opacity hover:opacity-80" style={chipBaseStyle}>
                                                    {tt('deleteLabel')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {recentBooks.length > 0 && (
                    <div className="mb-8">
                        <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('recentReads')}</h2>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {recentBooks.map((book) => {
                                const prog = getBookProgress(book.id, book.legacy_id)
                                const folderLabel = String(book.library_folder_name || '').trim()
                                return (
                                    <button
                                        key={`recent-${book.id}`}
                                        type="button"
                                        className="glass-card text-left px-5 py-4 transition-all hover:shadow-sm"
                                        onClick={() => openBook(book)}
                                    >
                                        <div className="mb-2 flex items-center gap-2">
                                            <span className={typeBadgeClass(book.file_type)}>{book.file_type.toUpperCase()}</span>
                                            {folderLabel && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#2f9e44]">{folderLabel}</span>}
                                            {book.pinned && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#d9480f]">{tt('pinned')}</span>}
                                            {book.favorite && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#f59f00]">{tt('favorite')}</span>}
                                            {book.annotation_count > 0 && <span className="text-[10px] font-semibold uppercase tracking-widest text-[#5f3dc4]">{formatNotesCount(book.annotation_count)}</span>}
                                        </div>
                                        <div className="truncate text-sm font-semibold">{book.title}</div>
                                        <div className="mt-1 text-[11px]" style={{ color: subtleTextColor }}>
                                            {formatProgressLabel(prog)}
                                        </div>
                                        <div className="mt-2 text-[11px]" style={{ color: mutedTextColor }}>
                                            {formatLastOpenedLabel(getLastActivity(book))}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                <div className="glass-card mb-6 px-5 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={tt('searchLibraryPlaceholder')}
                            className="h-10 flex-1 rounded-xl px-3 text-sm"
                            style={inputStyle}
                        />
                        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-10 rounded-xl px-3 text-sm" style={inputStyle}>
                            {sortOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-xl px-3 text-sm" style={inputStyle}>
                            <option value="all">{tt('allStatuses')}</option>
                            {statusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <select value={flagFilter} onChange={(event) => setFlagFilter(event.target.value)} className="h-10 rounded-xl px-3 text-sm" style={inputStyle}>
                            {flagFilterOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button type="button" onClick={clearFilters} className="h-10 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-80" style={chipBaseStyle}>
                            {tt('resetFilters')} {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
                        </button>
                        <button type="button" onClick={() => setGroupSeries((prev) => !prev)} className="h-10 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-80" style={groupSeries ? { ...chipBaseStyle, color: '#5c7cfa' } : chipBaseStyle}>
                            {tt('groupSeries')}
                        </button>
                        <button type="button" onClick={() => setGroupDuplicates((prev) => !prev)} className="h-10 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-80" style={groupDuplicates ? { ...chipBaseStyle, color: '#1c7ed6' } : chipBaseStyle}>
                            {tt('groupDuplicates')}
                        </button>
                    </div>

                    {allTags.length > 0 && (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('tagsLabel')}</span>
                            <button type="button" onClick={() => setSelectedTag('all')} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedTag === 'all' ? { ...chipBaseStyle, color: '#5c7cfa' } : chipBaseStyle}>{tt('all')}</button>
                            {allTags.map((tag) => (
                                <button key={tag} type="button" onClick={() => setSelectedTag((prev) => prev === tag ? 'all' : tag)} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedTag === tag ? { ...chipBaseStyle, color: '#5c7cfa' } : chipBaseStyle}>#{tag}</button>
                            ))}
                        </div>
                    )}

                    {allCollections.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('collectionsLabel')}</span>
                            <button type="button" onClick={() => setSelectedCollection('all')} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedCollection === 'all' ? { ...chipBaseStyle, color: '#5c7cfa' } : chipBaseStyle}>{tt('all')}</button>
                            {allCollections.map((collection) => (
                                <button key={collection} type="button" onClick={() => setSelectedCollection((prev) => prev === collection ? 'all' : collection)} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedCollection === collection ? { ...chipBaseStyle, color: '#5c7cfa' } : chipBaseStyle}>{collection}</button>
                            ))}
                        </div>
                    )}

                    {(folders.length > 0 || hasUnassignedBooks) && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('folders')}</span>
                            <button type="button" onClick={() => setSelectedFolderId('all')} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedFolderId === 'all' ? { ...chipBaseStyle, color: '#2f9e44' } : chipBaseStyle}>{tt('all')}</button>
                            {hasUnassignedBooks && (
                                <button type="button" onClick={() => setSelectedFolderId((prev) => prev === 'none' ? 'all' : 'none')} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedFolderId === 'none' ? { ...chipBaseStyle, color: '#2f9e44' } : chipBaseStyle}>{tt('unassigned')}</button>
                            )}
                            {folders.map((folder) => (
                                <button key={folder.id} type="button" onClick={() => setSelectedFolderId((prev) => prev === folder.id ? 'all' : folder.id)} className="rounded-full px-3 py-1 text-[11px] transition-opacity hover:opacity-80" style={selectedFolderId === folder.id ? { ...chipBaseStyle, color: '#2f9e44' } : chipBaseStyle}>{folder.name}</button>
                            ))}
                        </div>
                    )}
                </div>

                {visibleBookIds.length > 0 && (
                    <div className="glass-card mb-6 px-5 py-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                            <div>
                                <h2 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('selection')}</h2>
                                <p className="mt-1 text-sm" style={{ color: subtleTextColor }}>{formatSelectedSummary(selectedBookIds.length)}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={toggleVisibleSelection} className="h-10 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-80" style={chipBaseStyle}>
                                    {allVisibleSelected ? tt('unselectVisible') : tt('selectVisible')}
                                </button>
                                {selectedBookIds.length > 0 && (
                                    <>
                                        <select value={bulkFolderId} onChange={(event) => setBulkFolderId(event.target.value)} className="h-10 rounded-xl px-3 text-sm" style={inputStyle}>
                                            <option value="">{tt('noFolder')}</option>
                                            {folders.map((folder) => (
                                                <option key={folder.id} value={folder.id}>{folder.name}</option>
                                            ))}
                                        </select>
                                        <button type="button" onClick={() => handleBulkMove()} disabled={bulkMoving} className="h-10 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed" style={chipBaseStyle}>
                                            {bulkMoving ? tt('moving') : tt('moveSelected')}
                                        </button>
                                        <button type="button" onClick={clearSelection} className="h-10 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-80" style={chipBaseStyle}>
                                            {tt('clear')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('library')}</h2>
                        <span className="text-[11px]" style={{ color: subtleTextColor }}>{formatShownSummary(filteredBooks.length, books.length)}</span>
                    </div>
                    {loading ? (
                        <div className="flex justify-center py-16">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                        </div>
                    ) : filteredBooks.length === 0 ? (
                        <div className="py-16 text-center" style={{ color: mutedTextColor }}>
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-4 opacity-30"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                            <p className="mb-1 font-medium">{tt('noBooksMatchFilters')}</p>
                            <p className="text-sm" style={{ color: subtleTextColor }}>{tt('widenLibraryView')}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {libraryEntries.map((entry) => {
                                if (entry.type === 'duplicate') {
                                    const leadBook = entry.books.find((book) => book.duplicate_lead) || entry.books[0]
                                    return (
                                        <div key={entry.key} className="glass-card px-5 py-4">
                                            <button type="button" className="flex w-full items-center justify-between gap-4 text-left" onClick={() => toggleDuplicateExpanded(entry.duplicateKey)}>
                                                <div className="min-w-0">
                                                    <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('duplicateGroupTitle')}</div>
                                                    <div className="truncate text-sm font-semibold">{entry.duplicateLabel}</div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: subtleTextColor }}>
                                                        <span>{formatVersionsCount(entry.books.length)}</span>
                                                        {entry.exactDuplicateCount > 1 && <span>{formatExactCopiesCount(entry.exactDuplicateCount)}</span>}
                                                        {leadBook?.version_label && <span>{formatLeadVersion(leadBook.version_label)}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 text-[11px]" style={{ color: mutedTextColor }}>
                                                    <span>{entry.expanded ? tt('hideVersions') : tt('showVersions')}</span>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: entry.expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}><path d="m9 18 6-6-6-6" /></svg>
                                                </div>
                                            </button>
                                        </div>
                                    )
                                }
                                if (entry.type === 'series') {
                                    const completedCount = entry.books.filter((book) => book.reading_status === 'completed').length
                                    return (
                                        <div key={entry.key} className="glass-card px-5 py-4">
                                            <button type="button" className="flex w-full items-center justify-between gap-4 text-left" onClick={() => toggleSeriesExpanded(entry.seriesKey)}>
                                                <div className="min-w-0">
                                                    <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('seriesLabel')}</div>
                                                    <div className="truncate text-sm font-semibold">{entry.seriesName}</div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: subtleTextColor }}>
                                                        <span>{formatBookCount(entry.books.length)}</span>
                                                        <span>{formatCompletedCount(completedCount)}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 text-[11px]" style={{ color: mutedTextColor }}>
                                                    <span>{entry.expanded ? tt('hideVolumes') : tt('showVolumes')}</span>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: entry.expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}><path d="m9 18 6-6-6-6" /></svg>
                                                </div>
                                            </button>
                                        </div>
                                    )
                                }
                                return renderBookCard(entry.book, { nested: entry.nested })
                            })}
                        </div>
                    )}
                </div>
            </div>

            {selectedInfo && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4" onClick={closeInfo}>
                    <div className="flex min-h-full items-start justify-center py-4 sm:items-center">
                        <div
                            className="glass-card flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex shrink-0 items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: buttonBorder }}>
                                <div>
                                    <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('fileInfo')}</div>
                                    <h3 className="mt-1 text-lg font-semibold">{selectedInfo.title}</h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeInfo}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
                                    style={chipBaseStyle}
                                    title={tt('close')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </button>
                            </div>
                            {infoLoading || !infoDraft ? (
                                <div className="flex flex-1 items-center justify-center px-6 py-12">
                                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                                </div>
                            ) : (
                                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
                                    <div className="grid gap-4 pt-5 md:grid-cols-2">
                                        <label className="flex flex-col gap-1 text-sm">
                                            <span style={{ color: mutedTextColor }}>{tt('titleLabel')}</span>
                                            <input value={infoDraft.title} onChange={(event) => updateInfoDraft('title', event.target.value)} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm">
                                            <span style={{ color: mutedTextColor }}>{tt('authorLabel')}</span>
                                            <input value={infoDraft.author} onChange={(event) => updateInfoDraft('author', event.target.value)} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm md:col-span-2">
                                            <span style={{ color: mutedTextColor }}>{tt('tagsLabel')}</span>
                                            <input value={infoDraft.tagsText} onChange={(event) => updateInfoDraft('tagsText', event.target.value)} placeholder={tt('tagsPlaceholder')} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm md:col-span-2">
                                            <span style={{ color: mutedTextColor }}>{tt('collectionsLabel')}</span>
                                            <input value={infoDraft.collectionsText} onChange={(event) => updateInfoDraft('collectionsText', event.target.value)} placeholder={tt('collectionsPlaceholder')} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm md:col-span-2">
                                            <span style={{ color: mutedTextColor }}>{tt('libraryFolder')}</span>
                                            <select value={infoDraft.folderId} onChange={(event) => updateInfoDraft('folderId', event.target.value)} className="h-10 rounded-xl px-3" style={inputStyle}>
                                                <option value="">{tt('noFolder')}</option>
                                                {folders.map((folder) => (
                                                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm">
                                            <span style={{ color: mutedTextColor }}>{tt('seriesLabel')}</span>
                                            <input value={infoDraft.seriesName} onChange={(event) => updateInfoDraft('seriesName', event.target.value)} placeholder={tt('seriesPlaceholder')} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm">
                                            <span style={{ color: mutedTextColor }}>{tt('volumeLabel')}</span>
                                            <input value={infoDraft.seriesIndexText} onChange={(event) => updateInfoDraft('seriesIndexText', event.target.value)} placeholder="1" inputMode="numeric" className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm">
                                            <span style={{ color: mutedTextColor }}>{tt('duplicateGroupLabel')}</span>
                                            <input value={infoDraft.duplicateGroup} onChange={(event) => updateInfoDraft('duplicateGroup', event.target.value)} placeholder={tt('duplicateGroupPlaceholder')} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex flex-col gap-1 text-sm">
                                            <span style={{ color: mutedTextColor }}>{tt('versionLabelLabel')}</span>
                                            <input value={infoDraft.versionLabel} onChange={(event) => updateInfoDraft('versionLabel', event.target.value)} placeholder={tt('versionPlaceholder')} className="h-10 rounded-xl px-3" style={inputStyle} />
                                        </label>
                                        <label className="flex items-center gap-3 text-sm md:col-span-2">
                                            <input type="checkbox" checked={Boolean(infoDraft.duplicateLead)} onChange={(event) => updateInfoDraft('duplicateLead', event.target.checked)} />
                                            <span style={{ color: mutedTextColor }}>{tt('primaryEdition')}</span>
                                        </label>
                                    </div>

                                    <div className="mt-4 flex justify-end">
                                        <button type="button" onClick={saveInfoDraft} disabled={Boolean(updatingIds[selectedInfo.id])} className="h-10 rounded-xl px-4 text-sm font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed" style={chipBaseStyle}>
                                            {tt('saveMetadata')}
                                        </button>
                                    </div>

                                    <div className="mt-6 grid gap-3 text-sm md:grid-cols-[140px_minmax(0,1fr)]">
                                        <div style={{ color: mutedTextColor }}>{tt('displayName')}</div>
                                        <div className="break-all">{selectedInfo.filename}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('storedName')}</div>
                                        <div className="break-all">{selectedInfo.stored_filename || selectedInfo.filename}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('path')}</div>
                                        <div className="break-all">{selectedInfo.path || tt('unavailable')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('format')}</div>
                                        <div>{String(selectedInfo.file_type || '').toUpperCase()}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('libraryFolder')}</div>
                                        <div>{selectedInfo.library_folder_name || tt('none')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('size')}</div>
                                        <div>{formatSize(selectedInfo.size || 0)}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('status')}</div>
                                        <div>{getStatusLabel(selectedInfo.reading_status, statusOptions, tt('statusUnread'))}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('favorite')}</div>
                                        <div>{selectedInfo.favorite ? tt('yes') : tt('no')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('pinned')}</div>
                                        <div>{selectedInfo.pinned ? tt('yes') : tt('no')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('seriesLabel')}</div>
                                        <div>{formatSeriesDisplay(selectedInfo.series_name, selectedInfo.series_index)}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('duplicateGroupLabel')}</div>
                                        <div>{selectedInfo.duplicate_group || tt('autoDetected')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('version')}</div>
                                        <div>{selectedInfo.version_label || tt('none')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('primaryEdition')}</div>
                                        <div>{selectedInfo.duplicate_lead ? tt('yes') : tt('no')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('fingerprint')}</div>
                                        <div className="break-all">{selectedInfo.content_fingerprint || tt('unavailable')}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('annotations')}</div>
                                        <div>{selectedInfo.annotation_count || 0}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('added')}</div>
                                        <div>{formatDateTime(selectedInfo.upload_date)}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('lastOpened')}</div>
                                        <div>{formatDateTime(selectedInfo.last_opened_at)}</div>
                                        <div style={{ color: mutedTextColor }}>{tt('lastRead')}</div>
                                        <div>{formatDateTime(selectedInfo.last_read_at)}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Dashboard


