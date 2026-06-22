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
import {
    findDisplayRangeForSourceLocator,
    findNearestDisplayFragmentForSourceOffset,
    recoverSourceRangeFromDisplaySelection,
} from '../lib/txtDisplayMapper'
import { buildMeasuredPages } from '../lib/txtMeasuredPagination'
import { createTxtMeasuredPaginationOptions, getTxtViewportMetrics, measureAverageCharacterWidth } from '../lib/txtPageMetrics'
import { createTxtTransformOptions, toTxtTransformQuery } from '../lib/txtTransformOptions'
import { clearSegmentMarks, highlightSegmentMatch, resolveSegmentTarget } from '../lib/txtSegmentDom'
import { clampViewportPage, getPagesPerView } from '../lib/txtPagination'
import {
    findRenderPageForLocator,
    getPageIndexForLocator,
    getRenderPageStartSegment,
    getRenderPageStartSegments,
    getSegmentIdForLocator,
    getVisibleRenderPages,
} from '../lib/txtRenderPages'

const API = API_BOOKS_BASE
const API_ROOT = API.replace(/\/books$/, '')
const DEFAULT_TXT_RENDER_PAGE_SIZE = 24
const TXT_PAGE_PADDING_PX = 20
const TXT_PAGE_VERTICAL_SAFETY_PX = 2
const TXT_PARAGRAPH_GAP = '0.65em'
const TXT_PARAGRAPH_GAP_LINES = 1
const TXT_BOTTOM_WHITESPACE_RECLAIM_LINES = 0
const TXT_MIN_LINES_PER_PAGE = 2
const TXT_MIN_TRAILING_SLICE_LINES = 2

function getMeasuredSliceLength(slice) {
    if (typeof slice?.displayText === 'string') return slice.displayText.length
    if (typeof slice?.display_text === 'string') return slice.display_text.length
    if (typeof slice?.text === 'string') return slice.text.length
    return 0
}

function getMeasuredPageStartFragmentIndex(page) {
    if (Number.isFinite(page?.startFragmentIndex)) return page.startFragmentIndex
    const firstSlice = Array.isArray(page?.slices) ? page.slices[0] : page?.segments?.[0]
    return Number.isFinite(firstSlice?.fragmentIndex) ? firstSlice.fragmentIndex : null
}

function measuredPageContainsSegment(page, segmentId) {
    if (!Number.isFinite(segmentId)) return false
    const entries = Array.isArray(page?.segments) ? page.segments : []
    return entries.some((entry) => entry?.segmentId === segmentId)
}

function isContinuationRenderSegment(previous, next) {
    return Boolean(
        previous
        && next
        && previous.segmentId === next.segmentId
        && Number.isFinite(previous.sliceEnd)
        && Number.isFinite(next.sliceStart)
        && previous.sliceEnd === next.sliceStart,
    )
}

