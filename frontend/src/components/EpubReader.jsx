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
const PAGE_COUNT_START_DELAY_MS = 2200
const PAGE_COUNT_IDLE_TIMEOUT_MS = 1500

function scheduleBackgroundWork(callback, delay = 0) {
    if (typeof window === 'undefined') return () => {}

    let timeoutId = null
    let idleId = null

    const run = () => {
        if (typeof window.requestIdleCallback === 'function') {
            idleId = window.requestIdleCallback(() => callback(), { timeout: PAGE_COUNT_IDLE_TIMEOUT_MS })
            return
        }
        timeoutId = window.setTimeout(() => callback(), 0)
    }

    if (delay > 0) timeoutId = window.setTimeout(run, delay)
    else run()

    return () => {
        if (timeoutId != null) window.clearTimeout(timeoutId)
        if (idleId != null && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(idleId)
        }
    }
}

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

function EpubReader() {
    const { id } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const legacyId = location.state?.legacyId ?? null
    const settings = useReaderSettings()
    const { contentStyle, themeStyle, layout, columnGap, hMargin, vMargin,
        lineHeight, letterSpacing, fontMode, lang, tt, toggleTitleBar } = settings

    const [toc, setToc] = useState([])
    const [bookTitle, setBookTitle] = useState('')
    const [chapter, setChapter] = useState(null)
    const [loading, setLoading] = useState(true)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchDraft, setSearchDraft] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [searchRequestId, setSearchRequestId] = useState(0)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState([])
    const [activeSearchIndex, setActiveSearchIndex] = useState(null)
    const [activeChapterMatchIndex, setActiveChapterMatchIndex] = useState(null)
    const [annotationsOpen, setAnnotationsOpen] = useState(false)
    const [annotationsLoading, setAnnotationsLoading] = useState(false)
    const [annotations, setAnnotations] = useState([])
    const [activeAnnotationId, setActiveAnnotationId] = useState(null)
    const [selectionSnapshot, setSelectionSnapshot] = useState(null)

    const [chapterPage, setChapterPage] = useState(0)
    const [chapterTotalPages, setChapterTotalPages] = useState(1)
    const [chapterPaginationReady, setChapterPaginationReady] = useState(false)
    const [pageWidth, setPageWidth] = useState(0)
    const [pageHeight, setPageHeight] = useState(0)
    const [chapterPageCounts, setChapterPageCounts] = useState({})
    const frameRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const measureHostRef = useRef(null)
    const stepRef = useRef(0)
    const pendingPageRef = useRef(null)
    const pendingPageUntilRef = useRef(0)
    const pendingChapterPageRef = useRef(null)
    const chapterPageCountsRef = useRef({})
    const pendingSearchResultRef = useRef(null)
    const initialMeasureDoneRef = useRef(false)
    const scheduledMeasureCleanupRef = useRef(null)

    const [totalChapters, setTotalChapters] = useState(1)
    const progress = useReadingProgress(id, { totalPages: totalChapters, type: 'epub', legacyId })
    const { currentPosition: chapterIndex, setCurrentPosition: setChapterIndex,
        bookmarks, addBookmark, removeBookmark, goToBookmark,
        resumePrompt, resumeReading, dismissResume } = progress
    const isDualLayout = layout === 'dual'
    const useEmbeddedFonts = fontMode === 'embedded'
    const isSearchActive = searchOpen && !!searchQuery.trim()
    const shouldRenderSearchHighlight = isSearchActive && activeChapterMatchIndex != null

    const handleSearchQueryChange = useCallback((value) => {
        const trimmedValue = value.trim()
        setSearchDraft(value)
        if (!trimmedValue) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
            return
        }
        if (trimmedValue !== searchQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
        }
    }, [searchQuery])

    const handleSearchSubmit = useCallback(() => {
        const trimmedQuery = searchDraft.trim()
        if (!trimmedQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setActiveSearchIndex(null)
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
            return
        }
        setSearchQuery(trimmedQuery)
        setSearchRequestId((value) => value + 1)
    }, [searchDraft])
    const currentChapterAnnotations = useMemo(
        () => annotations.filter((annotation) => annotation.chapter_index == null || annotation.chapter_index === chapter?.index),
        [annotations, chapter?.index],
    )

    const paginationSignature = useMemo(() => JSON.stringify({
        id,
        layout,
        columnGap,
        lineHeight,
        letterSpacing,
        fontMode,
        fontSize: contentStyle.fontSize,
        fontWeight: contentStyle.fontWeight,
        fontFamily: useEmbeddedFonts ? 'embedded' : contentStyle.fontFamily,
        pageWidth,
        pageHeight,
        sidebarOpen,
    }), [
        id,
        layout,
        columnGap,
        lineHeight,
        letterSpacing,
        fontMode,
        contentStyle.fontSize,
        contentStyle.fontWeight,
        contentStyle.fontFamily,
        useEmbeddedFonts,
        pageWidth,
        pageHeight,
        sidebarOpen,
    ])

    const overallPagination = useMemo(() => {
        const offsets = []
        let totalPages = 0
        let knownCount = 0

        for (let i = 0; i < totalChapters; i += 1) {
            offsets[i] = totalPages
            const pages = chapterPageCounts[i]
            if (Number.isFinite(pages) && pages > 0) {
                totalPages += pages
                knownCount += 1
            }
        }

        const currentPage = (offsets[chapterIndex] || 0) + chapterPage + 1
        return {
            offsets,
            currentPage,
            totalPages: Math.max(totalPages, currentPage),
            ready: totalChapters > 0 && knownCount === totalChapters,
        }
    }, [chapterIndex, chapterPage, chapterPageCounts, totalChapters])

    const lockPendingPage = useCallback((page) => {
        pendingPageRef.current = page
        pendingPageUntilRef.current = Date.now() + 400
    }, [])

    const getPendingPage = useCallback(() => {
        if (pendingPageRef.current == null) return null
        if (Date.now() > pendingPageUntilRef.current) {
            pendingPageRef.current = null
            pendingPageUntilRef.current = 0
            return null
        }
        return pendingPageRef.current
    }, [])

    useEffect(() => {
        chapterPageCountsRef.current = chapterPageCounts
    }, [chapterPageCounts])

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
    }, [id, tt])

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
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
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
                    setActiveChapterMatchIndex(null)
                    pendingSearchResultRef.current = null
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to search EPUB', err)
                    setSearchResults([])
                    setActiveSearchIndex(null)
                    setActiveChapterMatchIndex(null)
                    pendingSearchResultRef.current = null
                }
            }
            if (!cancelled) setSearchLoading(false)
        })()

        return () => {
            cancelled = true
        }
    }, [id, searchOpen, searchQuery, searchRequestId])

    useEffect(() => {
        chapterPageCountsRef.current = {}
        setChapterPageCounts({})
    }, [paginationSignature])

    // ??? S4: Parallel TOC + first chapter fetch ???
    useEffect(() => {
        ; (async () => {
            try {
                const [tocRes, chapterRes] = await Promise.all([
                    fetch(`${API}/${id}/toc`),
                    fetch(`${API}/${id}/chapter/0`),
                ])
                if (!tocRes.ok) throw new Error(`TOC HTTP ${tocRes.status}`)
                const tocData = await tocRes.json()
                const tocItems = Array.isArray(tocData?.toc) ? tocData.toc : []
                setBookTitle(tocData.title)
                setToc(tocItems)

                if (chapterRes.ok) {
                    const firstChapter = await chapterRes.json()
                    setChapter(firstChapter)
                    setTotalChapters(Math.max(1, firstChapter?.total || tocItems.length || 1))
                } else {
                    setChapter({ title: tt('error'), html: `<p>${tt('loadChapterFailed')}</p>`, index: 0, total: 0 })
                    setTotalChapters(Math.max(1, tocItems.length || 1))
                }
            } catch (err) {
                console.error('Failed to load EPUB', err)
            }
            setLoading(false)
        })()
    }, [id])

    const loadChapter = async (index, options = {}) => {
        const rawInitialPage = options?.page
        const initialPage = rawInitialPage === 'last'
            ? 'last'
            : Math.max(0, Number.isFinite(rawInitialPage) ? rawInitialPage : 0)

        pendingChapterPageRef.current = initialPage
        setLoading(true)
        setChapterIndex(index)
        setChapterPage(initialPage === 'last' ? 0 : initialPage)
        try {
            const res = await fetch(`${API}/${id}/chapter/${index}`)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const nextChapter = await res.json()
            setChapter(nextChapter)
            if (Number.isFinite(nextChapter?.total) && nextChapter.total > 0) {
                setTotalChapters(nextChapter.total)
            }
        } catch {
            setChapter({ title: tt('error'), html: `<p>${tt('loadChapterFailed')}</p>`, index, total: 0 })
        }
        setLoading(false)
    }

    const waitForMeasuredAssets = useCallback(async (root) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

        const images = Array.from(root.querySelectorAll('img')).filter((img) => !img.complete)
        if (images.length > 0) {
            await new Promise((resolve) => {
                let pending = images.length
                const cleanup = []
                const finish = () => {
                    while (cleanup.length > 0) cleanup.pop()()
                    resolve()
                }
                const timeout = window.setTimeout(finish, 1200)
                cleanup.push(() => window.clearTimeout(timeout))
                const onSettled = () => {
                    pending -= 1
                    if (pending <= 0) finish()
                }
                for (const img of images) {
                    img.addEventListener('load', onSettled, { once: true })
                    img.addEventListener('error', onSettled, { once: true })
                    cleanup.push(() => img.removeEventListener('load', onSettled))
                    cleanup.push(() => img.removeEventListener('error', onSettled))
                }
            })
        }

        if (typeof document !== 'undefined' && document.fonts?.ready) {
            await Promise.race([
                document.fonts.ready,
                new Promise((resolve) => window.setTimeout(resolve, 500)),
            ]).catch(() => {})
        }

        await new Promise((resolve) => requestAnimationFrame(resolve))
    }, [])

    const measureChapterHtml = useCallback(async (html) => {
        const host = measureHostRef.current
        if (!host || pageWidth <= 0 || pageHeight <= 0) return 1

        host.innerHTML = ''

        const scroller = document.createElement('div')
        scroller.className = 'reader-scroller'
        scroller.style.position = 'relative'
        scroller.style.width = `${pageWidth}px`
        scroller.style.height = `${pageHeight}px`
        scroller.style.overflowX = 'auto'
        scroller.style.overflowY = 'hidden'
        scroller.style.scrollSnapType = 'none'
        scroller.style.scrollbarGutter = 'stable'

        const contentEl = document.createElement('div')
        contentEl.className = 'select-text epub-content'
        contentEl.style.height = '100%'
        contentEl.style.boxSizing = 'border-box'
        contentEl.style.display = 'block'
        contentEl.style.backgroundColor = 'var(--reader-page-bg)'
        contentEl.style.color = 'var(--reader-page-fg)'
        if (useEmbeddedFonts) contentEl.style.removeProperty('font-family')
        else contentEl.style.fontFamily = contentStyle.fontFamily
        contentEl.style.fontWeight = String(contentStyle.fontWeight)
        contentEl.style.fontSize = contentStyle.fontSize
        contentEl.style.lineHeight = `${lineHeight}`
        contentEl.style.letterSpacing = `${letterSpacing}em`
        contentEl.style.textAlign = 'left'
        contentEl.style.hyphens = 'auto'
        contentEl.style.setProperty('-webkit-hyphens', 'auto')
        contentEl.style.wordBreak = 'break-word'
        contentEl.style.overflowWrap = 'break-word'
        contentEl.style.columnCount = isDualLayout ? '2' : '1'
        contentEl.style.columnGap = `${columnGap}px`
        contentEl.style.columnFill = 'auto'
        contentEl.style.columnRule = isDualLayout ? '1px solid transparent' : 'none'
        contentEl.style.breakInside = 'avoid-column'
        contentEl.innerHTML = html

        scroller.appendChild(contentEl)
        host.appendChild(scroller)

        const W = scroller.clientWidth
        const H = Math.max(1, Math.floor(scroller.clientHeight))
        const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap
        const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const colW = isDualLayout ? Math.max(1, Math.floor((W - gap) / 2)) : Math.max(1, Math.floor(W))

        contentEl.style.columnWidth = `${colW}px`
        contentEl.style.columnCount = isDualLayout ? '2' : '1'
        contentEl.style.columnFill = 'auto'
        contentEl.style.height = `${H}px`
        contentEl.style.display = 'block'
        contentEl.style.textAlign = 'left'
        contentEl.style.columnRule = isDualLayout ? '1px solid transparent' : 'none'

        await waitForMeasuredAssets(contentEl)

        const finalStyles = getComputedStyle(contentEl)
        const measuredRawGap = finalStyles.columnGap
        const measuredFallbackGap = parseFloat(finalStyles.fontSize) || 16
        const measuredGap = measuredRawGap === 'normal' ? measuredFallbackGap : (parseFloat(measuredRawGap) || 0)
        const step = W + measuredGap
        const pages = step > 0 ? Math.max(1, Math.ceil((scroller.scrollWidth + measuredGap) / step)) : 1

        host.innerHTML = ''
        return pages
    }, [columnGap, contentStyle.fontFamily, contentStyle.fontSize, contentStyle.fontWeight, isDualLayout, letterSpacing, lineHeight, pageHeight, pageWidth, useEmbeddedFonts, waitForMeasuredAssets])

    const measure = useCallback(() => {
        const scroller = scrollerRef.current; const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth; const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const colW = isDualLayout ? Math.max(1, Math.floor((W - gap) / 2)) : Math.max(1, Math.floor(W))
        const H = Math.max(1, Math.floor(scroller.clientHeight))
        contentEl.style.columnWidth = `${colW}px`; contentEl.style.columnCount = isDualLayout ? '2' : '1'
        contentEl.style.columnFill = 'auto'; contentEl.style.height = `${H}px`; contentEl.style.display = 'block'
        contentEl.style.textAlign = 'left'; contentEl.style.columnRule = isDualLayout ? '1px solid transparent' : 'none'
        const step = W + gap; if (step <= 0) return
        const oldStep = stepRef.current > 0 ? stepRef.current : step; const oldLeft = scroller.scrollLeft
        stepRef.current = step; setPageWidth(W); setPageHeight(H)
        const pages = Math.max(1, Math.ceil((scroller.scrollWidth + gap) / step)); initialMeasureDoneRef.current = true; setChapterPaginationReady(true); setChapterTotalPages(pages)
        const pendingPage = getPendingPage()
        const requestedChapterPage = pendingChapterPageRef.current
        if (requestedChapterPage != null) pendingChapterPageRef.current = null
        const idxFromScroll = requestedChapterPage === 'last'
            ? pages - 1
            : (Number.isFinite(requestedChapterPage) ? requestedChapterPage : (pendingPage ?? Math.round(oldLeft / oldStep)))
        const clamped = Math.max(0, Math.min(idxFromScroll, pages - 1))
        scroller.scrollTo({ left: Math.round(clamped * step), behavior: 'auto' })
        setChapterPage(prev => (prev === clamped ? prev : clamped))
    }, [getPendingPage, isDualLayout])

    useEffect(() => {
        if (chapter?.index == null || !Number.isFinite(chapterTotalPages) || chapterTotalPages < 1) return
        setChapterPageCounts((prev) => (prev[chapter.index] === chapterTotalPages ? prev : { ...prev, [chapter.index]: chapterTotalPages }))
    }, [chapter?.index, chapterTotalPages, paginationSignature])

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
        if (loading || !chapter) {
            clearScheduledMeasure()
            initialMeasureDoneRef.current = false
            setChapterPaginationReady(false)
            return undefined
        }

        clearScheduledMeasure()
        initialMeasureDoneRef.current = false
        setChapterPaginationReady(false)

        return scheduleAfterPaint(() => {
            scheduleMeasure()
        })
    }, [chapter, clearScheduledMeasure, loading, scheduleMeasure])

    useEffect(() => {
        if (typeof ResizeObserver !== 'undefined') return undefined
        window.addEventListener('resize', scheduleMeasure)
        return () => window.removeEventListener('resize', scheduleMeasure)
    }, [scheduleMeasure])

    useEffect(() => {
        const frame = frameRef.current
        if (!frame || typeof ResizeObserver === 'undefined') return undefined
        const ro = new ResizeObserver(() => {
            if (!initialMeasureDoneRef.current) return
            scheduleMeasure()
        })
        ro.observe(frame)
        return () => ro.disconnect()
    }, [scheduleMeasure])

    const goToPage = useCallback((page) => {
        const s = scrollerRef.current; const c = contentRef.current; if (!s || !c) return
        const target = Math.max(0, Math.min(page, chapterTotalPages - 1))
        const W = s.clientWidth; const cs = getComputedStyle(c)
        const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap; if (step <= 0) return; stepRef.current = step
        lockPendingPage(target)
        s.scrollTo({ left: Math.round(target * step), behavior: 'auto' }); setChapterPage(target)
    }, [chapterTotalPages, lockPendingPage])

    const goToOverallPage = useCallback((overallPage) => {
        if (!overallPagination.ready || overallPagination.totalPages <= 0) return
        const target = Math.max(0, Math.min(overallPage, overallPagination.totalPages - 1))
        for (let i = 0; i < totalChapters; i += 1) {
            const start = overallPagination.offsets[i] || 0
            const end = i + 1 < totalChapters ? overallPagination.offsets[i + 1] : overallPagination.totalPages
            if (target < end) {
                const targetPage = target - start
                if (i === chapterIndex) goToPage(targetPage)
                else loadChapter(i, { page: targetPage })
                return
            }
        }
    }, [chapterIndex, goToPage, overallPagination, totalChapters])

    const seekToOverallProgress = useCallback((progressValue) => {
        if (!overallPagination.ready || overallPagination.totalPages <= 1) return
        goToOverallPage(Math.round(progressValue * (overallPagination.totalPages - 1)))
    }, [goToOverallPage, overallPagination])

    useEffect(() => { const s = scrollerRef.current; const c = contentRef.current; if (!s || !c) return; const W = s.clientWidth; const cs = getComputedStyle(c); const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16; const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0); const step = W + gap; if (step <= 0) return; stepRef.current = step; s.scrollTo({ left: Math.round(chapterPage * step), behavior: 'auto' }) }, [chapterPage])

    useEffect(() => {
        const s = scrollerRef.current; const c = contentRef.current; if (!s || !c) return; let timer = null
        const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { const W = s.clientWidth; const cs = getComputedStyle(c); const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16; const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0); const step = W + gap; if (step <= 0) return; stepRef.current = step; const pendingPage = getPendingPage(); const idx = pendingPage ?? Math.round(s.scrollLeft / step); const snapLeft = Math.round(idx * step); if (Math.abs(s.scrollLeft - snapLeft) >= 1) s.scrollTo({ left: snapLeft, behavior: 'auto' }); const clamped = Math.max(0, Math.min(idx, chapterTotalPages - 1)); setChapterPage(prev => (prev === clamped ? prev : clamped)) }, 120) }
        s.addEventListener('scroll', onScroll, { passive: true }); return () => { if (timer) clearTimeout(timer); s.removeEventListener('scroll', onScroll) }
    }, [chapterTotalPages, getPendingPage])

    useEffect(() => {
        if (loading || !chapterPaginationReady || totalChapters <= 0 || pageWidth <= 0 || pageHeight <= 0) return
        let cancelled = false
        let cancelScheduledWork = () => {}
        const controller = new AbortController()

        const waitForTurn = (delay = 0) => new Promise((resolve) => {
            cancelScheduledWork()
            cancelScheduledWork = scheduleBackgroundWork(() => {
                cancelScheduledWork = () => {}
                resolve()
            }, delay)
        })

        const run = async () => {
            let firstPendingChapter = true

            for (let index = 0; index < totalChapters; index += 1) {
                if (cancelled) return
                const knownPages = chapterPageCountsRef.current[index]
                if (Number.isFinite(knownPages) && knownPages > 0) continue

                await waitForTurn(firstPendingChapter ? PAGE_COUNT_START_DELAY_MS : 0)
                firstPendingChapter = false
                if (cancelled) return

                let html = index === chapter?.index ? chapter?.html : ''
                if (!html) {
                    const res = await fetch(`${API}/${id}/chapter/${index}`, { signal: controller.signal })
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    const data = await res.json()
                    html = data?.html || ''
                }

                const pages = await measureChapterHtml(html)
                if (cancelled) return
                setChapterPageCounts((prev) => (prev[index] === pages ? prev : { ...prev, [index]: pages }))
            }
        }

        run().catch((err) => {
            if (!cancelled && err?.name !== 'AbortError') {
                console.error('Failed to measure EPUB page counts', err)
            }
        })

        return () => {
            cancelled = true
            cancelScheduledWork()
            controller.abort()
            if (measureHostRef.current) measureHostRef.current.innerHTML = ''
        }
    }, [chapter?.html, chapter?.index, chapterPaginationReady, id, loading, measureChapterHtml, pageHeight, pageWidth, paginationSignature, totalChapters])

    const goNext = useCallback(() => { if (chapterPage < chapterTotalPages - 1) goToPage(chapterPage + 1); else if (chapter && chapterIndex < chapter.total - 1) loadChapter(chapterIndex + 1, { page: 0 }) }, [chapterPage, chapterTotalPages, chapter, chapterIndex, goToPage])
    const goPrev = useCallback(() => { if (chapterPage > 0) goToPage(chapterPage - 1); else if (chapterIndex > 0) loadChapter(chapterIndex - 1, { page: 'last' }) }, [chapterPage, chapterIndex, goToPage])
    useKeyboardNav({ onNext: goNext, onPrev: goPrev, onEscape: toggleTitleBar, enabled: true })

    const openEpubImageInWindow = useCallback((imgEl) => {
        if (!imgEl || typeof window === 'undefined') return
        const rawSrc = imgEl.getAttribute('src') || imgEl.currentSrc || imgEl.src
        if (!rawSrc) return

        let src
        try {
            src = new URL(rawSrc, window.location.href).href
        } catch {
            src = rawSrc
        }

        const naturalWidth = imgEl.naturalWidth || 1280
        const naturalHeight = imgEl.naturalHeight || 720
        const availW = window.screen?.availWidth || 1600
        const availH = window.screen?.availHeight || 900
        const popupW = Math.max(640, Math.min(Math.floor(availW * 0.95), naturalWidth + 120))
        const popupH = Math.max(480, Math.min(Math.floor(availH * 0.95), naturalHeight + 140))
        const popup = window.open('', '_blank', `noopener,noreferrer,width=${popupW},height=${popupH}`)
        if (!popup) {
            window.open(src, '_blank', 'noopener,noreferrer')
            return
        }

        const safeSrc = src.replace(/"/g, '&quot;')
        popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Image Preview</title><style>html,body{margin:0;width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center}img{max-width:100vw;max-height:100vh;width:auto;height:auto;object-fit:contain}</style></head><body><img src="${safeSrc}" alt=""></body></html>`)
        popup.document.close()
    }, [])


    useEffect(() => {
        if (!chapter || loading) return

        const timers = new Set()
        const contentEl = contentRef.current
        if (!contentEl) return

        const scheduleDelayedMeasure = (delay = 0) => {
            const timer = window.setTimeout(() => {
                timers.delete(timer)
                scheduleMeasure()
            }, delay)
            timers.add(timer)
        }

        const images = Array.from(contentEl.querySelectorAll('img'))
        const onAssetSettled = () => scheduleDelayedMeasure(0)
        for (const img of images) {
            if (img.complete) continue
            img.addEventListener('load', onAssetSettled)
            img.addEventListener('error', onAssetSettled)
        }

        if (typeof document !== 'undefined' && document.fonts?.ready) {
            document.fonts.ready.then(() => scheduleDelayedMeasure(0)).catch(() => {})
        }

        scheduleDelayedMeasure(0)
        scheduleDelayedMeasure(250)
        scheduleDelayedMeasure(800)

        return () => {
            for (const timer of timers) window.clearTimeout(timer)
            for (const img of images) {
                img.removeEventListener('load', onAssetSettled)
                img.removeEventListener('error', onAssetSettled)
            }
        }
    }, [chapter?.html, loading, fontMode, scheduleMeasure])

    useEffect(() => {
        const contentEl = contentRef.current
        if (!contentEl) return

        const onClick = (event) => {
            const target = event.target
            if (!(target instanceof Element)) return
            const imgEl = target.closest('img')
            if (!imgEl || !contentEl.contains(imgEl)) return
            event.preventDefault()
            event.stopPropagation()
            openEpubImageInWindow(imgEl)
        }

        contentEl.addEventListener('click', onClick)
        return () => contentEl.removeEventListener('click', onClick)
    }, [chapter?.index, openEpubImageInWindow])

    useEffect(() => {
        if (loading) return
        const handleSelectionChange = () => {
            const nextSelection = getSelectionSnapshot(contentRef.current)
            setSelectionSnapshot(nextSelection)
        }
        document.addEventListener('selectionchange', handleSelectionChange)
        return () => document.removeEventListener('selectionchange', handleSelectionChange)
    }, [loading, chapter?.index, chapter?.html, chapterPage])

    useEffect(() => {
        setSelectionSnapshot(null)
        clearCurrentSelection()
    }, [chapter?.index, chapterPage, searchOpen, annotationsOpen])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading) return

        clearSearchHighlights(root)
        if (shouldRenderSearchHighlight) {
            clearAnnotationHighlights(root)
            const pendingResult = pendingSearchResultRef.current
            const targetIndex = pendingResult && pendingResult.chapter_index === chapter?.index
                ? (pendingResult.chapter_match_index ?? 0)
                : activeChapterMatchIndex
            if (targetIndex == null) return
            const target = highlightSearchMatchInElement(root, searchQuery, targetIndex)
            if (target) scrollSearchMarkIntoView(target)
            if (pendingResult && pendingResult.chapter_index === chapter?.index) {
                pendingSearchResultRef.current = null
            }
            return
        }

        highlightAnnotationsInElement(root, currentChapterAnnotations)
    }, [activeChapterMatchIndex, chapter?.html, chapter?.index, currentChapterAnnotations, loading, searchQuery, shouldRenderSearchHighlight])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading || shouldRenderSearchHighlight || !activeAnnotationId) return
        const target = activateAnnotationHighlight(root, activeAnnotationId)
        if (target) scrollAnnotationIntoView(target)
    }, [activeAnnotationId, chapter?.html, chapter?.index, chapterPage, currentChapterAnnotations, loading, shouldRenderSearchHighlight])

    const handleSearchResultClick = useCallback((result) => {
        setAnnotationsOpen(false)
        setActiveAnnotationId(null)
        setActiveSearchIndex(result.index)
        const chapterMatchIndex = Number.isFinite(result.chapter_match_index) ? result.chapter_match_index : 0
        if (result.chapter_index == null || result.chapter_index === chapterIndex) {
            pendingSearchResultRef.current = null
            setActiveChapterMatchIndex(chapterMatchIndex)
            return
        }
        pendingSearchResultRef.current = result
        setActiveChapterMatchIndex(chapterMatchIndex)
        loadChapter(result.chapter_index, { page: 0 })
    }, [chapterIndex])

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
                    locator: `chapter:${chapterIndex}:page:${chapterPage}`,
                    page: chapterPage,
                    chapter_index: chapterIndex,
                    chapter_title: chapter?.title || null,
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
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
            setActiveAnnotationId(created.id)
            setSelectionSnapshot(null)
            clearCurrentSelection()
        } catch (err) {
            console.error('Failed to create annotation', err)
            window.alert(tt('annotationSaveFailed'))
        }
    }, [chapter?.title, chapterIndex, chapterPage, id, selectionSnapshot, tt])

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
        setActiveSearchIndex(null)
        setActiveChapterMatchIndex(null)
        pendingSearchResultRef.current = null
        setActiveAnnotationId(annotation.id)

        if (annotation.chapter_index != null && annotation.chapter_index !== chapterIndex) {
            loadChapter(annotation.chapter_index, { page: Number.isFinite(annotation.page) ? annotation.page : 0 })
            return
        }

        if (Number.isFinite(annotation.page)) {
            goToPage(annotation.page)
        }
    }, [chapterIndex, goToPage])

    return (        <div className="readerRoot h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)', transition: 'background-color 0.3s, color 0.3s' }}>

            <div className="reader-ui shrink-0 flex items-center justify-between px-6 py-2.5" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/')} title={tt('backToLibrary')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
                    <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>EPUB</span>
                    <span className="text-sm opacity-60 truncate max-w-[18rem]" style={{ color: themeStyle.text }}>{bookTitle}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => { setSearchOpen((open) => !open); setAnnotationsOpen(false); setActiveAnnotationId(null) }} title={tt('search')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: searchOpen ? '#5c7cfa' : themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></svg></button>
                    <button onClick={() => { setAnnotationsOpen((open) => !open); setSearchOpen(false) }} title={tt('annotations')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: annotationsOpen ? '#ff922b' : themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg></button>
                    <button onClick={addBookmark} title={tt('bookmark')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></button>
                    <button onClick={() => setSidebarOpen(o => !o)} title={tt('toc')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg></button>
                    <ReaderToolbar settings={settings} readerType="epub" />
                </div>
            </div>

            {bookmarks.length > 0 && (
                <div className="reader-ui shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                    <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0" style={{ color: themeStyle.text }}>{tt('bookmarks')}</span>
                    {bookmarks.map(b => (
                        <button key={b.position} onClick={() => { goToBookmark(b.position); loadChapter(b.position) }} className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0" style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
                            {tt('chapter')} {b.position + 1}<span onClick={(e) => { e.stopPropagation(); removeBookmark(b.position) }} className="ml-1.5 opacity-30 hover:opacity-100 cursor-pointer">횞</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 flex min-h-0 overflow-hidden">
                {sidebarOpen && (
                    <div className="reader-ui w-56 shrink-0 overflow-y-auto py-4 px-3" style={{ borderRight: `1px solid ${themeStyle.border}`, backgroundColor: themeStyle.card }}>
                        <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-3 px-2" style={{ color: themeStyle.text }}>{tt('contents')}</h3>
                        <div className="space-y-0.5">
                            {toc.map(item => (
                                <button key={item.index} onClick={() => loadChapter(item.index)} className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-all ${chapterIndex === item.index ? 'font-medium' : 'opacity-50 hover:opacity-100'}`} style={{ color: themeStyle.text, backgroundColor: chapterIndex === item.index ? themeStyle.border : 'transparent' }}>{item.title}</button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex-1 relative min-h-0">
                    <ReaderSearchPanel open={searchOpen} themeStyle={themeStyle} query={searchDraft} submittedQuery={searchQuery} loading={searchLoading} results={searchResults} activeIndex={activeSearchIndex} onQueryChange={handleSearchQueryChange} onSubmit={handleSearchSubmit} onClose={() => setSearchOpen(false)} onResultClick={handleSearchResultClick} tt={tt} />
                    <ReaderAnnotationsPanel open={annotationsOpen} themeStyle={themeStyle} loading={annotationsLoading} annotations={annotations} activeAnnotationId={activeAnnotationId} onClose={() => setAnnotationsOpen(false)} onItemClick={handleAnnotationClick} onDeleteItem={handleDeleteAnnotation} onEditItem={handleEditAnnotation} onColorItem={handleCycleAnnotationColor} tt={tt} lang={lang} />
                    <ReaderSelectionMenu selection={selectionSnapshot} themeStyle={themeStyle} onHighlight={() => createAnnotation('highlight')} onNote={() => createAnnotation('note')} onClear={() => { setSelectionSnapshot(null); clearCurrentSelection() }} tt={tt} />
                    <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goPrev}>{(chapterPage > 0 || chapterIndex > 0) && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></div>)}</div>
                    <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goNext}>{(chapterPage < chapterTotalPages - 1 || (chapter && chapterIndex < chapter.total - 1)) && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>)}</div>

                    {layout === 'dual' && (<div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-8 z-10 pointer-events-none" style={{ background: `linear-gradient(to right, transparent, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 45%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)'} 50%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 55%, transparent)` }} />)}

                    <div ref={frameRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${hMargin}px`, boxSizing: 'border-box' }}>
                        {loading ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div className="text-sm opacity-60">{tt('loading')}</div></div>
                        ) : chapter ? (
                            <div key={chapter?.index ?? 0} ref={scrollerRef} className="reader-scroller" style={{ position: 'relative', width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'none', scrollbarGutter: 'stable' }}>
                                <div ref={contentRef} className="select-text epub-content [&_p]:mb-4 [&_p]:break-inside-avoid [&_h1]:text-2xl [&_h1]:mb-5 [&_h1]:break-after-avoid [&_h2]:text-xl [&_h2]:mb-4 [&_h2]:break-after-avoid [&_h3]:text-lg [&_h3]:mb-3 [&_h3]:break-after-avoid [&_img]:max-w-full [&_img]:max-h-[50vh] [&_img]:rounded-lg [&_img]:mx-auto [&_img]:my-4 [&_img]:break-inside-avoid [&_img]:cursor-zoom-in [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:opacity-80 [&_blockquote]:break-inside-avoid"
                                    style={{ height: '100%', boxSizing: 'border-box', display: 'block', backgroundColor: 'var(--reader-page-bg)', color: 'var(--reader-page-fg)', fontFamily: useEmbeddedFonts ? undefined : contentStyle.fontFamily, fontWeight: contentStyle.fontWeight, fontSize: contentStyle.fontSize, lineHeight: `${lineHeight}`, letterSpacing: `${letterSpacing}em`, textAlign: 'left', hyphens: 'auto', WebkitHyphens: 'auto', wordBreak: 'break-word', overflowWrap: 'break-word', columnCount: isDualLayout ? 2 : 1, columnGap: `${columnGap}px`, columnFill: 'auto', columnRule: isDualLayout ? '1px solid transparent' : 'none', breakInside: 'avoid-column' }}
                                    dangerouslySetInnerHTML={{ __html: chapter.html }}
                                />
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="reader-ui">
                {chapter && (<ReaderProgressBar currentPage={overallPagination.currentPage} totalPages={overallPagination.totalPages} onSeekPage={overallPagination.ready ? (p) => goToOverallPage(p - 1) : undefined} progress={overallPagination.totalPages > 1 ? (overallPagination.currentPage - 1) / (overallPagination.totalPages - 1) : 0} onSeekProgress={overallPagination.ready ? seekToOverallProgress : undefined} extraInfo={`${tt('chapter')} ${chapterIndex + 1}/${chapter?.total || totalChapters}`} />)}
                <ResumeToast resumePrompt={resumePrompt} onResume={() => { resumeReading(); if (resumePrompt) loadChapter(resumePrompt.position) }} onDismiss={dismissResume} tt={tt} />
            </div>

            <div ref={measureHostRef} aria-hidden="true" style={{ position: 'fixed', left: '-100000px', top: '0', width: '1px', height: '1px', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }} />
        </div>
    )
}

export default EpubReader















