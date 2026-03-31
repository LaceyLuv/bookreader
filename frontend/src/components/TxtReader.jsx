import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReadingProgress } from '../hooks/useReadingProgress'
import ReaderToolbar from './ReaderToolbar'
import ReaderProgressBar from './ReaderProgressBar'
import ResumeToast from './ResumeToast'
import ReaderSearchPanel from './ReaderSearchPanel'
import ReaderAnnotationsPanel from './ReaderAnnotationsPanel'
import ReaderSelectionMenu from './ReaderSelectionMenu'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { clearSearchHighlights, highlightSearchMatchInElement, scrollSearchMarkIntoView } from '../lib/searchHighlighter'
import { activateAnnotationHighlight, clearAnnotationHighlights, highlightAnnotationsInElement, scrollAnnotationIntoView } from '../lib/annotationHighlighter'
import { clearCurrentSelection, getSelectionSnapshot } from '../lib/annotationSelection'
import { getDefaultAnnotationColor, getNextAnnotationColor } from '../lib/annotationColors'

const API = API_BOOKS_BASE
const API_ROOT = API.replace(/\/books$/, '')

function scheduleAfterPaint(callback) {
    if (typeof window === 'undefined') return () => {}

    let frameA = null
    let frameB = null

    frameA = window.requestAnimationFrame(() => {
        frameB = window.requestAnimationFrame(() => {
            callback()
        })
    })

    return () => {
        if (frameA != null) window.cancelAnimationFrame(frameA)
        if (frameB != null) window.cancelAnimationFrame(frameB)
    }
}

function scheduleOnNextFrame(callback) {
    if (typeof window === 'undefined') return () => {}

    const frameId = window.requestAnimationFrame(() => {
        callback()
    })

    return () => {
        window.cancelAnimationFrame(frameId)
    }
}

function removeExtraWhitespaceAndEmptyLines(text) {
    if (typeof text !== 'string' || !text) return ''
    return text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
}

function splitDenseBlock(block) {
    const lines = block
        .split('\n')
        .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
        .filter(Boolean)

    if (lines.length === 0) return ''
    if (lines.length > 1) return lines.join('\n')

    const source = lines[0]
    if (source.length < 280) return source

    const sentenceParts = source.match(/[^.!?\n]+(?:[.!?]+|$)/g) || []
    if (sentenceParts.length < 2) return source

    const paragraphs = []
    let current = ''
    for (const raw of sentenceParts) {
        const sentence = raw.trim()
        if (!sentence) continue
        const next = current ? `${current} ${sentence}` : sentence
        if (current && next.length > 240 && current.length >= 80) {
            paragraphs.push(current)
            current = sentence
        } else {
            current = next
        }
    }
    if (current) paragraphs.push(current)
    return paragraphs.join('\n\n')
}

function splitDenseParagraphs(text) {
    if (typeof text !== 'string' || !text) return ''
    const normalized = text.replace(/\r\n/g, '\n').trim()
    if (!normalized) return ''

    return normalized
        .split(/\n\s*\n+/)
        .map((block) => splitDenseBlock(block))
        .filter(Boolean)
        .join('\n\n')
}