function buildMeasuredRenderPages(fragments, viewportMetrics = null) {
    try {
        const measuredOptions = createTxtMeasuredPaginationOptions(viewportMetrics)
        const paginationOptions = measuredOptions ?? {
            pageHeight: DEFAULT_TXT_RENDER_PAGE_SIZE,
            measureSliceHeight: getMeasuredSliceLength,
            measurePageHeight: (pageSlices) => pageSlices.reduce((total, slice) => total + getMeasuredSliceLength(slice), 0),
        }
        return buildMeasuredPages(Array.isArray(fragments) ? fragments : [], paginationOptions).map((page) => ({
            ...page,
            startFragmentIndex: getMeasuredPageStartFragmentIndex(page),
        }))
    } catch (err) {
        console.error('Failed to build measured TXT pages, falling back to render pages', err)
        return []
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

function getLocatorSegmentOffset(locator) {
    if (Number.isFinite(locator?.offset)) return locator.offset
    if (Number.isFinite(locator?.segment_local_start)) return locator.segment_local_start

    if (typeof locator === 'string') {
        const segmentMatch = locator.match(/^segment:\d+:offset:(\d+)$/)
        if (segmentMatch) return Number(segmentMatch[1])
    }

    if (locator && typeof locator === 'object' && typeof locator.locator === 'string') {
        return getLocatorSegmentOffset(locator.locator)
    }

    return null
}

function getFragmentSourceStart(fragment) {
    return fragment?.source_start_offset ?? fragment?.start_offset ?? fragment?.startOffset ?? null
}

function getFragmentDisplayLength(fragment) {
    if (typeof fragment?.display_text === 'string') return fragment.display_text.length
    if (typeof fragment?.displayText === 'string') return fragment.displayText.length
    if (typeof fragment?.text === 'string') return fragment.text.length
    return 0
}

function findClosestFragmentElement(node) {
    if (node instanceof Element) return node.closest('[data-fragment-index]')
    return node?.parentElement?.closest?.('[data-fragment-index]') ?? null
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
    const [globalRenderPages, setGlobalRenderPages] = useState(null)
    const [currentViewportStartSegment, setCurrentViewportStartSegment] = useState(null)
    const [currentViewportStartFragmentIndex, setCurrentViewportStartFragmentIndex] = useState(null)
    const [viewportMetrics, setViewportMetrics] = useState(null)

    const readerRootRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const pendingAnchorRestoreCleanupRef = useRef(null)
    const globalRenderPageMapPromiseRef = useRef(null)
    const globalRenderPageMapVersionRef = useRef(0)
    const navigationRequestIdRef = useRef(0)
    const requestedViewportPageRef = useRef(0)
    const isPointerSelectingRef = useRef(false)
    const { captureAnchor, restoreAnchor, clearAnchor } = useReaderViewportAnchor()
    const transformOptions = useMemo(() => createTxtTransformOptions({
        trimSpaces: compactWhitespace,
        removeEmptyLines: compactWhitespace,
        splitParagraphs,
    }), [compactWhitespace, splitParagraphs])
    const transformQuery = useMemo(() => toTxtTransformQuery(transformOptions), [transformOptions])
    const {
        manifest,
        visibleStart,
        visibleSegments,
        visibleDisplayFragments,
        setVisibleStart,
        loadWindow,
        showWindowForSegment,
        windowSize,
        loading,
        error,
    } = useTxtSegmentWindow(id, transformOptions)
    const visibleWindowStartsAtZero = visibleStart === 0
    const hasActiveTransforms = transformOptions.trimSpaces || transformOptions.removeEmptyLines || transformOptions.splitParagraphs
    const hasGlobalRenderPageMap = Array.isArray(globalRenderPages) && globalRenderPages.length > 0
    const pagesPerView = getPagesPerView(layout)

    const indexedDisplayFragments = useMemo(
        () => visibleDisplayFragments.map((fragment, fragmentIndex) => ({
            ...fragment,
            fragmentIndex: visibleStart + fragmentIndex,
        })),
        [visibleDisplayFragments, visibleStart],
    )

    const renderPages = useMemo(
        () => buildMeasuredRenderPages(indexedDisplayFragments, viewportMetrics),
        [indexedDisplayFragments, viewportMetrics],
    )

    const localRenderPageStartSegments = useMemo(
        () => getRenderPageStartSegments(renderPages),
        [renderPages],
    )

    const globalRenderPageStartSegments = useMemo(
        () => getRenderPageStartSegments(globalRenderPages),
        [globalRenderPages],
    )

    const loadGlobalRenderPages = useCallback(async () => {
        if (Array.isArray(globalRenderPages)) return globalRenderPages
        if (!manifest?.segment_count) return []
        if (globalRenderPageMapPromiseRef.current) return globalRenderPageMapPromiseRef.current

        const mapVersion = globalRenderPageMapVersionRef.current
        const isStaleLoad = () => globalRenderPageMapVersionRef.current !== mapVersion
        const resolveRenderPages = (pages) => {
            if (isStaleLoad()) return null
            setGlobalRenderPages(pages)
            return pages
        }

        let promise = null
        promise = (async () => {
            if (visibleSegments.length >= manifest.segment_count) {
                return resolveRenderPages(renderPages)
            }

            const segments = []
            for (let start = 0; start < manifest.segment_count; start += windowSize) {
                if (isStaleLoad()) return null
                let windowDisplayFragments = null
                if (start === 0 && visibleDisplayFragments.length > 0 && visibleWindowStartsAtZero) {
                    windowDisplayFragments = visibleDisplayFragments.map((fragment, fragmentIndex) => ({
                        ...fragment,
                        fragmentIndex: start + fragmentIndex,
                    }))
                } else {
                    const windowData = await loadWindow(start)
                    if (!windowData) return null
                    windowDisplayFragments = windowData.displayFragments.map((fragment, fragmentIndex) => ({
                        ...fragment,
                        fragmentIndex: start + fragmentIndex,
                    }))
                }
                if (isStaleLoad()) return null
                segments.push(...windowDisplayFragments)
            }

            return resolveRenderPages(buildMeasuredRenderPages(segments, viewportMetrics))
        })().catch((err) => {
            if (globalRenderPageMapPromiseRef.current === promise) {
                globalRenderPageMapPromiseRef.current = null
            }
            throw err
        })

        globalRenderPageMapPromiseRef.current = promise
        return promise
    }, [
        globalRenderPages,
        manifest?.segment_count,
        loadWindow,
        renderPages,
        visibleDisplayFragments,
        visibleSegments,
        visibleWindowStartsAtZero,
        viewportMetrics,
        windowSize,
    ])

    const totalViewportPages = Math.max(
        1,
        hasGlobalRenderPageMap
            ? globalRenderPageStartSegments.length
            : localRenderPageStartSegments.length,
    )
    const progress = useReadingProgress(id, { totalPages: totalViewportPages, type: 'txt', legacyId })
    const {
        currentPosition: currentViewportPage,
        setCurrentPosition: setCurrentViewportPage,
        bookmarks,
        addBookmark,
        removeBookmark,
        resumePrompt,
        dismissResume,
    } = progress
    const currentRenderPageIndex = useMemo(() => {
        if (currentViewportStartSegment == null) {
            return clampViewportPage(currentViewportPage, renderPages.length || 1)
        }

        const resolvedStartSegment = getRenderPageStartSegment(renderPages, { page: currentViewportPage }, currentViewportStartSegment)
        if (resolvedStartSegment === currentViewportStartSegment) {
            return currentViewportPage
        }

        return findRenderPageForLocator(renderPages, currentViewportStartSegment)
    }, [currentViewportPage, currentViewportStartSegment, renderPages])

    const effectiveViewportPage = Number.isFinite(currentViewportPage)
        ? currentViewportPage
        : currentRenderPageIndex

    useEffect(() => {
        requestedViewportPageRef.current = effectiveViewportPage
    }, [effectiveViewportPage])

    const visibleRenderPages = useMemo(
        () => getVisibleRenderPages(renderPages, layout, currentRenderPageIndex),
        [currentRenderPageIndex, layout, renderPages],
    )

    const visibleSegmentIds = useMemo(() => {
        const ids = new Set()
        visibleRenderPages.forEach((page) => {
            page.segmentIds.forEach((segmentId) => ids.add(segmentId))
        })
        return ids
    }, [visibleRenderPages])

    const getSegmentStartOffset = useCallback((segments, segmentId) => {
        if (!Array.isArray(segments) || !Number.isFinite(segmentId)) return null
        const segment = segments.find((item) => (
            (item?.segment_id ?? item?.segmentId) === segmentId
        ))
        const startOffset = segment?.start_offset ?? segment?.startOffset
        return Number.isFinite(startOffset) ? startOffset : null
    }, [])

    const currentPageAnnotations = useMemo(
        () => annotations.filter((annotation) => {
            if (annotation.page == null && annotation.segment_id == null && !annotation.locator) return true

            const segmentId = Number.isFinite(annotation.segment_id) ? annotation.segment_id : getSegmentIdForLocator(annotation)
            if (Number.isFinite(segmentId)) return visibleSegmentIds.has(segmentId)

            const pageIndex = getPageIndexForLocator(annotation)
            if (!Number.isFinite(pageIndex)) return false
            return pageIndex >= effectiveViewportPage && pageIndex < effectiveViewportPage + pagesPerView
        }),
        [annotations, effectiveViewportPage, pagesPerView, visibleSegmentIds],
    )

    const buildMappedDisplayTargets = useCallback((fragments, segmentId, sourceStart, sourceEndInclusive, fallbackSourceOffset = sourceStart) => {
        if (!Array.isArray(fragments) || !Number.isFinite(segmentId)) return []

        const mappedRange = Number.isFinite(sourceStart)
            ? findDisplayRangeForSourceLocator(fragments, segmentId, sourceStart, sourceEndInclusive)
            : null
        const startFragmentIndex = mappedRange?.startFragmentIndex
        const endFragmentIndex = mappedRange?.endFragmentIndex
        const singleFragmentIndex = mappedRange?.fragmentIndex
        const fragmentIndex = mappedRange?.fragmentIndex
            ?? startFragmentIndex
            ?? findNearestDisplayFragmentForSourceOffset(
            fragments,
            segmentId,
            Number.isFinite(fallbackSourceOffset) ? fallbackSourceOffset : sourceStart,
        )

        if (!Number.isFinite(fragmentIndex)) return []

        const targetFragmentIndexes = Number.isFinite(startFragmentIndex) && Number.isFinite(endFragmentIndex)
            ? Array.from({ length: endFragmentIndex - startFragmentIndex + 1 }, (_, offset) => startFragmentIndex + offset)
            : [fragmentIndex]

        const targets = targetFragmentIndexes
            .map((candidateIndex) => {
                const fragment = fragments[candidateIndex]
                const fragmentSourceStart = getFragmentSourceStart(fragment)
                if (!Number.isFinite(fragmentSourceStart)) return null

                const fragmentLength = getFragmentDisplayLength(fragment)
                if (fragmentLength <= 0) return null

                const displayStart = candidateIndex === singleFragmentIndex
                    ? (mappedRange?.displayStart ?? 0)
                    : (candidateIndex === startFragmentIndex ? (mappedRange?.displayStart ?? 0) : 0)
                const displayEnd = candidateIndex === singleFragmentIndex
                    ? (mappedRange?.displayEnd ?? Math.max(displayStart, fragmentLength - 1))
                    : (candidateIndex === endFragmentIndex
                        ? (mappedRange?.displayEnd ?? Math.max(displayStart, fragmentLength - 1))
                    : Math.max(displayStart, fragmentLength - 1)
                    )

                if (displayEnd < displayStart) return null

                return {
                    fragmentIndex: candidateIndex,
                    segmentId,
                    sourceStart: fragmentSourceStart + displayStart,
                    sourceEnd: fragmentSourceStart + displayEnd + 1,
                    segmentLocalStart: displayStart,
                    segmentLocalEnd: displayEnd + 1,
                }
            })
            .filter(Boolean)

        if (targets.length > 0) return targets

        return [{
            fragmentIndex,
            segmentId,
            sourceStart,
            sourceEnd: Number.isFinite(sourceEndInclusive) ? sourceEndInclusive + 1 : sourceStart,
            segmentLocalStart: 0,
            segmentLocalEnd: 0,
        }]
    }, [])

    const buildMappedDisplayTarget = useCallback((fragments, segmentId, sourceStart, sourceEndInclusive, fallbackSourceOffset = sourceStart) => {
        const targets = buildMappedDisplayTargets(
            fragments,
            segmentId,
            sourceStart,
            sourceEndInclusive,
            fallbackSourceOffset,
        )
        return targets[0] ?? null
    }, [buildMappedDisplayTargets])

    const getDisplaySelectionBoundary = useCallback((range, boundary) => {
        if (!range) return null

        const container = boundary === 'start' ? range.startContainer : range.endContainer
        const offset = boundary === 'start' ? range.startOffset : range.endOffset
        const fragmentElement = findClosestFragmentElement(container)
        const fragmentIndex = Number(fragmentElement?.dataset.fragmentIndex)
        if (!Number.isFinite(fragmentIndex) || !fragmentElement) return null

        const measurementRange = range.cloneRange()
        measurementRange.selectNodeContents(fragmentElement)
        measurementRange.setEnd(container, offset)

        return {
            fragmentIndex,
            displayOffset: measurementRange.toString().length,
            segmentId: Number(fragmentElement.dataset.segmentId),
        }
    }, [])

    const mappedCurrentPageAnnotations = useMemo(() => currentPageAnnotations.flatMap((annotation) => {
        if (!Number.isFinite(annotation?.segment_id)) return annotation

        const segmentStartOffset = getSegmentStartOffset(visibleSegments, annotation.segment_id)
        const sourceStart = Number.isFinite(annotation.start_offset)
            ? annotation.start_offset
            : (Number.isFinite(segmentStartOffset) && Number.isFinite(annotation.segment_local_start)
                ? segmentStartOffset + annotation.segment_local_start
                : null)
        const sourceEndExclusive = Number.isFinite(annotation.end_offset)
            ? annotation.end_offset
            : (Number.isFinite(segmentStartOffset) && Number.isFinite(annotation.segment_local_end)
                ? segmentStartOffset + annotation.segment_local_end
                : null)

        const mappedTargets = buildMappedDisplayTargets(
            indexedDisplayFragments,
            annotation.segment_id,
            sourceStart,
            Number.isFinite(sourceEndExclusive) ? sourceEndExclusive - 1 : null,
            Number.isFinite(sourceStart) ? sourceStart : sourceEndExclusive,
        )

        if (!Array.isArray(mappedTargets) || mappedTargets.length === 0) return annotation

        return mappedTargets.map((mappedTarget) => ({
            ...annotation,
            start_offset: mappedTarget.sourceStart,
            end_offset: mappedTarget.sourceEnd,
            segment_local_start: mappedTarget.segmentLocalStart,
            segment_local_end: mappedTarget.segmentLocalEnd,
        }))
    }), [buildMappedDisplayTargets, currentPageAnnotations, getSegmentStartOffset, indexedDisplayFragments, visibleSegments])

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
        globalRenderPageMapVersionRef.current += 1
        navigationRequestIdRef.current += 1
        setGlobalRenderPages(null)
        setCurrentViewportStartSegment(null)
        setCurrentViewportStartFragmentIndex(null)
        globalRenderPageMapPromiseRef.current = null
        requestedViewportPageRef.current = 0
    }, [id, transformOptions])

    useEffect(() => {
        setPendingSearchTarget(null)
        setActiveSearchIndex(null)
    }, [transformOptions])

    useEffect(() => {
        globalRenderPageMapVersionRef.current += 1
        setGlobalRenderPages(null)
        globalRenderPageMapPromiseRef.current = null
    }, [viewportMetrics?.charsPerLine, viewportMetrics?.linesPerPage])

    useEffect(() => {
        if (loading) return undefined

        const updateViewportMetrics = () => {
            const scroller = scrollerRef.current
            if (!scroller) return

            const viewportWidth = scroller.clientWidth
            const viewportHeight = scroller.clientHeight
            if (!viewportWidth || !viewportHeight) return

            const fontSizePx = parseFloat(contentStyle.fontSize) || 18
            const averageCharWidthPx = measureAverageCharacterWidth({
                fontFamily: contentStyle.fontFamily,
                fontWeight: contentStyle.fontWeight,
                fontSizePx,
            })
            const nextMetrics = getTxtViewportMetrics({
                viewportWidth,
                viewportHeight,
                pagesPerView,
                columnGap,
                fontSizePx,
                lineHeight,
                pageHorizontalPaddingPx: TXT_PAGE_PADDING_PX,
                pageVerticalPaddingPx: TXT_PAGE_PADDING_PX + TXT_PAGE_VERTICAL_SAFETY_PX,
                paragraphGapLines: TXT_PARAGRAPH_GAP_LINES,
                linesPerPageAdjustment: TXT_BOTTOM_WHITESPACE_RECLAIM_LINES,
                minLinesPerPage: TXT_MIN_LINES_PER_PAGE,
                minTrailingSliceLines: TXT_MIN_TRAILING_SLICE_LINES,
                averageCharWidthPx,
            })
            setViewportMetrics((previous) => (
                previous?.charsPerLine === nextMetrics.charsPerLine
                && previous?.linesPerPage === nextMetrics.linesPerPage
                    ? previous
                    : nextMetrics
            ))
        }

        updateViewportMetrics()

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateViewportMetrics)
            return () => window.removeEventListener('resize', updateViewportMetrics)
        }

        const observer = new ResizeObserver(() => updateViewportMetrics())
        if (scrollerRef.current) observer.observe(scrollerRef.current)
        return () => observer.disconnect()
    }, [
        columnGap,
        contentStyle.fontFamily,
        contentStyle.fontSize,
        contentStyle.fontWeight,
        hMargin,
        layout,
        lineHeight,
        loading,
        pagesPerView,
        vMargin,
    ])

    useEffect(() => {
        if (loading || error || !Number.isFinite(currentViewportPage)) return
        if (Number.isFinite(currentViewportStartFragmentIndex)) {
            const visibleEnd = visibleStart + visibleDisplayFragments.length
            if (currentViewportStartFragmentIndex >= visibleStart && currentViewportStartFragmentIndex < visibleEnd) return
            loadWindow(currentViewportStartFragmentIndex).then((windowData) => {
                if (!windowData) return
                setVisibleStart(currentViewportStartFragmentIndex)
            }).catch((err) => {
                console.error('Failed to show TXT fragment window', err)
            })
            return
        }
        const currentViewportSegmentId = getSegmentIdForLocator(currentViewportStartSegment)
        if (!Number.isFinite(currentViewportSegmentId)) return
        if (visibleSegments.some((segment) => segment.segment_id === currentViewportSegmentId)) return
        showWindowForSegment(currentViewportSegmentId).catch((err) => {
            console.error('Failed to show TXT segment window', err)
        })
    }, [
        currentViewportPage,
        currentViewportStartFragmentIndex,
        currentViewportStartSegment,
        error,
        loadWindow,
        loading,
        setVisibleStart,
        showWindowForSegment,
        visibleDisplayFragments.length,
        visibleSegments,
        visibleStart,
    ])

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
                const res = await fetch(`${API}/${id}/search?q=${encodeURIComponent(trimmedQuery)}&${transformQuery}`)
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
    }, [id, searchOpen, searchQuery, searchRequestId, transformQuery])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading) return

        const handlePointerDown = () => {
            isPointerSelectingRef.current = true
        }

        const handlePointerUp = () => {
            if (!isPointerSelectingRef.current) return
            isPointerSelectingRef.current = false
            setSelectionSnapshot(getSelectionSnapshot(root))
        }

        const handleSelectionChange = () => {
            if (isPointerSelectingRef.current) return
            const nextSelection = getSelectionSnapshot(root)
            setSelectionSnapshot(nextSelection)
        }

        root.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('pointerup', handlePointerUp)
        document.addEventListener('selectionchange', handleSelectionChange)
        return () => {
            root.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('pointerup', handlePointerUp)
            document.removeEventListener('selectionchange', handleSelectionChange)
        }
    }, [loading, visibleSegments])

    useEffect(() => {
        setSelectionSnapshot(null)
        clearCurrentSelection()
    }, [currentViewportPage, searchOpen, annotationsOpen, visibleSegments])

    useEffect(() => {
        const root = contentRef.current
        if (!root || loading) return

        clearSearchHighlights(root)
        clearSegmentMarks(root)
        clearAnnotationHighlights(root)

        if (pendingSearchTarget) {
            const target = resolveSegmentTarget(root, pendingSearchTarget)
            if (target?.element) {
                const mark = highlightSegmentMatch(target.element, target.localStart, target.localEnd)
                mark?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            return
        }

        highlightAnnotationsInElement(root, mappedCurrentPageAnnotations)
    }, [loading, mappedCurrentPageAnnotations, pendingSearchTarget, visibleSegments])

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

    const goToViewportPage = useCallback(async (targetLocator) => {
        const requestId = navigationRequestIdRef.current + 1
        navigationRequestIdRef.current = requestId
        const isStaleRequest = () => navigationRequestIdRef.current !== requestId
        const explicitPageIndex = getPageIndexForLocator(targetLocator)

        if (Number.isFinite(explicitPageIndex)) {
            try {
                const canResolveFromLocalPages = !hasGlobalRenderPageMap
                    && explicitPageIndex >= 0
                    && explicitPageIndex < localRenderPageStartSegments.length
                    && renderPages.length > 0
                const targetPages = canResolveFromLocalPages
                    ? renderPages
                    : await loadGlobalRenderPages()
                const startSegments = getRenderPageStartSegments(targetPages)
                if (!Array.isArray(startSegments) || startSegments.length === 0) return
                const targetPageIndex = clampViewportPage(
                    explicitPageIndex,
                    Math.max(1, startSegments.length || localRenderPageStartSegments.length),
                )
                requestedViewportPageRef.current = targetPageIndex
                const startMarker = startSegments[targetPageIndex]
                const rawTarget = getSegmentIdForLocator(startMarker)
                const startFragmentIndex = getMeasuredPageStartFragmentIndex(targetPages?.[targetPageIndex])
                if (!Number.isFinite(rawTarget) && !Number.isFinite(startFragmentIndex)) return

                let windowStart = null

                if (Number.isFinite(startFragmentIndex)) {
                    const visibleEnd = visibleStart + visibleDisplayFragments.length
                    if (startFragmentIndex >= visibleStart && startFragmentIndex < visibleEnd) {
                        windowStart = visibleStart
                    } else {
                        const targetWindow = await loadWindow(startFragmentIndex)
                        if (!targetWindow) return
                        if (isStaleRequest()) return
                        setVisibleStart(startFragmentIndex)
                        windowStart = startFragmentIndex
                    }
                    setCurrentViewportStartFragmentIndex(startFragmentIndex)
                }

                if (!Number.isFinite(windowStart) && Number.isFinite(rawTarget)) {
                    windowStart = await showWindowForSegment(rawTarget)
                }
                if (isStaleRequest()) return
                if (!Number.isFinite(windowStart)) return
                setCurrentViewportStartSegment(startMarker)
                setCurrentViewportPage(targetPageIndex)
                return { windowStart }
            } catch (err) {
                console.error('Failed to navigate TXT render page', err)
            }
            return
        }

        const rawTarget = getSegmentIdForLocator(
            targetLocator,
            getSegmentIdForLocator(currentViewportStartSegment),
        )
        if (!Number.isFinite(rawTarget)) return

        try {
            if (Number.isFinite(targetLocator?.page)) requestedViewportPageRef.current = targetLocator.page
            const targetPages = hasActiveTransforms || hasGlobalRenderPageMap
                ? await loadGlobalRenderPages()
                : null
            if (isStaleRequest()) return
            const candidateGlobalViewportPage = Array.isArray(targetPages) && targetPages.length > 0
                ? findRenderPageForLocator(targetPages, Number.isFinite(targetLocator) ? { segmentId: rawTarget } : targetLocator)
                : null
            const globalViewportPage = Number.isFinite(candidateGlobalViewportPage)
                && measuredPageContainsSegment(targetPages?.[candidateGlobalViewportPage], rawTarget)
                ? candidateGlobalViewportPage
                : null
            const globalStartSegment = Number.isFinite(globalViewportPage)
                ? getRenderPageStartSegment(
                    targetPages,
                    { page: globalViewportPage },
                    rawTarget,
                )
                : null
            const targetWindowSegmentId = rawTarget
            const targetPageStartFragmentIndex = null
            let targetWindowStart = Math.max(0, targetWindowSegmentId - Math.floor(windowSize / 2))
            let targetWindow = null
            if (Number.isFinite(targetPageStartFragmentIndex)) {
                const visibleEnd = visibleStart + visibleDisplayFragments.length
                if (targetWindowStart >= visibleStart && targetWindowStart < visibleEnd) {
                    targetWindowStart = visibleStart
                    targetWindow = {
                        segments: visibleSegments,
                        displayFragments: visibleDisplayFragments,
                    }
                }
            }
            if (!targetWindow) {
                if (Number.isFinite(targetPageStartFragmentIndex)) {
                    targetWindow = await loadWindow(targetWindowStart)
                    if (!targetWindow) return
                    if (isStaleRequest()) return
                    setVisibleStart(targetWindowStart)
                } else {
                    const windowStart = await showWindowForSegment(targetWindowSegmentId)
                    if (!Number.isFinite(windowStart)) return
                    if (isStaleRequest()) return
                    targetWindowStart = windowStart
                    targetWindow = await loadWindow(windowStart)
                    if (!targetWindow) return
                    if (isStaleRequest()) return
                }
            }
            const indexedTargetDisplayFragments = targetWindow.displayFragments.map((fragment, fragmentIndex) => ({
                ...fragment,
                fragmentIndex: targetWindowStart + fragmentIndex,
            }))
            const targetRenderPages = buildMeasuredRenderPages(indexedTargetDisplayFragments, viewportMetrics)
            const resolvedStartSegment = getRenderPageStartSegment(
                targetRenderPages,
                Number.isFinite(targetLocator) ? rawTarget : targetLocator,
                targetWindowSegmentId,
            )
            const resolvedViewportPage = Number.isFinite(globalViewportPage)
                ? globalViewportPage
                : findRenderPageForLocator(
                    targetRenderPages,
                    Number.isFinite(targetLocator) ? { segmentId: rawTarget } : targetLocator,
                )
            const resolvedStartFragmentIndex = getMeasuredPageStartFragmentIndex(
                targetRenderPages.find((page) => page?.startLocator === resolvedStartSegment),
            )
                ?? getMeasuredPageStartFragmentIndex(targetPages?.[resolvedViewportPage])
                ?? targetWindowStart
            if (isStaleRequest()) return
            setCurrentViewportStartSegment(resolvedStartSegment)
            setCurrentViewportStartFragmentIndex(resolvedStartFragmentIndex)
            setCurrentViewportPage(resolvedViewportPage)
            return {
                displayFragments: indexedTargetDisplayFragments,
                windowStart: targetWindowStart,
                segmentStartOffset: getSegmentStartOffset(targetWindow.segments, rawTarget),
            }
        } catch (err) {
            console.error('Failed to navigate TXT segment window', err)
        }
    }, [
        getSegmentStartOffset,
        currentViewportStartSegment,
        hasActiveTransforms,
        hasGlobalRenderPageMap,
        localRenderPageStartSegments.length,
        loadGlobalRenderPages,
        loadWindow,
        renderPages,
        setCurrentViewportPage,
        setVisibleStart,
        showWindowForSegment,
        visibleDisplayFragments,
        visibleSegments,
        visibleStart,
        windowSize,
    ])

    useEffect(() => {
        if (loading || error || renderPages.length === 0 || currentViewportStartSegment != null) return

        if (Number.isFinite(currentViewportPage) && currentViewportPage > 0) {
            void goToViewportPage({ page: currentViewportPage })
            return
        }

        const initialStartSegment = getRenderPageStartSegment(renderPages, { page: 0 }, 0)
        setCurrentViewportStartSegment(initialStartSegment)
        setCurrentViewportStartFragmentIndex(getMeasuredPageStartFragmentIndex(renderPages[0]))
    }, [currentViewportPage, currentViewportStartSegment, error, goToViewportPage, loading, renderPages])

    useEffect(() => {
        if (loading || error || renderPages.length === 0) return
        const readerRoot = readerRootRef.current
        if (!(readerRoot instanceof HTMLElement)) return
        if (document.activeElement === readerRoot) return
        readerRoot.focus({ preventScroll: true })
    }, [error, loading, renderPages.length])

    useEffect(() => {
        if (!hasGlobalRenderPageMap || currentViewportStartSegment == null) return
        if (!Number.isFinite(currentViewportPage)) return

        const anchoredViewportPage = findRenderPageForLocator(globalRenderPages, currentViewportStartSegment)
        if (!Number.isFinite(anchoredViewportPage)) return
        if (anchoredViewportPage === currentViewportPage) return

        setCurrentViewportPage(anchoredViewportPage)
    }, [
        currentViewportPage,
        currentViewportStartSegment,
        globalRenderPages,
        hasGlobalRenderPageMap,
        setCurrentViewportPage,
    ])

    useEffect(() => {
        if (loading || error || renderPages.length === 0 || hasGlobalRenderPageMap) return
        void loadGlobalRenderPages().catch((err) => {
            console.error('Failed to preload TXT render pages', err)
        })
    }, [error, hasGlobalRenderPageMap, loadGlobalRenderPages, loading, renderPages.length])

    const goNext = useCallback(() => {
        const basePage = Number.isFinite(requestedViewportPageRef.current)
            ? requestedViewportPageRef.current
            : effectiveViewportPage
        const nextPage = basePage + pagesPerView

        if (nextPage < totalViewportPages) {
            requestedViewportPageRef.current = nextPage
            void goToViewportPage({ page: nextPage })
            return
        }

        if (hasGlobalRenderPageMap) return

        void loadGlobalRenderPages()
            .then((targetPages) => {
                const targetTotalPages = Math.max(
                    1,
                    getRenderPageStartSegments(targetPages).length || localRenderPageStartSegments.length,
                )
                if (nextPage >= targetTotalPages) return
                requestedViewportPageRef.current = nextPage
                void goToViewportPage({ page: nextPage })
            })
            .catch((err) => {
                console.error('Failed to expand TXT render pages for next navigation', err)
            })
    }, [
        effectiveViewportPage,
        goToViewportPage,
        hasGlobalRenderPageMap,
        loadGlobalRenderPages,
        localRenderPageStartSegments.length,
        pagesPerView,
        totalViewportPages,
    ])

    const goPrev = useCallback(() => {
        const basePage = Number.isFinite(requestedViewportPageRef.current)
            ? requestedViewportPageRef.current
            : effectiveViewportPage
        if (basePage <= 0) return
        const previousPage = Math.max(0, basePage - pagesPerView)
        requestedViewportPageRef.current = previousPage
        void goToViewportPage({ page: previousPage })
    }, [effectiveViewportPage, goToViewportPage, pagesPerView])

    const seekToProgress = useCallback((progressValue) => {
        void (async () => {
            const startSegments = hasGlobalRenderPageMap
                ? globalRenderPageStartSegments
                : getRenderPageStartSegments(await loadGlobalRenderPages())
            if (!Array.isArray(startSegments) || startSegments.length === 0) return
            const targetTotalPages = Math.max(1, startSegments.length || localRenderPageStartSegments.length)
            if (targetTotalPages <= 1) return
            await goToViewportPage({ page: Math.round(progressValue * (targetTotalPages - 1)) })
        })().catch((err) => {
            console.error('Failed to seek TXT progress', err)
        })
    }, [
        globalRenderPageStartSegments,
        goToViewportPage,
        hasGlobalRenderPageMap,
        loadGlobalRenderPages,
        localRenderPageStartSegments.length,
    ])

    const formatPageLocation = useCallback((pageIndex) => (
        tt('searchResultPage').replace('{page}', pageIndex + 1)
    ), [tt])

    const formatResultFallback = useCallback((result) => (
        tt('searchResultMatch').replace('{index}', (Number.isFinite(result?.index) ? result.index : 0) + 1)
    ), [tt])

    const formatSearchResultLocation = useCallback((result) => {
        const locator = result?.locator ?? result
        const explicitPageIndex = getPageIndexForLocator(locator)
        if (Number.isFinite(explicitPageIndex)) return formatPageLocation(explicitPageIndex)

        const pages = hasGlobalRenderPageMap ? globalRenderPages : renderPages
        if (Array.isArray(pages) && pages.length > 0) {
            const pageIndex = findRenderPageForLocator(pages, locator)
            const segmentId = getSegmentIdForLocator(locator, result?.segment_id)
            const page = pages[pageIndex]
            const pageContainsTarget = Number.isFinite(segmentId)
                ? measuredPageContainsSegment(page, segmentId)
                : Number.isFinite(pageIndex)
            if (Number.isFinite(pageIndex) && pageContainsTarget) {
                return formatPageLocation(pageIndex)
            }
        }

        return formatResultFallback(result)
    }, [formatPageLocation, formatResultFallback, globalRenderPages, hasGlobalRenderPageMap, renderPages])

    const handleSearchResultClick = useCallback(async (result) => {
        setAnnotationsOpen(false)
        setActiveAnnotationId(null)
        setActiveSearchIndex(result.index)

        const targetLocator = result.locator ?? result
        if (Number.isFinite(getPageIndexForLocator(targetLocator))) {
            await goToViewportPage(targetLocator)
            return
        }
        if (!Number.isFinite(getSegmentIdForLocator(targetLocator))) {
            if (Number.isFinite(result.position)) await goToViewportPage({ page: result.position })
            return
        }

        const navigationResult = await goToViewportPage(targetLocator)
        const targetSegmentId = getSegmentIdForLocator(targetLocator)
        const segmentStartOffset = navigationResult?.segmentStartOffset
        const targetDisplayFragments = navigationResult?.displayFragments ?? indexedDisplayFragments
        const segmentLocalStart = result.segment_local_start ?? getLocatorSegmentOffset(targetLocator) ?? 0
        const segmentLocalEnd = result.segment_local_end ?? (segmentLocalStart + searchQuery.length)
        const sourceStart = Number.isFinite(result.start_offset)
            ? result.start_offset
            : (Number.isFinite(segmentStartOffset) ? segmentStartOffset + segmentLocalStart : null)
        const sourceEndExclusive = Number.isFinite(result.end_offset)
            ? result.end_offset
            : (Number.isFinite(segmentStartOffset) ? segmentStartOffset + segmentLocalEnd : null)
        const mappedTarget = buildMappedDisplayTarget(
            targetDisplayFragments,
            targetSegmentId,
            sourceStart,
            Number.isFinite(sourceEndExclusive) ? sourceEndExclusive - 1 : null,
            Number.isFinite(sourceStart) ? sourceStart : sourceEndExclusive,
        )

        setPendingSearchTarget(mappedTarget ?? {
            segmentId: targetSegmentId,
            sourceStart,
            sourceEnd: sourceEndExclusive,
            segmentLocalStart,
            segmentLocalEnd,
        })
    }, [buildMappedDisplayTarget, goToViewportPage, indexedDisplayFragments, searchQuery.length])

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
            const selection = typeof window === 'undefined' ? null : window.getSelection()
            const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null
            const startBoundary = getDisplaySelectionBoundary(range, 'start')
            const endBoundary = getDisplaySelectionBoundary(range, 'end')
            const recoveredSegmentId = Number.isFinite(startBoundary?.segmentId) && startBoundary.segmentId === endBoundary?.segmentId
                ? startBoundary.segmentId
                : selectionSnapshot.segmentId
            const recoveredRange = Number.isFinite(recoveredSegmentId)
                && Number.isFinite(startBoundary?.fragmentIndex)
                && Number.isFinite(endBoundary?.fragmentIndex)
                ? recoverSourceRangeFromDisplaySelection(
                    indexedDisplayFragments,
                    recoveredSegmentId,
                    startBoundary.fragmentIndex,
                    startBoundary.displayOffset,
                    endBoundary.fragmentIndex,
                    endBoundary.displayOffset,
                )
                : null
            const segmentStartOffset = getSegmentStartOffset(visibleSegments, recoveredSegmentId)
            const sourceStart = recoveredRange?.sourceStart ?? selectionSnapshot.startOffset
            const sourceEnd = recoveredRange?.sourceEnd ?? selectionSnapshot.endOffset
            const segmentLocalStart = Number.isFinite(sourceStart) && Number.isFinite(segmentStartOffset)
                ? sourceStart - segmentStartOffset
                : selectionSnapshot.segmentLocalStart
            const segmentLocalEnd = Number.isFinite(sourceEnd) && Number.isFinite(segmentStartOffset)
                ? sourceEnd - segmentStartOffset
                : selectionSnapshot.segmentLocalEnd

            const res = await fetch(`${API}/${id}/annotations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind,
                    locator: Number.isFinite(recoveredSegmentId)
                        ? `segment:${recoveredSegmentId}:offset:${segmentLocalStart}`
                        : `page:${effectiveViewportPage}`,
                    page: effectiveViewportPage,
                    segment_id: Number.isFinite(recoveredSegmentId) ? recoveredSegmentId : selectionSnapshot.segmentId,
                    segment_local_start: segmentLocalStart,
                    segment_local_end: segmentLocalEnd,
                    start_offset: sourceStart,
                    end_offset: sourceEnd,
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
    }, [effectiveViewportPage, getDisplaySelectionBoundary, getSegmentStartOffset, id, indexedDisplayFragments, selectionSnapshot, tt, visibleSegments])

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
        if (annotation.locator) {
            void goToViewportPage(annotation.locator)
        } else if (Number.isFinite(annotation.segment_id)) {
            void goToViewportPage({
                segmentId: annotation.segment_id,
                offset: annotation.segment_local_start,
            })
        } else if (Number.isFinite(annotation.page)) {
            void goToViewportPage({ page: annotation.page })
        }
    }, [goToViewportPage])

    const handleResume = useCallback(() => {
        if (!Number.isFinite(resumePrompt?.position)) return
        void goToViewportPage({ page: resumePrompt.position })
        dismissResume()
    }, [dismissResume, goToViewportPage, resumePrompt])

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
                        <button key={bookmark.position} onClick={() => { void goToViewportPage({ page: bookmark.position }) }} className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0" style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
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
                    formatResultLocation={formatSearchResultLocation}
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
                <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goPrev}>{effectiveViewportPage > 0 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></div>)}</div>
                <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goNext}>{effectiveViewportPage < totalViewportPages - 1 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>)}</div>

                <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${hMargin}px`, boxSizing: 'border-box' }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                        </div>
                    ) : (
                            <div
                                ref={scrollerRef}
                                data-testid="txt-reader-scroller"
                                style={{
                                    position: 'relative',
                                    width: '100%',
                                    height: '100%',
                                    minHeight: 0,
                                    overflow: 'visible',
                            }}
                        >
                            <div
                                ref={contentRef}
                                data-testid="txt-reader-content"
                                className="select-text"
                                style={{
                                    height: '100%',
                                    minHeight: 0,
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
                                }}
                            >
                                {visibleRenderPages.length > 0 ? (
                                    <div
                                        data-testid="txt-spread"
                                        style={{
                                            height: '100%',
                                            minHeight: 0,
                                            display: 'grid',
                                            gridTemplateColumns: `repeat(${pagesPerView}, minmax(0, 1fr))`,
                                            gap: `${columnGap}px`,
                                            alignItems: 'stretch',
                                            overflow: 'visible',
                                        }}
                                    >
                                        {visibleRenderPages.map((page, pageIndex) => (
                                            <div
                                                key={`render-page-${pageIndex}-${page.segmentIds.join('-')}`}
                                                data-testid="txt-page-surface"
                                                style={{
                                                    height: '100%',
                                                    minHeight: 0,
                                                    maxHeight: '100%',
                                                    margin: 0,
                                                    padding: `${TXT_PAGE_PADDING_PX + TXT_PAGE_VERTICAL_SAFETY_PX}px ${TXT_PAGE_PADDING_PX}px`,
                                                    border: 'none',
                                                    borderRight: layout === 'dual' && pageIndex === 0 ? `1px solid ${themeStyle.border}` : 'none',
                                                    borderRadius: 0,
                                                    backgroundColor: `${themeStyle.card}66`,
                                                    boxSizing: 'border-box',
                                                    overflow: 'visible',
                                                }}
                                            >
                                                {page.segments.map((segment, segmentIndex) => (
                                                    <div
                                                        key={segment.fragmentKey
                                                            ?? `${segment.segmentId}-${segment.startOffset}-${segment.endOffset}-${segment.sliceStart ?? 0}-${segment.sliceEnd ?? 0}`}
                                                        data-fragment-index={segment.fragmentIndex ?? undefined}
                                                        data-segment-id={segment.segmentId}
                                                        data-segment-start={segment.startOffset}
                                                        data-segment-end={segment.endOffset}
                                                        style={{
                                                            margin: 0,
                                                            marginBottom: segmentIndex === page.segments.length - 1
                                                            || isContinuationRenderSegment(segment, page.segments[segmentIndex + 1])
                                                                ? 0
                                                                : TXT_PARAGRAPH_GAP,
                                                            padding: 0,
                                                        }}
                                                    >
                                                        {segment.displayText}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div>{tt('loadContentFailed')}</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ReaderProgressBar
                currentPage={effectiveViewportPage + 1}
                totalPages={totalViewportPages}
                onSeekPage={(page) => { void goToViewportPage({ page: page - 1 }) }}
                progress={totalViewportPages > 1 ? effectiveViewportPage / (totalViewportPages - 1) : 0}
                onSeekProgress={seekToProgress}
                extraInfo={manifest ? `TXT ${effectiveViewportPage + 1}/${totalViewportPages}` : `TXT | ${loadingLabel}`}
                readerFocusRef={readerRootRef}
                onVisibilityChange={handleProgressBarVisibilityChange}
            />
            <ResumeToast resumePrompt={resumePrompt} onResume={handleResume} onDismiss={dismissResume} tt={tt} />
        </div>
    )
}

export default TxtReader
