import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ReaderAnnotationsPanel from './ReaderAnnotationsPanel'
import ReaderProgressBar from './ReaderProgressBar'
import ReaderSearchPanel from './ReaderSearchPanel'
import ReaderSelectionMenu from './ReaderSelectionMenu'
import ReaderToolbar from './ReaderToolbar'
import ResumeToast from './ResumeToast'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReaderViewportAnchor } from '../hooks/useReaderViewportAnchor'
import { useReadingProgress } from '../hooks/useReadingProgress'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useTxtSegmentWindow } from '../hooks/useTxtSegmentWindow'
import { getDefaultAnnotationColor, getNextAnnotationColor } from '../lib/annotationColors'
import { activateAnnotationHighlight, clearAnnotationHighlights, highlightAnnotationsInElement, scrollAnnotationIntoView } from '../lib/annotationHighlighter'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { clearCurrentSelection, getSelectionSnapshot } from '../lib/annotationSelection'
import { clearSearchHighlights } from '../lib/searchHighlighter'
import { clearSegmentMarks, findSegmentElement, highlightSegmentMatch } from '../lib/txtSegmentDom'
import { clampViewportPage } from '../lib/txtPagination'

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

    const [compactWhitespace, setCompactWhitespace] = useState(false)
    const [splitParagraphs, setSplitParagraphs] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchDraft, setSearchDraft] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [searchRequestId, setSearchRequestId] = useState(0)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState([])
    const [activeSearchIndex, setActiveSearchIndex] = useState(null)
    const [pendingSearchTarget, setPendingSearchTarget] = useState(null)
    const [annotationsOpen, setAnnotationsOpen] = useState(false)
    const [annotationsLoading, setAnnotationsLoading] = useState(false)
    const [annotations, setAnnotations] = useState([])
    const [activeAnnotationId, setActiveAnnotationId] = useState(null)
    const [selectionSnapshot, setSelectionSnapshot] = useState(null)

    const readerRootRef = useRef(null)
    const contentRef = useRef(null)
    const pendingAnchorRestoreCleanupRef = useRef(null)
    const { captureAnchor, restoreAnchor, clearAnchor } = useReaderViewportAnchor()

    const {
        manifest,
        visibleSegments,
        showWindowForSegment,
        loading,
        error,
    } = useTxtSegmentWindow(id)

    const totalViewportPages = manifest?.segment_count || 1
    const progress = useReadingProgress(id, { totalPages: totalViewportPages, type: 'txt', legacyId })
    const {
        currentPosition: currentViewportPage,
        setCurrentPosition: setCurrentViewportPage,
        bookmarks,
        addBookmark,
        removeBookmark,
        goToBookmark,
        resumePrompt,
        resumeReading,
        dismissResume,
    } = progress
    const pagesPerView = layout === 'dual' ? 2 : 1

    const displayedSegments = useMemo(() => visibleSegments.map((segment) => {
        let text = segment.text
        if (compactWhitespace) text = removeExtraWhitespaceAndEmptyLines(text)
        if (splitParagraphs) text = splitDenseParagraphs(text)
        return { ...segment, displayText: text }
    }), [compactWhitespace, splitParagraphs, visibleSegments])

    const currentPageAnnotations = useMemo(
        () => annotations.filter((annotation) => {
            if (annotation.page == null && annotation.segment_id == null) return true
            const segmentId = Number.isFinite(annotation.segment_id) ? annotation.segment_id : annotation.page
            if (!Number.isFinite(segmentId)) return false
            return segmentId >= currentViewportPage && segmentId < currentViewportPage + pagesPerView
        }),
        [annotations, currentViewportPage, pagesPerView],
    )

    const visibleViewportSegments = useMemo(() => {
        const visibleIds = new Set(
            Array.from({ length: pagesPerView }, (_, index) => currentViewportPage + index),
        )
        return displayedSegments.filter((segment) => visibleIds.has(segment.segment_id))
    }, [currentViewportPage, displayedSegments, pagesPerView])

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
        if (loading || error || !Number.isFinite(currentViewportPage)) return
        showWindowForSegment(currentViewportPage).catch((err) => {
            console.error('Failed to show TXT segment window', err)
        })
    }, [currentViewportPage, error, loading, showWindowForSegment])

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
        const root = contentRef.current
        if (!root || loading) return

        const handleSelectionChange = () => {
            const nextSelection = getSelectionSnapshot(root)
            setSelectionSnapshot(nextSelection)
        }

        document.addEventListener('selectionchange', handleSelectionChange)
        return () => document.removeEventListener('selectionchange', handleSelectionChange)
    }, [displayedSegments, loading])

    useEffect(() => {
        setSelectionSnapshot(null)
        clearCurrentSelection()
    }, [currentViewportPage, displayedSegments, searchOpen, annotationsOpen])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading) return

        clearSearchHighlights(root)
        clearSegmentMarks(root)
        clearAnnotationHighlights(root)

        if (pendingSearchTarget) {
            const segmentEl = findSegmentElement(root, pendingSearchTarget.segmentId)
            if (segmentEl) {
                const mark = highlightSegmentMatch(segmentEl, pendingSearchTarget.start, pendingSearchTarget.end)
                mark?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            return
        }

        highlightAnnotationsInElement(root, currentPageAnnotations)
    }, [currentPageAnnotations, displayedSegments, loading, pendingSearchTarget])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading || pendingSearchTarget || !activeAnnotationId) return
        const target = activateAnnotationHighlight(root, activeAnnotationId)
        if (target) scrollAnnotationIntoView(target)
    }, [activeAnnotationId, loading, pendingSearchTarget])

    useEffect(() => {
        return () => {
            pendingAnchorRestoreCleanupRef.current?.()
            clearAnchor()
        }
    }, [clearAnchor])

    const handleSearchQueryChange = useCallback((value) => {
        const trimmedValue = value.trim()
        setSearchDraft(value)
        if (!trimmedValue) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            setPendingSearchTarget(null)
            return
        }
        if (trimmedValue !== searchQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            setPendingSearchTarget(null)
        }
    }, [searchQuery])

    const handleSearchSubmit = useCallback(() => {
        const trimmedQuery = searchDraft.trim()
        if (!trimmedQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            setPendingSearchTarget(null)
            return
        }
        setSearchQuery(trimmedQuery)
        setSearchRequestId((value) => value + 1)
    }, [searchDraft])

    const goToViewportPage = useCallback(async (page) => {
        const target = clampViewportPage(page, totalViewportPages)
        setCurrentViewportPage(target)
        try {
            await showWindowForSegment(target)
        } catch (err) {
            console.error('Failed to navigate TXT segment window', err)
        }
    }, [setCurrentViewportPage, showWindowForSegment, totalViewportPages])

    const goNext = useCallback(() => {
        if (currentViewportPage < totalViewportPages - 1) {
            void goToViewportPage(currentViewportPage + pagesPerView)
        }
    }, [currentViewportPage, goToViewportPage, pagesPerView, totalViewportPages])

    const goPrev = useCallback(() => {
        if (currentViewportPage > 0) {
            void goToViewportPage(currentViewportPage - pagesPerView)
        }
    }, [currentViewportPage, goToViewportPage, pagesPerView])

    const seekToProgress = useCallback((progressValue) => {
        if (totalViewportPages <= 1) return
        void goToViewportPage(Math.round(progressValue * (totalViewportPages - 1)))
    }, [goToViewportPage, totalViewportPages])

    const handleSearchResultClick = useCallback(async (result) => {
        setAnnotationsOpen(false)
        setActiveAnnotationId(null)
        setActiveSearchIndex(result.index)

        if (!Number.isFinite(result.segment_id)) {
            if (Number.isFinite(result.position)) setCurrentViewportPage(result.position)
            return
        }

        await showWindowForSegment(result.segment_id)
        setCurrentViewportPage(result.segment_id)
        setPendingSearchTarget({
            segmentId: result.segment_id,
            start: result.segment_local_start ?? 0,
            end: result.segment_local_end ?? ((result.segment_local_start ?? 0) + searchQuery.length),
        })
    }, [searchQuery.length, setCurrentViewportPage, showWindowForSegment])

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
    }, [activeAnnotationId])

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
                    locator: selectionSnapshot.segmentId != null
                        ? `segment:${selectionSnapshot.segmentId}:offset:${selectionSnapshot.segmentLocalStart}`
                        : `page:${currentViewportPage}`,
                    page: currentViewportPage,
                    segment_id: selectionSnapshot.segmentId,
                    segment_local_start: selectionSnapshot.segmentLocalStart,
                    segment_local_end: selectionSnapshot.segmentLocalEnd,
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
            setPendingSearchTarget(null)
            setActiveSearchIndex(null)
            setActiveAnnotationId(created.id)
            setSelectionSnapshot(null)
            clearCurrentSelection()
        } catch (err) {
            console.error('Failed to create annotation', err)
            window.alert(tt('annotationSaveFailed'))
        }
    }, [currentViewportPage, id, selectionSnapshot, tt])

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
            const res = await fetch(`${API_ROOT}/annotations/${annotation.id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setAnnotations((prev) => prev.filter((item) => item.id !== annotation.id))
            if (activeAnnotationId === annotation.id) setActiveAnnotationId(null)
        } catch (err) {
            console.error('Failed to delete annotation', err)
            window.alert(tt('annotationDeleteFailed'))
        }
    }, [activeAnnotationId, tt])

    const handleAnnotationClick = useCallback((annotation) => {
        setSearchOpen(false)
        setPendingSearchTarget(null)
        setActiveSearchIndex(null)
        setActiveAnnotationId(annotation.id)
        if (Number.isFinite(annotation.segment_id)) {
            void goToViewportPage(annotation.segment_id)
        } else if (Number.isFinite(annotation.page)) {
            void goToViewportPage(annotation.page)
        }
    }, [goToViewportPage])

    const handleProgressBarVisibilityChange = useCallback(() => {
        const root = contentRef.current
        if (!root) return
        pendingAnchorRestoreCleanupRef.current?.()
        captureAnchor(root)
        pendingAnchorRestoreCleanupRef.current = scheduleAfterPaint(() => {
            pendingAnchorRestoreCleanupRef.current = null
            restoreAnchor(root)
        })
    }, [captureAnchor, restoreAnchor])

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, onEscape: toggleTitleBar, enabled: true, readerRootRef })

    const loadingLabel = error ? tt('loadContentFailed') : (manifest?.encoding || tt('loading'))

    return (
        <div
            ref={readerRootRef}
            tabIndex={-1}
            className="readerRoot h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden"
            style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)', transition: 'background-color 0.3s, color 0.3s' }}
        >
            <div className="shrink-0 flex items-center justify-between px-6 py-2.5" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/')} title={tt('backToLibrary')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
                    <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>TXT</span>
                    {manifest?.encoding && <span className="text-[11px] opacity-30" style={{ color: themeStyle.text }}>{manifest.encoding}</span>}
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
                <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goPrev}>{currentViewportPage > 0 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></div>)}</div>
                <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goNext}>{currentViewportPage < totalViewportPages - 1 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>)}</div>

                <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${hMargin}px`, boxSizing: 'border-box' }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                        </div>
                    ) : (
                        <div
                            data-testid="txt-reader-scroller"
                            style={{
                                position: 'relative',
                                width: '100%',
                                height: '100%',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                ref={contentRef}
                                data-testid="txt-reader-content"
                                className="select-text"
                                style={{
                                    height: '100%',
                                    backgroundColor: 'var(--reader-page-bg)',
                                    color: 'var(--reader-page-fg)',
                                    fontFamily: contentStyle.fontFamily,
                                    fontWeight: contentStyle.fontWeight,
                                    fontSize: contentStyle.fontSize,
                                    lineHeight: `${lineHeight}`,
                                    letterSpacing: `${letterSpacing}em`,
                                    textAlign: 'left',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'break-word',
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${pagesPerView}, minmax(0, 1fr))`,
                                    gap: `${columnGap}px`,
                                    alignItems: 'stretch',
                                }}
                            >
                                {visibleViewportSegments.length > 0 ? visibleViewportSegments.map((segment) => (
                                    <div
                                        key={segment.segment_id}
                                        data-segment-id={segment.segment_id}
                                        data-segment-start={segment.start_offset}
                                        data-segment-end={segment.end_offset}
                                        style={{
                                            minHeight: '100%',
                                            margin: 0,
                                            padding: '1.25rem',
                                            border: `1px solid ${themeStyle.border}`,
                                            borderRadius: '0.75rem',
                                            backgroundColor: `${themeStyle.card}66`,
                                            boxSizing: 'border-box',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {segment.displayText}
                                    </div>
                                )) : (
                                    <div>{tt('loadContentFailed')}</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ReaderProgressBar
                currentPage={currentViewportPage + 1}
                totalPages={totalViewportPages}
                onSeekPage={(page) => { void goToViewportPage(page - 1) }}
                progress={totalViewportPages > 1 ? currentViewportPage / (totalViewportPages - 1) : 0}
                onSeekProgress={seekToProgress}
                extraInfo={manifest ? `TXT ${currentViewportPage + 1}/${totalViewportPages}` : `TXT | ${loadingLabel}`}
                readerFocusRef={readerRootRef}
                onVisibilityChange={handleProgressBarVisibilityChange}
            />
            <ResumeToast resumePrompt={resumePrompt} onResume={resumeReading} onDismiss={dismissResume} tt={tt} />
        </div>
    )
}

export default TxtReader
