import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useResponsiveReaderLayout } from '../hooks/useResponsiveReaderLayout'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReaderCommandShortcuts } from '../hooks/useReaderCommandShortcuts'
import { useReadingProgress } from '../hooks/useReadingProgress'
import ReaderToolbar from './ReaderToolbar'
import ReaderBookmarksPanel, {
    ReaderBookmarkFab,
    ReaderBookmarkNavigator,
    ReaderBookmarkToggle,
} from './ReaderBookmarks'
import ReaderProgressBar from './ReaderProgressBar'
import ResumeToast from './ResumeToast'
import ReaderSearchPanel from './ReaderSearchPanel'
import ReaderAnnotationsPanel from './ReaderAnnotationsPanel'
import ReaderSelectionMenu from './ReaderSelectionMenu'
import ReaderLoadProblem from './ReaderLoadProblem'
import ReaderShell, {
    ReaderNoticeBar,
    ReaderPageTurnControls,
    ReaderTopBar,
} from './ReaderShell'
import { API_BOOKS_BASE, authenticateAssetUrl } from '../lib/apiBase'
import { readApiProblem } from '../lib/readErrorDetail'
import { clearSearchHighlights, highlightSearchMatchInElement, scrollSearchMarkIntoView } from '../lib/searchHighlighter'
import { activateAnnotationHighlight, clearAnnotationHighlights, highlightAnnotationsInElement, scrollAnnotationIntoView } from '../lib/annotationHighlighter'
import { clearCurrentSelection, getSelectionSnapshot } from '../lib/annotationSelection'
import { getDefaultAnnotationColor, getNextAnnotationColor } from '../lib/annotationColors'
import { getBookmarkExcerpt } from '../lib/bookmarkExcerpt'
import { createBookmarkThemeStyle } from '../lib/bookmarkTheme'
import { captureEpubBookmarkAnchor, resolveEpubBookmarkPage } from '../lib/epubBookmarkAnchor'
import { buildEpubTypographyCss } from '../lib/epubTypography'
import { sanitizeEpubHtml } from '../lib/epubSanitizer'

const API = API_BOOKS_BASE
const API_ROOT = API.replace(/\/books$/, '')
const PAGE_COUNT_START_DELAY_MS = 2200
const PAGE_COUNT_IDLE_TIMEOUT_MS = 1500
const EPUB_CONTENT_CLASS_NAME = 'select-text epub-content [&_p]:mb-4 [&_h1]:text-2xl [&_h1]:mb-5 [&_h1]:break-after-avoid [&_h2]:text-xl [&_h2]:mb-4 [&_h2]:break-after-avoid [&_h3]:text-lg [&_h3]:mb-3 [&_h3]:break-after-avoid [&_img]:max-w-full [&_img]:max-h-full [&_img]:rounded-lg [&_img]:mx-auto [&_img]:my-4 [&_img]:break-inside-avoid [&_img]:cursor-zoom-in [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:opacity-80 [&_blockquote]:break-inside-avoid'

export function getEpubSpreadNavigationGap(measuredColumnGap, isDualLayout, horizontalMargin) {
    const measuredGap = Math.max(0, Number(measuredColumnGap) || 0)
    if (!isDualLayout) return measuredGap
    return Math.max(0, measuredGap - (Math.max(0, Number(horizontalMargin) || 0) * 2))
}

function applyEpubOwnedLayoutStyles(contentEl, { columnGap, horizontalMargin, isDualLayout }) {
    if (!contentEl) return
    contentEl.style.setProperty('column-gap', `${columnGap}px`, 'important')
    contentEl.style.setProperty('padding', isDualLayout ? `0 ${horizontalMargin}px` : '0', 'important')
}

function normalizeEpubHrefPath(href) {
    if (!href || href.startsWith('#')) return ''
    try {
        const parsed = new URL(href, 'https://bookreader.local/')
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).replace(/\\/g, '/')
    } catch {
        return String(href).split('#')[0].split('?')[0].replace(/^\/+/, '').replace(/\\/g, '/')
    }
}

function hrefPathsMatch(left, right) {
    const leftPath = normalizeEpubHrefPath(left)
    const rightPath = normalizeEpubHrefPath(right)
    if (!leftPath || !rightPath) return false
    if (leftPath === rightPath) return true
    return leftPath.endsWith(`/${rightPath}`)
        || rightPath.endsWith(`/${leftPath}`)
        || leftPath.split('/').pop() === rightPath.split('/').pop()
}