function TxtReader() {
    const { id } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const legacyId = location.state?.legacyId ?? null
    const settings = useReaderSettings()
    const {
        contentStyle,
        themeStyle,
        layout,
        columnGap,
        hMargin,
        vMargin,
        lineHeight,
        letterSpacing,
        lang,
        tt,
        toggleTitleBar,
    } = settings

    const [fullText, setFullText] = useState('')
    const [encoding, setEncoding] = useState('')
    const [loading, setLoading] = useState(true)
    const [compactWhitespace, setCompactWhitespace] = useState(false)
    const [splitParagraphs, setSplitParagraphs] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchDraft, setSearchDraft] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [searchRequestId, setSearchRequestId] = useState(0)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState([])
    const [activeSearchIndex, setActiveSearchIndex] = useState(null)
    const [annotationsOpen, setAnnotationsOpen] = useState(false)
    const [annotationsLoading, setAnnotationsLoading] = useState(false)
    const [annotations, setAnnotations] = useState([])
    const [activeAnnotationId, setActiveAnnotationId] = useState(null)
    const [selectionSnapshot, setSelectionSnapshot] = useState(null)

    const [totalPages, setTotalPages] = useState(1)
    const [paginationReady, setPaginationReady] = useState(false)
    const frameRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const stepRef = useRef(0)
    const initialMeasureDoneRef = useRef(false)
    const scheduledMeasureCleanupRef = useRef(null)
    const lastMeasureSignatureRef = useRef('')

    useEffect(() => {
        ; (async () => {
            try {
                const res = await fetch(`${API}/${id}/content`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                setFullText(data.text)
                setEncoding(data.encoding)
            } catch {
                setFullText(tt('loadContentFailed'))
            }
            setLoading(false)
        })()
    }, [id, tt])

    const progress = useReadingProgress(id, { totalPages, type: 'txt', legacyId })
    const {
        currentPosition: currentPage,
        setCurrentPosition: setCurrentPage,
        bookmarks,
        addBookmark,
        removeBookmark,
        goToBookmark,
        resumePrompt,
        resumeReading,
        dismissResume,
    } = progress

    const isDualLayout = layout === 'dual'
    const isSearchActive = searchOpen && !!searchQuery.trim()
    const shouldRenderSearchHighlight = isSearchActive && activeSearchIndex != null

    const handleSearchQueryChange = useCallback((value) => {
        const trimmedValue = value.trim()
        setSearchDraft(value)
        if (!trimmedValue) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            return
        }
        if (trimmedValue !== searchQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
        }
    }, [searchQuery])

    const handleSearchSubmit = useCallback(() => {
        const trimmedQuery = searchDraft.trim()
        if (!trimmedQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            return
        }
        setSearchQuery(trimmedQuery)
        setSearchRequestId((value) => value + 1)
    }, [searchDraft])
    const currentPageAnnotations = useMemo(
        () => annotations.filter((annotation) => annotation.page == null || annotation.page === currentPage),
        [annotations, currentPage],
    )

    const displayedText = useMemo(() => {
        let nextText = fullText
        if (compactWhitespace) nextText = removeExtraWhitespaceAndEmptyLines(nextText)
        if (splitParagraphs) nextText = splitDenseParagraphs(nextText)
        return nextText
    }, [fullText, compactWhitespace, splitParagraphs])

    const measureLayoutKey = useMemo(() => JSON.stringify({
        layout,
        columnGap,
        hMargin,
        vMargin,
        lineHeight,
        letterSpacing,
        fontFamily: contentStyle.fontFamily,
        fontWeight: contentStyle.fontWeight,
        fontSize: contentStyle.fontSize,
    }), [layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing, contentStyle.fontFamily, contentStyle.fontWeight, contentStyle.fontSize])

    const loadAnnotations = useCallback(async () => {
        setAnnotationsLoading(true)
        try {
            const res = await fetch(`${API}/${id}/annotations`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setAnnotations(Array.isArray(data) ? data : [])
        } catch (err) {
            console.error('Failed to load annotations', err)
            setAnnotations([])
        }
        setAnnotationsLoading(false)
    }, [id])

    useEffect(() => {
        loadAnnotations()
    }, [loadAnnotations])

    useEffect(() => {
        if (!searchOpen) return
        const trimmedQuery = searchQuery.trim()
        if (!trimmedQuery) {
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            return
        }

        let cancelled = false

        ; (async () => {
            setSearchLoading(true)
            try {
                const res = await fetch(`${API}/${id}/search?q=${encodeURIComponent(trimmedQuery)}`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                if (!cancelled) {
                    setSearchResults(Array.isArray(data?.results) ? data.results : [])
                    setActiveSearchIndex(null)
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to search TXT', err)
                    setSearchResults([])
                    setActiveSearchIndex(null)
                }
            }
            if (!cancelled) setSearchLoading(false)
        })()

        return () => {
            cancelled = true
        }
    }, [id, searchOpen, searchQuery, searchRequestId])

    useEffect(() => {
        if (loading) return undefined
        const handleSelectionChange = () => {
            const nextSelection = getSelectionSnapshot(contentRef.current)
            setSelectionSnapshot(nextSelection)
        }
        document.addEventListener('selectionchange', handleSelectionChange)
        return () => document.removeEventListener('selectionchange', handleSelectionChange)
    }, [loading, currentPage, displayedText])

    useEffect(() => {
        setSelectionSnapshot(null)
        clearCurrentSelection()
    }, [currentPage, displayedText, searchOpen, annotationsOpen])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading) return

        clearSearchHighlights(root)
        if (shouldRenderSearchHighlight) {
            clearAnnotationHighlights(root)
            const target = highlightSearchMatchInElement(root, searchQuery, activeSearchIndex)
            if (target) scrollSearchMarkIntoView(target)
            return
        }

        highlightAnnotationsInElement(root, currentPageAnnotations)
    }, [activeSearchIndex, currentPageAnnotations, displayedText, loading, searchQuery, shouldRenderSearchHighlight])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading || shouldRenderSearchHighlight || !activeAnnotationId) return
        const target = activateAnnotationHighlight(root, activeAnnotationId)
        if (target) scrollAnnotationIntoView(target)
    }, [activeAnnotationId, currentPage, currentPageAnnotations, loading, shouldRenderSearchHighlight])

    const handleSearchResultClick = useCallback((result) => {
        setAnnotationsOpen(false)
        setActiveAnnotationId(null)
        setActiveSearchIndex(result.index)
    }, [])

    const updateAnnotationItem = useCallback(async (annotationId, patch) => {
        const res = await fetch(`${API_ROOT}/annotations/${annotationId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const updated = await res.json()
        setAnnotations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
        if (activeAnnotationId === updated.id) setActiveAnnotationId(updated.id)
        return updated
    }, [activeAnnotationId, tt])

    const createAnnotation = useCallback(async (kind) => {
        if (!selectionSnapshot) return

        let noteText = null
        if (kind === 'note') {
            const rawNote = window.prompt(tt('addNoteForSelectionPrompt'), '')
            if (rawNote == null) return
            noteText = rawNote.trim()
            if (!noteText) return
        }

        try {
            const res = await fetch(`${API}/${id}/annotations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind,
                    locator: `page:${currentPage}`,
                    page: currentPage,
                    start_offset: selectionSnapshot.startOffset,
                    end_offset: selectionSnapshot.endOffset,
                    selected_text: selectionSnapshot.selectedText,
                    note_text: noteText,
                    color: getDefaultAnnotationColor(kind),
                    snippet: selectionSnapshot.snippet,
                }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const created = await res.json()
            setAnnotations((prev) => [created, ...prev])
            setAnnotationsOpen(true)
            setSearchOpen(false)
            setActiveSearchIndex(null)
            setActiveAnnotationId(created.id)
            setSelectionSnapshot(null)
            clearCurrentSelection()
        } catch (err) {
            console.error('Failed to create annotation', err)
            window.alert(tt('annotationSaveFailed'))
        }
    }, [currentPage, id, selectionSnapshot, tt])

    const handleEditAnnotation = useCallback(async (annotation) => {
        if (annotation.kind !== 'note') return
        const rawNote = window.prompt(tt('editNotePrompt'), annotation.note_text || '')
        if (rawNote == null) return
        const noteText = rawNote.trim()
        if (!noteText) return
        try {
            await updateAnnotationItem(annotation.id, { note_text: noteText })
        } catch (err) {
            console.error('Failed to update annotation', err)
            window.alert(tt('annotationUpdateFailed'))
        }
    }, [tt, updateAnnotationItem])

    const handleCycleAnnotationColor = useCallback(async (annotation) => {
        try {
            await updateAnnotationItem(annotation.id, { color: getNextAnnotationColor(annotation.kind, annotation.color) })
        } catch (err) {
            console.error('Failed to update annotation color', err)
            window.alert(tt('annotationColorUpdateFailed'))
        }
    }, [tt, updateAnnotationItem])

    const handleDeleteAnnotation = useCallback(async (annotation) => {
        const confirmed = window.confirm(tt('deleteAnnotationConfirm'))
        if (!confirmed) return

        try {
            const res = await fetch(`${API_ROOT}/annotations/${annotation.id}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setAnnotations((prev) => prev.filter((item) => item.id !== annotation.id))
            if (activeAnnotationId === annotation.id) setActiveAnnotationId(null)
        } catch (err) {
            console.error('Failed to delete annotation', err)
            window.alert(tt('annotationDeleteFailed'))
        }
    }, [activeAnnotationId, tt])


    const measure = useCallback(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth
        const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap
        const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const colW = isDualLayout ? Math.max(1, Math.floor((W - gap) / 2)) : Math.max(1, Math.floor(W))
        const H = Math.max(1, Math.floor(scroller.clientHeight))
        const signature = `${measureLayoutKey}|${W}|${H}`
        if (lastMeasureSignatureRef.current === signature) return
        contentEl.style.columnWidth = `${colW}px`
        contentEl.style.columnCount = isDualLayout ? '2' : '1'
        contentEl.style.columnFill = 'auto'
        contentEl.style.height = `${H}px`
        contentEl.style.display = 'block'
        contentEl.style.textAlign = 'left'
        contentEl.style.columnRule = isDualLayout ? '1px solid transparent' : 'none'
        const step = W + gap
        if (step <= 0) return
        const oldStep = stepRef.current > 0 ? stepRef.current : step
        const oldLeft = scroller.scrollLeft
        const idxFromScroll = Math.round(oldLeft / oldStep)
        stepRef.current = step
        const pages = Math.max(1, Math.ceil((scroller.scrollWidth + gap) / step))
        lastMeasureSignatureRef.current = signature
        initialMeasureDoneRef.current = true
        setPaginationReady(true)
        setTotalPages(pages)
        const clamped = Math.max(0, Math.min(idxFromScroll, pages - 1))
        scroller.scrollTo({ left: Math.round(clamped * step), behavior: 'auto' })
        setCurrentPage((prev) => (prev === clamped ? prev : clamped))
    }, [isDualLayout, measureLayoutKey, setCurrentPage])

    const clearScheduledMeasure = useCallback(() => {
        if (scheduledMeasureCleanupRef.current) {
            scheduledMeasureCleanupRef.current()
            scheduledMeasureCleanupRef.current = null
        }
    }, [])

    const scheduleMeasure = useCallback(() => {
        clearScheduledMeasure()
        scheduledMeasureCleanupRef.current = scheduleOnNextFrame(() => {
            scheduledMeasureCleanupRef.current = null
            measure()
        })
    }, [clearScheduledMeasure, measure])

    useEffect(() => clearScheduledMeasure, [clearScheduledMeasure])

    useEffect(() => {
        if (loading || !displayedText) {
            clearScheduledMeasure()
            lastMeasureSignatureRef.current = ''
            initialMeasureDoneRef.current = false
            setPaginationReady(false)
            return undefined
        }

        clearScheduledMeasure()
        lastMeasureSignatureRef.current = ''
        initialMeasureDoneRef.current = false
        setPaginationReady(false)

        return scheduleAfterPaint(() => {
            scheduleMeasure()
        })
    }, [loading, displayedText, clearScheduledMeasure, scheduleMeasure])

    useEffect(() => {
        if (typeof ResizeObserver !== 'undefined') return undefined
        window.addEventListener('resize', scheduleMeasure)
        return () => window.removeEventListener('resize', scheduleMeasure)
    }, [scheduleMeasure])

    useEffect(() => {
        const frame = frameRef.current
        if (!frame || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => {
            if (!initialMeasureDoneRef.current) return
            scheduleMeasure()
        })
        observer.observe(frame)
        return () => observer.disconnect()
    }, [scheduleMeasure])

    const goToPage = useCallback((page) => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const target = Math.max(0, Math.min(page, totalPages - 1))
        const W = scroller.clientWidth
        const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap
        const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap
        if (step <= 0) return
        stepRef.current = step
        scroller.scrollTo({ left: Math.round(target * step), behavior: 'auto' })
        setCurrentPage(target)
    }, [setCurrentPage, totalPages])

    const handleAnnotationClick = useCallback((annotation) => {
        setSearchOpen(false)
        setActiveSearchIndex(null)
        setActiveAnnotationId(annotation.id)
        if (Number.isFinite(annotation.page)) {
            goToPage(annotation.page)
        }
    }, [goToPage])

    useEffect(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth
        const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap
        const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap
        if (step <= 0) return
        stepRef.current = step
        scroller.scrollTo({ left: Math.round(currentPage * step), behavior: 'auto' })
    }, [currentPage])

    useEffect(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return undefined
        let timer = null

        const onScroll = () => {
            if (timer) clearTimeout(timer)
            timer = window.setTimeout(() => {
                const W = scroller.clientWidth
                const cs = getComputedStyle(contentEl)
                const rawGap = cs.columnGap
                const fallbackGap = parseFloat(cs.fontSize) || 16
                const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
                const step = W + gap
                if (step <= 0) return
                stepRef.current = step
                const idx = Math.round(scroller.scrollLeft / step)
                const snapLeft = Math.round(idx * step)
                if (Math.abs(scroller.scrollLeft - snapLeft) >= 1) {
                    scroller.scrollTo({ left: snapLeft, behavior: 'auto' })
                }
                const clamped = Math.max(0, Math.min(idx, totalPages - 1))
                setCurrentPage((prev) => (prev === clamped ? prev : clamped))
            }, 120)
        }

        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            if (timer) clearTimeout(timer)
            scroller.removeEventListener('scroll', onScroll)
        }
    }, [setCurrentPage, totalPages])

    const goNext = useCallback(() => {
        if (currentPage < totalPages - 1) goToPage(currentPage + 1)
    }, [currentPage, goToPage, totalPages])

    const goPrev = useCallback(() => {
        if (currentPage > 0) goToPage(currentPage - 1)
    }, [currentPage, goToPage])

    const seekToProgress = useCallback((progressValue) => {
        if (totalPages <= 1) return
        goToPage(Math.round(progressValue * (totalPages - 1)))
    }, [goToPage, totalPages])

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, onEscape: toggleTitleBar, enabled: true })

    return (
        <div
            className="readerRoot h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden"
            style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)', transition: 'background-color 0.3s, color 0.3s' }}
        >
            <div className="shrink-0 flex items-center justify-between px-6 py-2.5" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/')} title={tt('backToLibrary')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
                    <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>TXT</span>
                    {encoding && <span className="text-[11px] opacity-30" style={{ color: themeStyle.text }}>{encoding}</span>}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            setSearchOpen((open) => !open)
                            setAnnotationsOpen(false)
                            setActiveAnnotationId(null)
                        }}
                        title={tt('search')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                        style={{ color: searchOpen ? '#5c7cfa' : themeStyle.text }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></svg>
                    </button>
                    <button
                        onClick={() => {
                            setAnnotationsOpen((open) => !open)
                            setSearchOpen(false)
                        }}
                        title={tt('annotations')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                        style={{ color: annotationsOpen ? '#ff922b' : themeStyle.text }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button onClick={addBookmark} title={tt('addBookmark')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></button>
                    <ReaderToolbar settings={settings} readerType="txt" />
                </div>
            </div>

            <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <button
                    onClick={() => setCompactWhitespace((value) => !value)}
                    className="px-2.5 py-1 rounded text-[11px] border transition-all"
                    style={{
                        borderColor: compactWhitespace ? 'var(--accent)' : themeStyle.border,
                        color: themeStyle.text,
                        backgroundColor: compactWhitespace ? themeStyle.border : 'transparent',
                    }}
                >
                    {tt('trimSpaces')}
                </button>
                <button
                    onClick={() => setSplitParagraphs((value) => !value)}
                    className="px-2.5 py-1 rounded text-[11px] border transition-all"
                    style={{
                        borderColor: splitParagraphs ? 'var(--accent)' : themeStyle.border,
                        color: themeStyle.text,
                        backgroundColor: splitParagraphs ? themeStyle.border : 'transparent',
                    }}
                >
                    {tt('splitParagraphs')}
                </button>
            </div>

            {bookmarks.length > 0 && (
                <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                    <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0" style={{ color: themeStyle.text }}>{tt('bookmarks')}</span>
                    {bookmarks.map((bookmark) => (
                        <button key={bookmark.position} onClick={() => goToBookmark(bookmark.position)} className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0" style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
                            {bookmark.label}
                            <span onClick={(event) => { event.stopPropagation(); removeBookmark(bookmark.position) }} className="ml-1.5 opacity-30 hover:opacity-100 cursor-pointer">x</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 relative min-h-0">
                <ReaderSearchPanel
                    open={searchOpen}
                    themeStyle={themeStyle}
                    query={searchDraft}
                    submittedQuery={searchQuery}
                    loading={searchLoading}
                    results={searchResults}
                    activeIndex={activeSearchIndex}
                    onQueryChange={handleSearchQueryChange}
                    onSubmit={handleSearchSubmit}
                    onClose={() => setSearchOpen(false)}
                    onResultClick={handleSearchResultClick}
                    tt={tt}
                />
                <ReaderAnnotationsPanel
                    open={annotationsOpen}
                    themeStyle={themeStyle}
                    loading={annotationsLoading}
                    annotations={annotations}
                    activeAnnotationId={activeAnnotationId}
                    onClose={() => setAnnotationsOpen(false)}
                    onItemClick={handleAnnotationClick}
                    onDeleteItem={handleDeleteAnnotation}
                    onEditItem={handleEditAnnotation}
                    onColorItem={handleCycleAnnotationColor}
                    tt={tt}
                    lang={lang}
                />
                <ReaderSelectionMenu
                    selection={selectionSnapshot}
                    themeStyle={themeStyle}
                    onHighlight={() => createAnnotation('highlight')}
                    onNote={() => createAnnotation('note')}
                    onClear={() => {
                        setSelectionSnapshot(null)
                        clearCurrentSelection()
                    }}
                    tt={tt}
                />
                <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goPrev}>{currentPage > 0 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></div>)}</div>
                <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goNext}>{currentPage < totalPages - 1 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>)}</div>

                {layout === 'dual' && (<div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-8 z-10 pointer-events-none" style={{ background: `linear-gradient(to right, transparent, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 45%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)'} 50%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 55%, transparent)` }} />)}

                <div ref={frameRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${hMargin}px`, boxSizing: 'border-box' }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                        </div>
                    ) : (
                        <div ref={scrollerRef} className="reader-scroller" style={{ position: 'relative', width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'none', scrollbarGutter: 'stable' }}>
                            <div ref={contentRef} className="select-text" style={{ height: '100%', boxSizing: 'border-box', display: 'block', backgroundColor: 'var(--reader-page-bg)', color: 'var(--reader-page-fg)', fontFamily: contentStyle.fontFamily, fontWeight: contentStyle.fontWeight, fontSize: contentStyle.fontSize, lineHeight: `${lineHeight}`, letterSpacing: `${letterSpacing}em`, textAlign: 'left', hyphens: 'auto', WebkitHyphens: 'auto', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'pre-wrap', columnCount: isDualLayout ? 2 : 1, columnGap: `${columnGap}px`, columnFill: 'auto', columnRule: isDualLayout ? '1px solid transparent' : 'none', breakInside: 'avoid-column' }}>
                                {displayedText}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ReaderProgressBar currentPage={currentPage + 1} totalPages={paginationReady ? totalPages : null} onSeekPage={(page) => goToPage(page - 1)} progress={paginationReady && totalPages > 1 ? currentPage / (totalPages - 1) : 0} onSeekProgress={seekToProgress} extraInfo={paginationReady ? `TXT ${currentPage + 1}/${totalPages}` : `TXT | ${encoding || tt('loading')}`} />
            <ResumeToast resumePrompt={resumePrompt} onResume={resumeReading} onDismiss={dismissResume} tt={tt} />
        </div>
    )
}

export default TxtReader