function escapeCssIdent(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
    return String(value).replace(/["\\#.;,[\]=~>*+^$|!:\s]/g, '\\$&')
}

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
    const { contentStyle, themeStyle, layout: preferredLayout, setLayout, columnGap, hMargin, vMargin,
        lineHeight, letterSpacing, fontMode, lang, tt, incFont, decFont } = settings

    const layout = useResponsiveReaderLayout(preferredLayout)
    const bookmarkThemeStyle = useMemo(() => createBookmarkThemeStyle(themeStyle), [themeStyle])
    const [toc, setToc] = useState([])
    const [bookTitle, setBookTitle] = useState('')
    const [chapter, setChapter] = useState(null)
    const [loading, setLoading] = useState(true)
    const [initialProblem, setInitialProblem] = useState(null)
    const [chapterProblem, setChapterProblem] = useState(null)
    const [formatDiagnostics, setFormatDiagnostics] = useState([])
    const [initialLoadAttempt, setInitialLoadAttempt] = useState(0)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchDraft, setSearchDraft] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [searchRequestId, setSearchRequestId] = useState(0)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState([])
    const [searchMeta, setSearchMeta] = useState({ total: 0, complete: true, partial_reason: null, results_truncated: false })
    const [searchError, setSearchError] = useState('')
    const [activeSearchIndex, setActiveSearchIndex] = useState(null)
    const [activeChapterMatchIndex, setActiveChapterMatchIndex] = useState(null)
    const [annotationsOpen, setAnnotationsOpen] = useState(false)
    const [bookmarksOpen, setBookmarksOpen] = useState(false)
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
    const readerRootRef = useRef(null)
    const frameRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const measureHostRef = useRef(null)
    const stepRef = useRef(0)
    const pendingPageRef = useRef(null)
    const pendingPageUntilRef = useRef(0)
    const pendingChapterPageRef = useRef(null)
    const pendingTextAnchorRef = useRef(null)
    const chapterPageCountsRef = useRef({})
    const pendingSearchResultRef = useRef(null)
    const searchAbortRef = useRef(null)
    const searchGenerationRef = useRef(0)
    const appliedRestoreKeyRef = useRef(null)
    const initialMeasureDoneRef = useRef(false)
    const scheduledMeasureCleanupRef = useRef(null)
    const initialLoadGenerationRef = useRef(0)
    const chapterLoadGenerationRef = useRef(0)
    const chapterLoadAbortRef = useRef(null)
    const chapterRetryRef = useRef(null)

    const [totalChapters, setTotalChapters] = useState(1)
    const progress = useReadingProgress(id, {
        totalPages: totalChapters,
        type: 'epub',
        legacyId,
        paginationReady: !loading && totalChapters > 0,
        locator: () => {
            const textAnchor = captureEpubBookmarkAnchor(
                contentRef.current,
                scrollerRef.current,
                chapterPage,
                stepRef.current,
                selectionSnapshot,
            )
            return {
                kind: 'epub',
                chapterHref: toc.find((item) => item.index === chapterIndex)?.href || null,
                chapterTitle: chapter?.title || null,
                chapterIndex,
                chapterPage,
                fallbackPage: chapterPage,
                ...textAnchor,
            }
        },
        locatorToPosition: (saved) => toc.find((item) => item.href && item.href === saved?.chapterHref)?.index
            ?? saved?.chapterIndex,
        bookmarkSnapshot: () => {
            const textAnchor = captureEpubBookmarkAnchor(
                contentRef.current,
                scrollerRef.current,
                chapterPage,
                stepRef.current,
                selectionSnapshot,
            )
            return {
                excerpt: getBookmarkExcerpt(textAnchor?.quote?.exact || chapter?.title || bookTitle),
            }
        },
    })
    const { currentPosition: chapterIndex, setCurrentPosition: setChapterIndex,
        bookmarks, addBookmark, removeBookmark, updateBookmark, goToBookmark,
        restoredProgress, startOver } = progress
    const isDualLayout = layout === 'dual'
    const effectiveColumnGap = isDualLayout ? columnGap + (hMargin * 2) : columnGap
    const useEmbeddedFonts = fontMode === 'embedded'
    const isSearchActive = searchOpen && !!searchQuery.trim()
    const shouldRenderSearchHighlight = isSearchActive && activeChapterMatchIndex != null
    const epubTypographyCss = useMemo(() => buildEpubTypographyCss({
        useEmbeddedFonts,
        fontFamily: contentStyle.fontFamily,
        fontWeight: contentStyle.fontWeight,
    }), [contentStyle.fontFamily, contentStyle.fontWeight, useEmbeddedFonts])
    const sanitizedChapterHtml = useMemo(
        () => sanitizeEpubHtml(chapter?.html || '', { assetBooksBase: API, assetUrlTransform: authenticateAssetUrl }),
        [chapter?.html],
    )

    const handleSearchQueryChange = useCallback((value) => {
        const trimmedValue = value.trim()
        setSearchDraft(value)
        if (!trimmedValue) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
            setActiveSearchIndex(null)
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
            return
        }
        if (trimmedValue !== searchQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
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
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
            setActiveSearchIndex(null)
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
            return
        }
        setSearchQuery(trimmedQuery)
        setSearchRequestId((value) => value + 1)
    }, [searchDraft])

    const handleSearchCancel = useCallback(() => {
        searchAbortRef.current?.abort()
        searchGenerationRef.current += 1
        setSearchLoading(false)
        setSearchError('')
        setSearchMeta((current) => ({ ...current, complete: false, partial_reason: 'cancelled' }))
    }, [])
    const currentChapterAnnotations = useMemo(
        () => annotations.filter((annotation) => annotation.chapter_index == null || annotation.chapter_index === chapter?.index),
        [annotations, chapter?.index],
    )

    const paginationSignature = useMemo(() => JSON.stringify({
        id,
        layout,
        columnGap: effectiveColumnGap,
        hMargin,
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
        effectiveColumnGap,
        hMargin,
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
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
            setActiveSearchIndex(null)
            setActiveChapterMatchIndex(null)
            pendingSearchResultRef.current = null
            return
        }

        const controller = new AbortController()
        const generation = searchGenerationRef.current + 1
        searchGenerationRef.current = generation
        searchAbortRef.current = controller

        ; (async () => {
            setSearchLoading(true)
            setSearchError('')
            try {
                const res = await fetch(`${API}/${id}/search?q=${encodeURIComponent(trimmedQuery)}`, { signal: controller.signal })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                if (!controller.signal.aborted && searchGenerationRef.current === generation) {
                    setSearchResults(Array.isArray(data?.results) ? data.results : [])
                    setSearchMeta({
                        total: Number.isFinite(data?.total) ? data.total : 0,
                        complete: data?.complete !== false,
                        partial_reason: data?.partial_reason || null,
                        results_truncated: Boolean(data?.results_truncated),
                    })
                    setActiveSearchIndex(null)
                    setActiveChapterMatchIndex(null)
                    pendingSearchResultRef.current = null
                }
            } catch (err) {
                if (err?.name !== 'AbortError' && searchGenerationRef.current === generation) {
                    console.error('Failed to search EPUB', err)
                    setSearchResults([])
                    setSearchError(tt('searchFailed'))
                    setActiveSearchIndex(null)
                    setActiveChapterMatchIndex(null)
                    pendingSearchResultRef.current = null
                }
            }
            if (!controller.signal.aborted && searchGenerationRef.current === generation) setSearchLoading(false)
        })()

        return () => {
            controller.abort()
            if (searchAbortRef.current === controller) searchAbortRef.current = null
        }
    }, [id, searchOpen, searchQuery, searchRequestId])

    useEffect(() => {
        chapterPageCountsRef.current = {}
        setChapterPageCounts({})
    }, [paginationSignature])

    // Load both pieces in parallel, but retain a structured failure instead of
    // silently rendering an empty reader when either request fails.
    useEffect(() => {
        const controller = new AbortController()
        const generation = initialLoadGenerationRef.current + 1
        initialLoadGenerationRef.current = generation
        chapterLoadAbortRef.current?.abort()
        chapterLoadGenerationRef.current += 1
        setLoading(true)
        setInitialProblem(null)
        setChapterProblem(null)
        setFormatDiagnostics([])
        setBookTitle('')
        setToc([])
        setChapter(null)

        ; (async () => {
            try {
                const [tocRes, chapterRes] = await Promise.all([
                    fetch(`${API}/${id}/toc`, { signal: controller.signal }),
                    fetch(`${API}/${id}/chapter/0`, { signal: controller.signal }),
                ])

                if (!tocRes.ok || !chapterRes.ok) {
                    const failedResponse = !tocRes.ok ? tocRes : chapterRes
                    const fallback = !tocRes.ok ? tt('bookLoadFailed') : tt('chapterLoadFailed')
                    const problem = await readApiProblem(failedResponse, fallback)
                    if (!controller.signal.aborted && initialLoadGenerationRef.current === generation) {
                        setInitialProblem(problem)
                    }
                    return
                }

                const [tocData, firstChapter] = await Promise.all([tocRes.json(), chapterRes.json()])
                if (controller.signal.aborted || initialLoadGenerationRef.current !== generation) return
                const tocItems = Array.isArray(tocData?.toc) ? tocData.toc : []
                setBookTitle(tocData?.title || '')
                setToc(tocItems)
                setChapter(firstChapter)
                setTotalChapters(Math.max(1, firstChapter?.total || tocItems.length || 1))
                void fetch(`${API}/${id}/diagnostics`, { signal: controller.signal })
                    .then(async (response) => (response.ok ? response.json() : null))
                    .then((diagnostics) => {
                        if (controller.signal.aborted || initialLoadGenerationRef.current !== generation) return
                        setFormatDiagnostics(Array.isArray(diagnostics?.issues) ? diagnostics.issues : [])
                    })
                    .catch((reason) => {
                        if (reason?.name !== 'AbortError') console.error('Failed to load EPUB diagnostics', reason)
                    })
            } catch (err) {
                if (err?.name !== 'AbortError' && initialLoadGenerationRef.current === generation) {
                    console.error('Failed to load EPUB', err)
                    setInitialProblem({
                        code: 'network_error',
                        message: tt('bookLoadFailed'),
                        severity: 'error',
                        stage: 'open',
                        retryable: true,
                        recovery: null,
                        context: null,
                        status: null,
                    })
                }
            } finally {
                if (!controller.signal.aborted && initialLoadGenerationRef.current === generation) setLoading(false)
            }
        })()

        return () => controller.abort()
    }, [id, initialLoadAttempt])

    const loadChapter = async (index, options = {}) => {
        const rawInitialPage = options?.page
        const textAnchor = options?.textAnchor && typeof options.textAnchor === 'object'
            ? options.textAnchor
            : null
        const initialPage = rawInitialPage === 'last'
            ? 'last'
            : Math.max(0, Number.isFinite(rawInitialPage) ? rawInitialPage : 0)

        chapterLoadAbortRef.current?.abort()
        const controller = new AbortController()
        const generation = chapterLoadGenerationRef.current + 1
        chapterLoadGenerationRef.current = generation
        chapterLoadAbortRef.current = controller
        chapterRetryRef.current = { index, options: { page: initialPage, textAnchor } }
        pendingChapterPageRef.current = initialPage
        setLoading(true)
        setChapterProblem(null)
        try {
            const res = await fetch(`${API}/${id}/chapter/${index}`, { signal: controller.signal })
            if (!res.ok) {
                const problem = await readApiProblem(res, tt('chapterLoadFailed'))
                if (!controller.signal.aborted && chapterLoadGenerationRef.current === generation) {
                    setChapterProblem(problem)
                }
                return false
            }
            const nextChapter = await res.json()
            if (controller.signal.aborted || chapterLoadGenerationRef.current !== generation) return false
            pendingTextAnchorRef.current = textAnchor
            setChapter(nextChapter)
            setChapterIndex(index)
            setChapterPage(initialPage === 'last' ? 0 : initialPage)
            if (Number.isFinite(nextChapter?.total) && nextChapter.total > 0) {
                setTotalChapters(nextChapter.total)
            }
            chapterRetryRef.current = null
            return true
        } catch (err) {
            if (err?.name !== 'AbortError' && chapterLoadGenerationRef.current === generation) {
                console.error('Failed to load EPUB chapter', err)
                setChapterProblem({
                    code: 'network_error',
                    message: tt('chapterLoadFailed'),
                    severity: 'error',
                    stage: 'chapter',
                    retryable: true,
                    recovery: null,
                    context: { chapter_index: index },
                    status: null,
                })
            }
            return false
        } finally {
            if (!controller.signal.aborted && chapterLoadGenerationRef.current === generation) setLoading(false)
        }
    }

    useEffect(() => () => {
        chapterLoadAbortRef.current?.abort()
        chapterLoadGenerationRef.current += 1
    }, [])

    useEffect(() => {
        if (loading || !chapter || !restoredProgress) return
        const restoreKey = `${id}:${restoredProgress.updatedAt || ''}:${JSON.stringify(restoredProgress.locator || restoredProgress.position)}`
        if (appliedRestoreKeyRef.current === restoreKey) return
        appliedRestoreKeyRef.current = restoreKey
        const hrefChapterIndex = restoredProgress.locator?.chapterHref
            ? toc.find((item) => item.href === restoredProgress.locator.chapterHref)?.index
            : null
        const targetChapter = Math.max(0, Math.min(
            hrefChapterIndex ?? restoredProgress.locator?.chapterIndex ?? restoredProgress.position,
            Math.max(0, totalChapters - 1),
        ))
        void loadChapter(targetChapter, {
            page: Math.max(0, restoredProgress.locator?.chapterPage ?? restoredProgress.locator?.fallbackPage ?? 0),
            textAnchor: restoredProgress.locator,
        })
    }, [chapter, id, loading, restoredProgress, toc, totalChapters])

    const handleStartOver = useCallback(() => {
        appliedRestoreKeyRef.current = null
        startOver()
        void loadChapter(0, { page: 0 })
    }, [startOver])

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
        contentEl.className = EPUB_CONTENT_CLASS_NAME
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
        applyEpubOwnedLayoutStyles(contentEl, {
            columnGap: effectiveColumnGap,
            horizontalMargin: hMargin,
            isDualLayout,
        })
        contentEl.style.columnFill = 'auto'
        contentEl.style.columnRule = isDualLayout ? '1px solid transparent' : 'none'
        contentEl.style.breakInside = 'avoid-column'
        if (epubTypographyCss) {
            const styleEl = document.createElement('style')
            styleEl.textContent = epubTypographyCss
            scroller.appendChild(styleEl)
        }
        contentEl.innerHTML = sanitizeEpubHtml(html, { assetBooksBase: API, assetUrlTransform: authenticateAssetUrl })

        scroller.appendChild(contentEl)
        host.appendChild(scroller)

        const W = scroller.clientWidth
        const H = Math.max(1, Math.floor(scroller.clientHeight))
        const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap
        const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const contentWidth = isDualLayout ? Math.max(1, W - (hMargin * 2)) : W
        const colW = isDualLayout ? Math.max(1, Math.floor((contentWidth - gap) / 2)) : Math.max(1, Math.floor(contentWidth))

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
        const navigationGap = getEpubSpreadNavigationGap(measuredGap, isDualLayout, hMargin)
        const step = W + navigationGap
        const pages = step > 0 ? Math.max(1, Math.ceil((scroller.scrollWidth + navigationGap) / step)) : 1

        host.innerHTML = ''
        return pages
    }, [contentStyle.fontFamily, contentStyle.fontSize, contentStyle.fontWeight, effectiveColumnGap, epubTypographyCss, hMargin, isDualLayout, letterSpacing, lineHeight, pageHeight, pageWidth, useEmbeddedFonts, waitForMeasuredAssets])

    const measure = useCallback(() => {
        const scroller = scrollerRef.current; const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth; const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const contentWidth = isDualLayout ? Math.max(1, W - (hMargin * 2)) : W
        const colW = isDualLayout ? Math.max(1, Math.floor((contentWidth - gap) / 2)) : Math.max(1, Math.floor(contentWidth))
        const H = Math.max(1, Math.floor(scroller.clientHeight))
        contentEl.style.columnWidth = `${colW}px`; contentEl.style.columnCount = isDualLayout ? '2' : '1'
        contentEl.style.columnFill = 'auto'; contentEl.style.height = `${H}px`; contentEl.style.display = 'block'
        contentEl.style.textAlign = 'left'; contentEl.style.columnRule = isDualLayout ? '1px solid transparent' : 'none'
        const navigationGap = getEpubSpreadNavigationGap(gap, isDualLayout, hMargin)
        const step = W + navigationGap; if (step <= 0) return
        const oldStep = stepRef.current > 0 ? stepRef.current : step; const oldLeft = scroller.scrollLeft
        stepRef.current = step; setPageWidth(W); setPageHeight(H)
        const pages = Math.max(1, Math.ceil((scroller.scrollWidth + navigationGap) / step)); initialMeasureDoneRef.current = true; setChapterPaginationReady(true); setChapterTotalPages(pages)
        const pendingPage = getPendingPage()
        const requestedChapterPage = pendingChapterPageRef.current
        const requestedTextAnchor = pendingTextAnchorRef.current
        const anchorTargetsCurrentChapter = requestedTextAnchor
            && (!Number.isFinite(requestedTextAnchor.chapterIndex) || requestedTextAnchor.chapterIndex === chapter?.index)
        const anchoredPage = anchorTargetsCurrentChapter
            ? resolveEpubBookmarkPage(contentEl, scroller, requestedTextAnchor, step, pages)
            : null
        if (anchorTargetsCurrentChapter) pendingTextAnchorRef.current = null
        if (requestedChapterPage != null) pendingChapterPageRef.current = null
        const idxFromScroll = Number.isFinite(anchoredPage)
            ? anchoredPage
            : (requestedChapterPage === 'last'
                ? pages - 1
                : (Number.isFinite(requestedChapterPage) ? requestedChapterPage : (pendingPage ?? Math.round(oldLeft / oldStep))))
        const clamped = Math.max(0, Math.min(idxFromScroll, pages - 1))
        scroller.scrollTo({ left: Math.round(clamped * step), behavior: 'auto' })
        setChapterPage(prev => (prev === clamped ? prev : clamped))
    }, [chapter?.index, effectiveColumnGap, getPendingPage, hMargin, isDualLayout])

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
        const navigationGap = getEpubSpreadNavigationGap(gap, isDualLayout, hMargin)
        const step = W + navigationGap; if (step <= 0) return; stepRef.current = step
        lockPendingPage(target)
        s.scrollTo({ left: Math.round(target * step), behavior: 'auto' }); setChapterPage(target)
    }, [chapterTotalPages, hMargin, isDualLayout, lockPendingPage])

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

    useEffect(() => {
        const s = scrollerRef.current; const c = contentRef.current
        if (!s || !c) return
        const W = s.clientWidth; const cs = getComputedStyle(c)
        const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const navigationGap = getEpubSpreadNavigationGap(gap, isDualLayout, hMargin)
        const step = W + navigationGap
        if (step <= 0) return
        stepRef.current = step
        s.scrollTo({ left: Math.round(chapterPage * step), behavior: 'auto' })
    }, [chapterPage, effectiveColumnGap, hMargin, isDualLayout])

    useEffect(() => {
        const s = scrollerRef.current; const c = contentRef.current; if (!s || !c) return; let timer = null
        const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { const W = s.clientWidth; const cs = getComputedStyle(c); const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16; const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0); const navigationGap = getEpubSpreadNavigationGap(gap, isDualLayout, hMargin); const step = W + navigationGap; if (step <= 0) return; stepRef.current = step; const pendingPage = getPendingPage(); const idx = pendingPage ?? Math.round(s.scrollLeft / step); const snapLeft = Math.round(idx * step); if (Math.abs(s.scrollLeft - snapLeft) >= 1) s.scrollTo({ left: snapLeft, behavior: 'auto' }); const clamped = Math.max(0, Math.min(idx, chapterTotalPages - 1)); setChapterPage(prev => (prev === clamped ? prev : clamped)) }, 120) }
        s.addEventListener('scroll', onScroll, { passive: true }); return () => { if (timer) clearTimeout(timer); s.removeEventListener('scroll', onScroll) }
    }, [chapterTotalPages, effectiveColumnGap, getPendingPage, hMargin, isDualLayout])

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
    useKeyboardNav({ onNext: goNext, onPrev: goPrev, enabled: !searchOpen && !annotationsOpen && !bookmarksOpen && !initialProblem && !chapterProblem && !settings.settingsOpen, readerRootRef })
    useReaderCommandShortcuts({
        enabled: !loading && !!chapter && !searchOpen && !annotationsOpen && !bookmarksOpen && !initialProblem && !chapterProblem && !settings.settingsOpen,
        settingsShortcutEnabled: !searchOpen && !annotationsOpen && !bookmarksOpen,
        searchShortcutEnabled: !annotationsOpen && !bookmarksOpen && !initialProblem && !chapterProblem && !settings.settingsOpen,
        onBack: () => navigate('/'),
        onFirstPage: () => {
            if (chapterIndex === 0) goToPage(0)
            else void loadChapter(0, { page: 0 })
        },
        onLastPage: () => {
            const lastChapter = Math.max(0, totalChapters - 1)
            if (chapterIndex === lastChapter) goToPage(chapterTotalPages - 1)
            else void loadChapter(lastChapter, { page: 'last' })
        },
        onSearch: () => {
            setSearchOpen(true)
            setAnnotationsOpen(false)
            setBookmarksOpen(false)
            setActiveAnnotationId(null)
        },
        onAddBookmark: addBookmark,
        onToggleToc: () => setSidebarOpen((open) => !open),
        onToggleAnnotations: () => {
            setAnnotationsOpen(true)
            setSearchOpen(false)
            setBookmarksOpen(false)
        },
        onToggleLayout: () => setLayout(preferredLayout === 'dual' ? 'single' : 'dual'),
        onDecreaseScale: decFont,
        onIncreaseScale: incFont,
        onToggleSettings: settings.toggleSettings,
    })

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

    const goToInternalAnchor = useCallback((hash) => {
        if (!hash) return false
        const contentEl = contentRef.current
        const scroller = scrollerRef.current
        if (!contentEl || !scroller) return false
        const targetId = decodeURIComponent(hash.replace(/^#/, ''))
        if (!targetId) return false
        const escapedTargetId = escapeCssIdent(targetId)
        const target = contentEl.querySelector(`#${escapedTargetId}, [name="${escapedTargetId}"]`)
        if (!target) return false
        const step = stepRef.current || scroller.clientWidth || 1
        const targetPage = Math.max(0, Math.round((target.offsetLeft || 0) / step))
        goToPage(targetPage)
        return true
    }, [goToPage])

    const goToInternalHref = useCallback((href) => {
        if (!href) return false
        const rawHref = String(href).trim()
        if (!rawHref || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(rawHref)) return false

        const hashIndex = rawHref.indexOf('#')
        const hash = hashIndex >= 0 ? rawHref.slice(hashIndex) : ''
        if (rawHref.startsWith('#')) return goToInternalAnchor(hash)

        const target = toc.find((item) => hrefPathsMatch(item.href, rawHref))
        if (!target || !Number.isFinite(target.index)) return false
        loadChapter(target.index, { page: 0 })
        return true
    }, [goToInternalAnchor, toc])


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

    const handleEpubContentClick = useCallback((event) => {
        const contentEl = contentRef.current
        const target = event.target
        if (!contentEl || typeof target?.closest !== 'function') return

        const imgEl = target.closest('img')
        if (imgEl && contentEl.contains(imgEl)) {
            event.preventDefault()
            event.stopPropagation()
            openEpubImageInWindow(imgEl)
            return
        }

        const linkEl = target.closest('a[href]')
        if (!linkEl || !contentEl.contains(linkEl)) return
        // EPUB markup is untrusted. Never let a book navigate the WebView;
        // the explicit resolver below is the sole allowed link action.
        event.preventDefault()
        event.stopPropagation()
        goToInternalHref(linkEl.getAttribute('href'))
    }, [goToInternalHref, openEpubImageInWindow])

    const bindContentRef = useCallback((node) => {
        const previous = contentRef.current
        if (previous) previous.removeEventListener('click', handleEpubContentClick)
        contentRef.current = node
        if (node) {
            applyEpubOwnedLayoutStyles(node, {
                columnGap: effectiveColumnGap,
                horizontalMargin: hMargin,
                isDualLayout,
            })
            node.addEventListener('click', handleEpubContentClick)
        }
    }, [effectiveColumnGap, hMargin, handleEpubContentClick, isDualLayout])

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

    const formatSearchResultLocation = useCallback((result) => {
        const matchLabel = tt('searchResultMatch').replace('{index}', (Number.isFinite(result?.chapter_match_index) ? result.chapter_match_index : 0) + 1)
        if (result?.chapter_title) return `${result.chapter_title} · ${matchLabel}`
        if (Number.isFinite(result?.chapter_index)) {
            const chapterLabel = tt('searchResultChapter').replace('{chapter}', result.chapter_index + 1)
            return `${chapterLabel} · ${matchLabel}`
        }
        return matchLabel
    }, [tt])

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
                    locator_v2: {
                        version: 2,
                        kind: 'epub',
                        chapterHref: toc.find((item) => item.index === chapterIndex)?.href || null,
                        chapterIndex,
                        chapterPage,
                        fallbackPage: chapterPage,
                        textOffset: selectionSnapshot.startOffset,
                        textEndOffset: selectionSnapshot.endOffset,
                        offsetUnit: 'utf16-code-unit-v1',
                        quote: { exact: selectionSnapshot.selectedText, prefix: '', suffix: '', position: 0 },
                    },
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
            setBookmarksOpen(false)
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
    }, [chapter?.title, chapterIndex, chapterPage, id, selectionSnapshot, toc, tt])

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

        const locator = annotation.locator_v2
        const hrefChapterIndex = locator?.chapterHref
            ? toc.find((item) => item.href === locator.chapterHref)?.index
            : null
        const targetChapter = hrefChapterIndex ?? locator?.chapterIndex ?? annotation.chapter_index
        const targetPage = locator?.chapterPage ?? locator?.fallbackPage ?? annotation.page ?? 0
        if (targetChapter != null && targetChapter !== chapterIndex) {
            loadChapter(targetChapter, { page: Number.isFinite(targetPage) ? targetPage : 0 })
            return
        }

        if (Number.isFinite(targetPage)) {
            goToPage(targetPage)
        }
    }, [chapterIndex, goToPage, toc])

    const handleBookmarkActivate = (bookmark) => {
        const targetChapter = toc.find((item) => item.href && item.href === bookmark.locator?.chapterHref)?.index
            ?? bookmark.locator?.chapterIndex
            ?? bookmark.position
        const fallbackPage = bookmark.locator?.chapterPage ?? bookmark.locator?.fallbackPage ?? 0
        const anchoredPage = targetChapter === chapterIndex
            ? resolveEpubBookmarkPage(
                contentRef.current,
                scrollerRef.current,
                bookmark.locator,
                stepRef.current,
                chapterTotalPages,
            )
            : null
        goToBookmark({ ...bookmark, position: targetChapter })
        if (targetChapter === chapterIndex && chapter?.index === targetChapter) {
            goToPage(Number.isFinite(anchoredPage) ? anchoredPage : fallbackPage)
            return
        }
        void loadChapter(targetChapter, {
            page: fallbackPage,
            textAnchor: bookmark.locator,
        })
    }

    const canAddBookmark = !loading && !initialProblem && !chapterProblem && !!chapter && chapterPaginationReady
    const currentBookmarkPosition = {
        position: chapterIndex,
        label: overallPagination.ready
            ? `${tt('page')} ${overallPagination.currentPage}`
            : `${tt('chapter')} ${chapterIndex + 1} · ${tt('page')} ${chapterPage + 1}`,
        locator: {
            kind: 'epub',
            chapterHref: toc.find((item) => item.index === chapterIndex)?.href || null,
            chapterIndex,
            chapterPage,
            fallbackPage: chapterPage,
        },
    }
    const preserveCurrentBookmarkAnchor = () => {
        const anchor = captureEpubBookmarkAnchor(
            contentRef.current,
            scrollerRef.current,
            chapterPage,
            stepRef.current,
            selectionSnapshot,
        )
        if (anchor) pendingTextAnchorRef.current = { ...anchor, chapterIndex }
    }
    const closeBookmarksPanel = () => {
        if (bookmarksOpen) preserveCurrentBookmarkAnchor()
        setBookmarksOpen(false)
    }
    const toggleBookmarksPanel = () => {
        preserveCurrentBookmarkAnchor()
        setBookmarksOpen((open) => !open)
        setSearchOpen(false)
        setAnnotationsOpen(false)
        setActiveAnnotationId(null)
    }

    return (
        <ReaderShell
            rootRef={readerRootRef}
            topBar={(
                <ReaderTopBar
                    themeStyle={themeStyle}
                    backLabel={tt('backToLibrary')}
                    onBack={() => navigate('/')}
                    meta={(
                        <>
                            <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>EPUB</span>
                            <span className="text-sm opacity-60 truncate max-w-[18rem]" style={{ color: themeStyle.text }}>{bookTitle}</span>
                        </>
                    )}
                    actions={(
                        <>
                            <button type="button" onClick={() => { setSearchOpen((open) => !open); setAnnotationsOpen(false); closeBookmarksPanel(); setActiveAnnotationId(null) }} title={tt('search')} aria-keyshortcuts={settings.keyboardShortcutsEnabled ? 'Control+F' : undefined} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: searchOpen ? '#5c7cfa' : themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></svg></button>
                            <button type="button" onClick={() => { setAnnotationsOpen((open) => !open); setSearchOpen(false); closeBookmarksPanel() }} title={tt('annotations')} aria-keyshortcuts={settings.keyboardShortcutsEnabled ? 'M' : undefined} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: annotationsOpen ? '#ff922b' : themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg></button>
                            <ReaderBookmarkToggle
                                open={bookmarksOpen}
                                onToggle={toggleBookmarksPanel}
                                themeStyle={bookmarkThemeStyle}
                                tt={tt}
                                lang={lang}
                            />
                            <button type="button" onClick={() => setSidebarOpen(o => !o)} title={tt('toc')} aria-keyshortcuts={settings.keyboardShortcutsEnabled ? 'T' : undefined} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg></button>
                            <ReaderToolbar settings={settings} readerType="epub" />
                        </>
                    )}
                />
            )}
            notice={(
                <ReaderNoticeBar
                    themeStyle={themeStyle}
                    message={tt('limitedFormatSupport')}
                    issues={formatDiagnostics}
                />
            )}
            bookmarkBar={bookmarksOpen ? (
                <ReaderBookmarkNavigator
                    items={bookmarks}
                    currentPosition={currentBookmarkPosition}
                    themeStyle={bookmarkThemeStyle}
                    onActivate={handleBookmarkActivate}
                    tt={tt}
                    lang={lang}
                />
            ) : null}
            sidePanel={bookmarksOpen ? (
                <ReaderBookmarksPanel
                    open
                    items={bookmarks}
                    currentPosition={currentBookmarkPosition}
                    themeStyle={bookmarkThemeStyle}
                    onClose={closeBookmarksPanel}
                    onAdd={canAddBookmark ? () => addBookmark() : undefined}
                    onActivate={handleBookmarkActivate}
                    onRemove={removeBookmark}
                    onUpdate={updateBookmark}
                    tt={tt}
                    lang={lang}
                />
            ) : null}
            main={(
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
                    <ReaderBookmarkFab
                        onAdd={() => addBookmark()}
                        themeStyle={bookmarkThemeStyle}
                        tt={tt}
                        lang={lang}
                        disabled={!canAddBookmark}
                    />
                    <ReaderSearchPanel open={searchOpen} themeStyle={themeStyle} query={searchDraft} submittedQuery={searchQuery} loading={searchLoading} results={searchResults} meta={searchMeta} error={searchError} activeIndex={activeSearchIndex} onQueryChange={handleSearchQueryChange} onSubmit={handleSearchSubmit} onCancel={handleSearchCancel} onClose={() => setSearchOpen(false)} onResultClick={handleSearchResultClick} formatResultLocation={formatSearchResultLocation} tt={tt} />
                    <ReaderAnnotationsPanel bookId={id} open={annotationsOpen} themeStyle={themeStyle} loading={annotationsLoading} annotations={annotations} activeAnnotationId={activeAnnotationId} onClose={() => setAnnotationsOpen(false)} onItemClick={handleAnnotationClick} onDeleteItem={handleDeleteAnnotation} onEditItem={handleEditAnnotation} onColorItem={handleCycleAnnotationColor} tt={tt} lang={lang} />
                    <ReaderSelectionMenu selection={selectionSnapshot} themeStyle={themeStyle} onHighlight={() => createAnnotation('highlight')} onNote={() => createAnnotation('note')} onClear={() => { setSelectionSnapshot(null); clearCurrentSelection() }} tt={tt} />
                    {epubTypographyCss && <style>{epubTypographyCss}</style>}
                    <ReaderPageTurnControls
                        themeStyle={themeStyle}
                        showPrev={chapterPage > 0 || chapterIndex > 0}
                        showNext={chapterPage < chapterTotalPages - 1 || Boolean(chapter && chapterIndex < chapter.total - 1)}
                        onPrev={goPrev}
                        onNext={goNext}
                        previousLabel={tt('previous')}
                        nextLabel={tt('next')}
                    />

                    <div data-testid="epub-reader-stage" ref={frameRef} aria-busy={loading} className={`reader-stage ${layout === 'dual' ? 'reader-stage-dual' : ''}`} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${isDualLayout ? 0 : hMargin}px`, boxSizing: 'border-box' }}>
                        {loading ? (
                            <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div className="text-sm opacity-60">{tt('loading')}</div></div>
                        ) : initialProblem ? (
                            <div className="flex h-full items-center justify-center">
                                <ReaderLoadProblem
                                    problem={initialProblem}
                                    title={tt('bookLoadFailed')}
                                    themeStyle={themeStyle}
                                    tt={tt}
                                    onRetry={() => setInitialLoadAttempt((value) => value + 1)}
                                    onBack={() => navigate('/')}
                                    forceRetry
                                />
                            </div>
                        ) : chapter ? (
                            <div key={chapter?.index ?? 0} ref={scrollerRef} className="reader-scroller" style={{ position: 'relative', width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'none', scrollbarGutter: 'stable' }}>
                                <div ref={bindContentRef} className={EPUB_CONTENT_CLASS_NAME}
                                    style={{ height: '100%', boxSizing: 'border-box', display: 'block', padding: isDualLayout ? `0 ${hMargin}px` : 0, backgroundColor: 'var(--reader-page-bg)', color: 'var(--reader-page-fg)', fontFamily: useEmbeddedFonts ? undefined : contentStyle.fontFamily, fontWeight: contentStyle.fontWeight, fontSize: contentStyle.fontSize, lineHeight: `${lineHeight}`, letterSpacing: `${letterSpacing}em`, textAlign: 'left', hyphens: 'auto', WebkitHyphens: 'auto', wordBreak: 'break-word', overflowWrap: 'break-word', columnCount: isDualLayout ? 2 : 1, columnGap: `${effectiveColumnGap}px`, columnFill: 'auto', columnRule: isDualLayout ? '1px solid transparent' : 'none', breakInside: 'avoid-column' }}
                                    dangerouslySetInnerHTML={{ __html: sanitizedChapterHtml }}
                                />
                            </div>
                        ) : null}
                        {!loading && chapterProblem && chapter && (
                            <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'var(--reader-page-bg)' }}>
                                <ReaderLoadProblem
                                    problem={chapterProblem}
                                    title={tt('chapterLoadFailed')}
                                    themeStyle={themeStyle}
                                    tt={tt}
                                    onRetry={() => {
                                        const retry = chapterRetryRef.current
                                        if (retry) void loadChapter(retry.index, retry.options)
                                    }}
                                    onBack={() => navigate('/')}
                                    forceRetry
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
            )}
            bottom={(
                <div className="reader-ui">
                    {chapter && (<ReaderProgressBar currentPage={overallPagination.currentPage} totalPages={overallPagination.totalPages} onSeekPage={overallPagination.ready ? (p) => goToOverallPage(p - 1) : undefined} progress={overallPagination.totalPages > 1 ? (overallPagination.currentPage - 1) / (overallPagination.totalPages - 1) : 0} onSeekProgress={overallPagination.ready ? seekToOverallProgress : undefined} extraInfo={`${tt('chapter')} ${chapterIndex + 1}/${chapter?.total || totalChapters}`} readerFocusRef={readerRootRef} />)}
                    <ResumeToast
                        message={restoredProgress ? tt('resumedFromLastPosition') : null}
                        actionLabel={tt('startOver')}
                        onAction={handleStartOver}
                        durationMs={5000}
                    />
                </div>
            )}
            tail={(
                <div ref={measureHostRef} aria-hidden="true" style={{ position: 'fixed', left: '-100000px', top: '0', width: '1px', height: '1px', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }} />
            )}
        />
    )
}

export default EpubReader















