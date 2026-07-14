import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ReaderAnnotationsPanel from './ReaderAnnotationsPanel'
import ReaderProgressBar from './ReaderProgressBar'
import ReaderSearchPanel from './ReaderSearchPanel'
import ReaderSelectionMenu from './ReaderSelectionMenu'
import ReaderToolbar from './ReaderToolbar'
import ResumeToast from './ResumeToast'
import TxtEncodingDialog from './TxtEncodingDialog'
import ReaderShell, {
    ReaderBookmarkStrip,
    ReaderPageTurnControls,
    ReaderTopBar,
} from './ReaderShell'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReaderViewportAnchor } from '../hooks/useReaderViewportAnchor'
import { useReadingProgress } from '../hooks/useReadingProgress'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useResponsiveReaderLayout } from '../hooks/useResponsiveReaderLayout'
import { useTxtSegmentWindow } from '../hooks/useTxtSegmentWindow'
import { emitTxtLoadEvent, getTxtLoadTimestamp } from '../lib/txtLoadTelemetry'
import { getDefaultAnnotationColor, getNextAnnotationColor } from '../lib/annotationColors'
import { activateAnnotationHighlight, clearAnnotationHighlights, highlightAnnotationsInElement, scrollAnnotationIntoView } from '../lib/annotationHighlighter'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { clearCurrentSelection, getSelectionSnapshot } from '../lib/annotationSelection'
import { getDualPageOuterInset, MAX_SPLIT_MARGIN_PX } from '../lib/dualPageLayout'
import { clearSearchHighlights } from '../lib/searchHighlighter'
import {
    findDisplayRangeForSourceLocator,
    findNearestDisplayFragmentForSourceOffset,
    recoverSourceRangeFromDisplaySelection,
} from '../lib/txtDisplayMapper'
import { TXT_OFFSET_UNIT, reanchorLegacyTxtAnnotation, utf16IndexToCodePoint } from '../lib/txtUnicodeOffsets'
import { buildMeasuredPages } from '../lib/txtMeasuredPagination'
import { createTxtMeasuredPaginationOptions, getTxtViewportMetrics, measureAverageCharacterWidth } from '../lib/txtPageMetrics'
import { createTxtTransformOptions, toTxtTransformQuery } from '../lib/txtTransformOptions'
import { createTxtLocatorV2, reanchorTxtLocator } from '../lib/txtLocator'
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
const GLOBAL_PAGINATION_CONCURRENCY = 2
const TXT_PAGE_PADDING_PX = 20
const TXT_PAGE_VERTICAL_SAFETY_PX = 2
const TXT_PARAGRAPH_GAP = '0.65em'
const TXT_PARAGRAPH_GAP_LINES = 0.35
const TXT_BOTTOM_WHITESPACE_RECLAIM_LINES = -1
const TXT_MIN_LINES_PER_PAGE = 2
const TXT_MIN_TRAILING_SLICE_LINES = 0

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
        && (
            (
                Number.isFinite(previous.sourceEndOffset)
                && Number.isFinite(next.sourceStartOffset)
                && previous.sourceEndOffset === next.sourceStartOffset
            )
            || (
                Number.isFinite(previous.sliceEnd)
                && Number.isFinite(next.sliceStart)
                && previous.sliceEnd === next.sliceStart
            )
        ),
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
    if (Number.isFinite(locator?.sourceOffset)) return locator.sourceOffset
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
    const [bookTitle, setBookTitle] = useState(location.state?.bookTitle || '')
    const settings = useReaderSettings()
    const {
        contentStyle,
        themeStyle,
        layout: preferredLayout,
        columnGap,
        hMargin,
        vMargin,
        lineHeight,
        letterSpacing,
        lang,
        tt,
    } = settings

    const [compactWhitespace, setCompactWhitespace] = useState(false)
    const layout = useResponsiveReaderLayout(preferredLayout)
    const dualPageOuterInset = layout === 'dual' ? getDualPageOuterInset(columnGap) : 0
    const paginationColumnGap = layout === 'dual' ? MAX_SPLIT_MARGIN_PX : 0
    const [splitParagraphs, setSplitParagraphs] = useState(false)
    const [encodingDialogOpen, setEncodingDialogOpen] = useState(false)
    const [encodingContentVersion, setEncodingContentVersion] = useState(0)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchDraft, setSearchDraft] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [searchRequestId, setSearchRequestId] = useState(0)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState([])
    const [searchMeta, setSearchMeta] = useState({ total: 0, complete: true, partial_reason: null, results_truncated: false })
    const [searchError, setSearchError] = useState('')
    const [activeSearchIndex, setActiveSearchIndex] = useState(null)
    const [pendingSearchTarget, setPendingSearchTarget] = useState(null)
    const [annotationsOpen, setAnnotationsOpen] = useState(false)
    const [annotationsLoading, setAnnotationsLoading] = useState(false)
    const [annotations, setAnnotations] = useState([])
    const [activeAnnotationId, setActiveAnnotationId] = useState(null)
    const [selectionSnapshot, setSelectionSnapshot] = useState(null)
    const [globalRenderPages, setGlobalRenderPages] = useState(null)
    const [globalPaginationStatus, setGlobalPaginationStatus] = useState('idle')
    const [globalPaginationError, setGlobalPaginationError] = useState(null)
    const [globalPaginationRetryToken, setGlobalPaginationRetryToken] = useState(0)
    const [globalPaginationProgress, setGlobalPaginationProgress] = useState({
        phase: 'idle',
        completedSegments: 0,
        totalSegments: 0,
        version: 0,
    })
    const [queuedNextPage, setQueuedNextPage] = useState(null)
    const [currentViewportStartSegment, setCurrentViewportStartSegment] = useState(null)
    const [currentViewportStartFragmentIndex, setCurrentViewportStartFragmentIndex] = useState(null)
    const [viewportMetrics, setViewportMetrics] = useState(null)

    const readerRootRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const pendingAnchorRestoreCleanupRef = useRef(null)
    const globalRenderPageMapPromiseRef = useRef(null)
    const globalRenderPageMapVersionRef = useRef(0)
    const lastReadyTotalPagesRef = useRef(null)
    const navigationRequestIdRef = useRef(0)
    const requestedViewportPageRef = useRef(0)
    const queuedNextPageRef = useRef(null)
    const appliedRestoreKeyRef = useRef(null)
    const firstContentTelemetryKeyRef = useRef(null)
    const isPointerSelectingRef = useRef(false)
    const searchAbortRef = useRef(null)
    const searchGenerationRef = useRef(0)
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
        visibleWindowHasMore,
        setVisibleStart,
        loadWindow,
        loadPaginationWindow,
        showWindowForSegment,
        windowSize,
        loading,
        error,
        readyContentKey,
        contentStatus,
        retryContent,
    } = useTxtSegmentWindow(id, transformOptions, undefined, encodingContentVersion)

    useEffect(() => {
        if (manifest?.title) {
            setBookTitle(manifest.title)
            return
        }

        const controller = new AbortController()
        ; (async () => {
            try {
                const res = await fetch(`${API}/${id}`, { signal: controller.signal })
                if (!res.ok) return
                const data = await res.json()
                setBookTitle(data.title || data.filename?.replace(/\.txt$/i, '') || '')
            } catch (err) {
                if (err?.name !== 'AbortError') console.error('Failed to load TXT book title', err)
            }
        })()

        return () => controller.abort()
    }, [id, manifest?.title])

    const visibleWindowStartsAtZero = visibleStart === 0
    const hasActiveTransforms = transformOptions.trimSpaces || transformOptions.removeEmptyLines || transformOptions.splitParagraphs
    const hasGlobalRenderPageMap = Array.isArray(globalRenderPages) && globalRenderPages.length > 0
    const pagesPerView = getPagesPerView(layout)

    const indexedDisplayFragments = useMemo(
        () => visibleDisplayFragments.map((fragment, fragmentIndex) => ({
            ...fragment,
            fragmentIndex: Number.isFinite(fragment?.fragment_index)
                ? fragment.fragment_index
                : visibleStart + fragmentIndex,
        })),
        [visibleDisplayFragments, visibleStart],
    )

    const renderPages = useMemo(
        () => buildMeasuredRenderPages(indexedDisplayFragments, viewportMetrics),
        [indexedDisplayFragments, viewportMetrics],
    )

    useEffect(() => {
        if (loading || error || renderPages.length === 0) return undefined
        const contentKey = `${readyContentKey}:${viewportMetrics?.charsPerLine}:${viewportMetrics?.linesPerPage}`
        if (!readyContentKey || firstContentTelemetryKeyRef.current === contentKey) return undefined
        firstContentTelemetryKeyRef.current = contentKey
        emitTxtLoadEvent('first_content:commit', {
            bookId: id,
            fragmentCount: visibleDisplayFragments.length,
        })
        return scheduleAfterPaint(() => {
            emitTxtLoadEvent('first_content:visible', {
                bookId: id,
                fragmentCount: visibleDisplayFragments.length,
            })
        })
    }, [
        error,
        id,
        loading,
        readyContentKey,
        renderPages.length,
        viewportMetrics?.charsPerLine,
        viewportMetrics?.linesPerPage,
        visibleDisplayFragments.length,
    ])

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
            if (!visibleWindowHasMore && visibleSegments.length >= manifest.segment_count) {
                return resolveRenderPages(renderPages)
            }

            const paginationWindowSize = manifest.segment_count > 1000 ? 120 : windowSize
            const starts = []
            for (let start = 0; start < manifest.segment_count; start += paginationWindowSize) starts.push(start)
            const windows = new Array(starts.length)
            let nextWindowIndex = 0
            setGlobalPaginationProgress({
                phase: 'fetching',
                completedSegments: 0,
                totalSegments: manifest.segment_count,
                version: mapVersion,
            })

            const reportCompletedRange = (start, rangeEnd) => {
                if (isStaleLoad()) return
                setGlobalPaginationProgress((current) => {
                    if (current.version !== mapVersion) return current
                    return {
                        ...current,
                        completedSegments: Math.min(
                            current.totalSegments,
                            current.completedSegments + Math.max(0, rangeEnd - start),
                        ),
                    }
                })
            }

            const loadNextWindow = async () => {
                while (nextWindowIndex < starts.length) {
                    const windowIndex = nextWindowIndex
                    nextWindowIndex += 1
                    const start = starts[windowIndex]
                    if (isStaleLoad()) return
                    const rangeEnd = Math.min(manifest.segment_count, start + paginationWindowSize)
                    const fragments = []
                    let cursor = null

                    if (start === 0 && paginationWindowSize === windowSize) {
                        const zeroWindow = await loadWindow(0)
                        if (!zeroWindow || isStaleLoad()) return
                        fragments.push(...zeroWindow.displayFragments)
                        if (!zeroWindow.hasMore || !zeroWindow.nextCursor) {
                            windows[windowIndex] = fragments
                            reportCompletedRange(start, rangeEnd)
                            continue
                        }
                        cursor = zeroWindow.nextCursor
                    }

                    while (true) {
                        const cursorFragmentIndex = cursor
                            ? Number.parseInt(cursor.split(':', 1)[0], 10)
                            : start
                        if (!Number.isFinite(cursorFragmentIndex) || cursorFragmentIndex >= rangeEnd) break
                        const windowData = await loadPaginationWindow(start, paginationWindowSize, cursor)
                        if (!windowData || isStaleLoad()) return
                        fragments.push(...windowData.displayFragments)
                        if (!windowData.hasMore || !windowData.nextCursor || windowData.nextCursor === cursor) break
                        cursor = windowData.nextCursor
                    }
                    windows[windowIndex] = fragments
                    reportCompletedRange(start, rangeEnd)
                }
            }

            const workerCount = Math.min(GLOBAL_PAGINATION_CONCURRENCY, starts.length)
            await Promise.all(Array.from({ length: workerCount }, () => loadNextWindow()))
            if (isStaleLoad() || windows.some((windowFragments) => !Array.isArray(windowFragments))) return null

            setGlobalPaginationProgress({
                phase: 'layout',
                completedSegments: manifest.segment_count,
                totalSegments: manifest.segment_count,
                version: mapVersion,
            })
            await new Promise((resolve) => window.requestAnimationFrame(resolve))
            if (isStaleLoad()) return null

            const segments = windows.flatMap((windowFragments, windowIndex) => (
                windowFragments.map((fragment, fragmentIndex) => ({
                    ...fragment,
                    fragmentIndex: Number.isFinite(fragment?.fragment_index)
                        ? fragment.fragment_index
                        : starts[windowIndex] + fragmentIndex,
                }))
            ))

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
        loadPaginationWindow,
        renderPages,
        visibleDisplayFragments,
        visibleSegments,
        visibleWindowHasMore,
        visibleWindowStartsAtZero,
        viewportMetrics,
        windowSize,
    ])

    const totalViewportPages = Math.max(
        1,
        hasGlobalRenderPageMap ? globalRenderPageStartSegments.length : 1,
    )
    const globalPaginationReady = globalPaginationStatus === 'ready' && Array.isArray(globalRenderPages)
    useEffect(() => {
        if (globalPaginationReady) lastReadyTotalPagesRef.current = totalViewportPages
    }, [globalPaginationReady, totalViewportPages])
    const progress = useReadingProgress(id, {
        totalPages: totalViewportPages,
        type: 'txt',
        legacyId,
        paginationReady: !loading && !error && globalPaginationReady,
        locator: () => {
            const fallbackPage = renderPages[clampViewportPage(currentViewportPage, renderPages.length || 1)]
            const activeStart = currentViewportStartSegment
                ?? getRenderPageStartSegment(renderPages, { page: currentViewportPage }, fallbackPage?.startLocator)
            const segmentId = getSegmentIdForLocator(activeStart)
            const sourceOffset = getLocatorSegmentOffset(activeStart)
                ?? getSegmentStartOffset(visibleSegments, segmentId)
            return createTxtLocatorV2({
                renderPages: hasGlobalRenderPageMap ? globalRenderPages : renderPages,
                segmentId,
                sourceOffset,
                page: currentViewportPage,
                sourceRevision: manifest?.source_revision,
            })
        },
        locatorToPosition: (saved) => {
            const pages = hasGlobalRenderPageMap ? globalRenderPages : renderPages
            const reanchored = reanchorTxtLocator(pages, saved, manifest?.source_revision)
            return reanchored?.page ?? findRenderPageForLocator(pages, {
                segmentId: saved?.segmentId,
                offset: saved?.sourceOffset,
                page: saved?.page ?? saved?.fallbackPage,
            })
        },
    })
    const {
        currentPosition: currentViewportPage,
        setCurrentPosition: setCurrentViewportPage,
        bookmarks,
        addBookmark,
        removeBookmark,
        restoredProgress,
        startOver,
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
            displayOffset: utf16IndexToCodePoint(fragmentElement.textContent || '', measurementRange.toString().length),
            segmentId: Number(fragmentElement.dataset.segmentId),
        }
    }, [])

    const mappedCurrentPageAnnotations = useMemo(() => currentPageAnnotations.flatMap((storedAnnotation) => {
        const annotation = reanchorLegacyTxtAnnotation(storedAnnotation, visibleSegments)
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
        lastReadyTotalPagesRef.current = null
        setGlobalRenderPages(null)
        setGlobalPaginationStatus('idle')
        setGlobalPaginationError(null)
        setGlobalPaginationProgress({ phase: 'idle', completedSegments: 0, totalSegments: 0, version: globalRenderPageMapVersionRef.current })
        queuedNextPageRef.current = null
        setQueuedNextPage(null)
        setCurrentViewportStartSegment(null)
        setCurrentViewportStartFragmentIndex(null)
        globalRenderPageMapPromiseRef.current = null
        requestedViewportPageRef.current = 0
    }, [encodingContentVersion, id, transformOptions])

    useEffect(() => {
        setPendingSearchTarget(null)
        setActiveSearchIndex(null)
    }, [encodingContentVersion, transformOptions])

    useEffect(() => {
        globalRenderPageMapVersionRef.current += 1
        setGlobalRenderPages(null)
        setGlobalPaginationStatus('idle')
        setGlobalPaginationError(null)
        setGlobalPaginationProgress({ phase: 'idle', completedSegments: 0, totalSegments: 0, version: globalRenderPageMapVersionRef.current })
        queuedNextPageRef.current = null
        setQueuedNextPage(null)
        globalRenderPageMapPromiseRef.current = null
    }, [viewportMetrics?.charsPerLine, viewportMetrics?.linesPerPage])

    useEffect(() => {
        if (loading || error || !manifest) return
        if (readyContentKey !== `${id}:${transformQuery}:${encodingContentVersion}`) return
        if (!manifest.segment_count) {
            if (!Array.isArray(globalRenderPages)) setGlobalRenderPages([])
            if (globalPaginationStatus !== 'ready') setGlobalPaginationStatus('ready')
            setGlobalPaginationError(null)
            return
        }
        if (renderPages.length === 0) return
        if (globalPaginationStatus === 'loading' || globalPaginationStatus === 'recoverable_error' || globalPaginationStatus === 'cancelled') return
        if (Array.isArray(globalRenderPages)) {
            if (globalPaginationStatus !== 'ready') setGlobalPaginationStatus('ready')
            return
        }

        setGlobalPaginationStatus('loading')
        setGlobalPaginationError(null)
        const paginationVersion = globalRenderPageMapVersionRef.current
        const paginationStartedAt = getTxtLoadTimestamp()
        emitTxtLoadEvent('full_pagination:start', {
            bookId: id,
            segmentCount: manifest.segment_count,
        })
        void loadGlobalRenderPages()
            .then((pages) => {
                if (globalRenderPageMapVersionRef.current !== paginationVersion) return
                if (!Array.isArray(pages)) {
                    emitTxtLoadEvent('full_pagination:cancelled', {
                        bookId: id,
                        durationMs: getTxtLoadTimestamp() - paginationStartedAt,
                        reason: 'superseded',
                    })
                    setGlobalPaginationStatus('cancelled')
                    return
                }
                emitTxtLoadEvent('full_pagination:ready', {
                    bookId: id,
                    durationMs: getTxtLoadTimestamp() - paginationStartedAt,
                    fragmentCount: pages.length,
                })
                setGlobalPaginationStatus('ready')
            })
            .catch((paginationError) => {
                if (globalRenderPageMapVersionRef.current !== paginationVersion) return
                console.error('Failed to prepare TXT pagination', paginationError)
                emitTxtLoadEvent('full_pagination:error', {
                    bookId: id,
                    durationMs: getTxtLoadTimestamp() - paginationStartedAt,
                    reason: paginationError?.message || 'unknown',
                })
                setGlobalPaginationError(paginationError)
                setGlobalPaginationProgress((current) => ({ ...current, phase: 'error' }))
                setGlobalPaginationStatus(paginationError?.name === 'AbortError' ? 'cancelled' : 'recoverable_error')
            })
    }, [
        error,
        globalPaginationRetryToken,
        globalPaginationStatus,
        globalRenderPages,
        loadGlobalRenderPages,
        loading,
        manifest,
        id,
        encodingContentVersion,
        readyContentKey,
        renderPages.length,
        transformQuery,
        viewportMetrics,
    ])

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
                columnGap: paginationColumnGap,
                fontSizePx,
                lineHeight,
                pageHorizontalPaddingPx: layout === 'dual' ? hMargin : TXT_PAGE_PADDING_PX,
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
        contentStyle.fontFamily,
        contentStyle.fontSize,
        contentStyle.fontWeight,
        hMargin,
        layout,
        lineHeight,
        loading,
        pagesPerView,
        paginationColumnGap,
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
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
            setActiveSearchIndex(null)
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
                const res = await fetch(`${API}/${id}/search?q=${encodeURIComponent(trimmedQuery)}&${transformQuery}`, { signal: controller.signal })
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
                }
            } catch (err) {
                if (err?.name !== 'AbortError' && searchGenerationRef.current === generation) {
                    console.error('Failed to search TXT', err)
                    setSearchResults([])
                    setSearchError(tt('searchFailed'))
                    setActiveSearchIndex(null)
                }
            }
            if (!controller.signal.aborted && searchGenerationRef.current === generation) setSearchLoading(false)
        })()

        return () => {
            controller.abort()
            if (searchAbortRef.current === controller) searchAbortRef.current = null
        }
    }, [encodingContentVersion, id, searchOpen, searchQuery, searchRequestId, transformQuery])

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
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
            setActiveSearchIndex(null)
            setPendingSearchTarget(null)
            return
        }
        if (trimmedValue !== searchQuery) {
            setSearchQuery('')
            setSearchLoading(false)
            setSearchResults([])
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
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
            setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
            setSearchError('')
            setActiveSearchIndex(null)
            setPendingSearchTarget(null)
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
            const targetPages = hasGlobalRenderPageMap ? globalRenderPages : null
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
            const anchoredViewportPage = Array.isArray(targetPages) && targetPages.length > 0
                ? findRenderPageForLocator(targetPages, resolvedStartSegment)
                : resolvedViewportPage
            if (isStaleRequest()) return
            setCurrentViewportStartSegment(resolvedStartSegment)
            setCurrentViewportStartFragmentIndex(resolvedStartFragmentIndex)
            setCurrentViewportPage(anchoredViewportPage)
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
        hasGlobalRenderPageMap,
        globalRenderPages,
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

        if (restoredProgress?.position > 0) return

        if (Number.isFinite(currentViewportPage) && currentViewportPage > 0) {
            void goToViewportPage({ page: currentViewportPage })
            return
        }

        const initialStartSegment = getRenderPageStartSegment(renderPages, { page: 0 }, 0)
        setCurrentViewportStartSegment(initialStartSegment)
        setCurrentViewportStartFragmentIndex(getMeasuredPageStartFragmentIndex(renderPages[0]))
    }, [currentViewportPage, currentViewportStartSegment, error, goToViewportPage, loading, renderPages, restoredProgress])

    useEffect(() => {
        if (loading || error || renderPages.length === 0 || !restoredProgress) return
        const savedLocator = restoredProgress.locator
        const requiresQuoteReanchor = savedLocator?.version === 2
            && savedLocator?.sourceRevision
            && manifest?.source_revision
            && savedLocator.sourceRevision !== manifest.source_revision
        if (requiresQuoteReanchor && !hasGlobalRenderPageMap) return
        const restoreKey = `${id}:${manifest?.source_revision || ''}:${restoredProgress.updatedAt || ''}:${JSON.stringify(restoredProgress.locator || restoredProgress.position)}`
        if (appliedRestoreKeyRef.current === restoreKey) return
        appliedRestoreKeyRef.current = restoreKey

        const reanchored = reanchorTxtLocator(globalRenderPages, savedLocator, manifest?.source_revision)
        const target = reanchored
            ? { page: reanchored.page }
            : restoredProgress.locator
            ? {
                ...restoredProgress.locator,
                offset: restoredProgress.locator.sourceOffset ?? restoredProgress.locator.offset,
            }
            : { page: restoredProgress.position }
        void goToViewportPage(target)
    }, [error, globalRenderPages, goToViewportPage, hasGlobalRenderPageMap, id, loading, manifest?.source_revision, renderPages.length, restoredProgress])

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

    const openAdjacentWindow = useCallback(async (direction, targetPage) => {
        if (!manifest?.segment_count || !viewportMetrics) return false
        const adjacentStart = direction === 'next'
            ? visibleStart + windowSize
            : Math.max(0, visibleStart - windowSize)
        if (adjacentStart === visibleStart || adjacentStart >= manifest.segment_count) return false

        const requestId = navigationRequestIdRef.current + 1
        navigationRequestIdRef.current = requestId
        const windowData = await loadWindow(adjacentStart)
        if (!windowData || navigationRequestIdRef.current !== requestId) return false

        const indexedFragments = windowData.displayFragments.map((fragment, fragmentIndex) => ({
            ...fragment,
            fragmentIndex: Number.isFinite(fragment?.fragment_index)
                ? fragment.fragment_index
                : adjacentStart + fragmentIndex,
        }))
        const adjacentPages = buildMeasuredRenderPages(indexedFragments, viewportMetrics)
        if (adjacentPages.length === 0) return false

        const localPageIndex = direction === 'next'
            ? 0
            : Math.max(0, adjacentPages.length - pagesPerView)
        const startMarker = getRenderPageStartSegment(adjacentPages, { page: localPageIndex }, adjacentStart)
        const startFragmentIndex = getMeasuredPageStartFragmentIndex(adjacentPages[localPageIndex]) ?? adjacentStart
        setVisibleStart(adjacentStart)
        setCurrentViewportStartSegment(startMarker)
        setCurrentViewportStartFragmentIndex(startFragmentIndex)
        requestedViewportPageRef.current = targetPage
        setCurrentViewportPage(targetPage)
        return true
    }, [
        loadWindow,
        manifest?.segment_count,
        pagesPerView,
        setCurrentViewportPage,
        setVisibleStart,
        viewportMetrics,
        visibleStart,
        windowSize,
    ])

    useEffect(() => {
        if (loading || error || hasGlobalRenderPageMap || !manifest?.segment_count) return
        if (renderPages.length === 0 || currentRenderPageIndex < Math.max(0, renderPages.length - (pagesPerView * 2))) return
        const nextWindowStart = visibleStart + windowSize
        if (nextWindowStart >= manifest.segment_count) return
        void loadWindow(nextWindowStart).catch(() => {})
    }, [
        currentRenderPageIndex,
        error,
        hasGlobalRenderPageMap,
        loadWindow,
        loading,
        manifest?.segment_count,
        pagesPerView,
        renderPages.length,
        visibleStart,
        windowSize,
    ])

    const goNext = useCallback(() => {
        const basePage = Number.isFinite(requestedViewportPageRef.current)
            ? requestedViewportPageRef.current
            : effectiveViewportPage
        const nextPage = basePage + pagesPerView

        const availableViewportPages = hasGlobalRenderPageMap
            ? totalViewportPages
            : Math.max(1, localRenderPageStartSegments.length)

        if (nextPage < availableViewportPages) {
            requestedViewportPageRef.current = nextPage
            void goToViewportPage({ page: nextPage })
            return
        }

        if (hasGlobalRenderPageMap || globalPaginationStatus === 'recoverable_error' || globalPaginationStatus === 'cancelled') return
        if (queuedNextPageRef.current != null) return

        const paginationVersion = globalRenderPageMapVersionRef.current
        queuedNextPageRef.current = nextPage
        setQueuedNextPage(nextPage)

        void openAdjacentWindow('next', nextPage)
            .then((moved) => {
                if (globalRenderPageMapVersionRef.current !== paginationVersion) return
                if (queuedNextPageRef.current !== nextPage) return
                if (moved) {
                    queuedNextPageRef.current = null
                    setQueuedNextPage(null)
                    return
                }
                return loadGlobalRenderPages().then((targetPages) => {
                    if (globalRenderPageMapVersionRef.current !== paginationVersion) return
                    if (queuedNextPageRef.current !== nextPage) return
                    const targetTotalPages = Math.max(
                        1,
                        getRenderPageStartSegments(targetPages).length || localRenderPageStartSegments.length,
                    )
                    if (nextPage >= targetTotalPages) return
                    requestedViewportPageRef.current = nextPage
                    void goToViewportPage({ page: nextPage })
                })
            })
            .then(() => {
                if (queuedNextPageRef.current !== nextPage) return
                queuedNextPageRef.current = null
                setQueuedNextPage(null)
            })
            .catch((err) => {
                if (queuedNextPageRef.current === nextPage) {
                    queuedNextPageRef.current = null
                    setQueuedNextPage(null)
                }
                console.error('Failed to expand TXT render pages for next navigation', err)
            })
    }, [
        effectiveViewportPage,
        goToViewportPage,
        hasGlobalRenderPageMap,
        globalPaginationStatus,
        loadGlobalRenderPages,
        localRenderPageStartSegments.length,
        openAdjacentWindow,
        pagesPerView,
        totalViewportPages,
    ])

    const goPrev = useCallback(() => {
        queuedNextPageRef.current = null
        setQueuedNextPage(null)
        const basePage = Number.isFinite(requestedViewportPageRef.current)
            ? requestedViewportPageRef.current
            : effectiveViewportPage
        if (basePage <= 0) return
        const previousPage = Math.max(0, basePage - pagesPerView)
        if (!hasGlobalRenderPageMap && currentRenderPageIndex === 0 && visibleStart > 0) {
            void openAdjacentWindow('previous', previousPage).catch((err) => {
                console.error('Failed to load the previous TXT window', err)
            })
            return
        }
        requestedViewportPageRef.current = previousPage
        void goToViewportPage({ page: previousPage })
    }, [
        currentRenderPageIndex,
        effectiveViewportPage,
        goToViewportPage,
        hasGlobalRenderPageMap,
        openAdjacentWindow,
        pagesPerView,
        visibleStart,
    ])

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

    useEffect(() => {
        const legacyAnnotations = currentPageAnnotations.filter((annotation) => !annotation.locator_v2)
        for (const annotation of legacyAnnotations) {
            const anchored = reanchorLegacyTxtAnnotation(annotation, visibleSegments)
            if (anchored?.offset_unit !== TXT_OFFSET_UNIT || !Number.isFinite(anchored.start_offset)) continue
            const locatorV2 = createTxtLocatorV2({
                renderPages: hasGlobalRenderPageMap ? globalRenderPages : renderPages,
                segmentId: anchored.segment_id,
                sourceOffset: anchored.start_offset,
                page: anchored.page ?? effectiveViewportPage,
                sourceRevision: manifest?.source_revision,
            })
            locatorV2.sourceEndOffset = Number.isFinite(anchored.end_offset) ? anchored.end_offset : null
            void updateAnnotationItem(annotation.id, { locator_v2: locatorV2 }).catch(() => {})
        }
    }, [currentPageAnnotations, effectiveViewportPage, globalRenderPages, hasGlobalRenderPageMap, manifest?.source_revision, renderPages, updateAnnotationItem, visibleSegments])

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
            const locatorV2 = createTxtLocatorV2({
                renderPages: hasGlobalRenderPageMap ? globalRenderPages : renderPages,
                segmentId: recoveredSegmentId,
                sourceOffset: sourceStart,
                page: effectiveViewportPage,
                sourceRevision: manifest?.source_revision,
            })
            locatorV2.sourceEndOffset = Number.isFinite(sourceEnd) ? sourceEnd : null

            const res = await fetch(`${API}/${id}/annotations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind,
                    locator: Number.isFinite(recoveredSegmentId)
                        ? `segment:${recoveredSegmentId}:offset:${segmentLocalStart}`
                        : `page:${effectiveViewportPage}`,
                    locator_v2: locatorV2,
                    page: effectiveViewportPage,
                    segment_id: Number.isFinite(recoveredSegmentId) ? recoveredSegmentId : selectionSnapshot.segmentId,
                    segment_local_start: segmentLocalStart,
                    segment_local_end: segmentLocalEnd,
                    start_offset: sourceStart,
                    end_offset: sourceEnd,
                    offset_unit: TXT_OFFSET_UNIT,
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
    }, [effectiveViewportPage, getDisplaySelectionBoundary, getSegmentStartOffset, globalRenderPages, hasGlobalRenderPageMap, id, indexedDisplayFragments, manifest?.source_revision, renderPages, selectionSnapshot, tt, visibleSegments])

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
        if (annotation.locator_v2) {
            const reanchored = reanchorTxtLocator(globalRenderPages, annotation.locator_v2, manifest?.source_revision)
            void goToViewportPage(reanchored ? { page: reanchored.page } : annotation.locator_v2)
        } else if (annotation.locator) {
            void goToViewportPage(annotation.locator)
        } else if (Number.isFinite(annotation.segment_id)) {
            void goToViewportPage({
                segmentId: annotation.segment_id,
                offset: annotation.segment_local_start,
            })
        } else if (Number.isFinite(annotation.page)) {
            void goToViewportPage({ page: annotation.page })
        }
    }, [globalRenderPages, goToViewportPage, manifest?.source_revision])

    const handleStartOver = useCallback(() => {
        appliedRestoreKeyRef.current = null
        startOver()
        void goToViewportPage({ segmentId: 0, sourceOffset: 0 })
    }, [goToViewportPage, startOver])

    const retryGlobalPagination = useCallback(() => {
        globalRenderPageMapVersionRef.current += 1
        navigationRequestIdRef.current += 1
        globalRenderPageMapPromiseRef.current = null
        setGlobalRenderPages(null)
        setGlobalPaginationError(null)
        setGlobalPaginationStatus('idle')
        setGlobalPaginationProgress({ phase: 'idle', completedSegments: 0, totalSegments: 0, version: globalRenderPageMapVersionRef.current })
        queuedNextPageRef.current = null
        setQueuedNextPage(null)
        setGlobalPaginationRetryToken((value) => value + 1)
    }, [])

    const handleEncodingApplied = useCallback(() => {
        appliedRestoreKeyRef.current = null
        searchGenerationRef.current += 1
        searchAbortRef.current?.abort()
        searchAbortRef.current = null
        setSearchLoading(false)
        setSearchResults([])
        setSearchMeta({ total: 0, complete: true, partial_reason: null, results_truncated: false })
        setSearchError('')
        setPendingSearchTarget(null)
        setActiveSearchIndex(null)
        setEncodingContentVersion((version) => version + 1)
    }, [])

    const partialNavigationReady = !loading && !error && renderPages.length > 0
    useKeyboardNav({ onNext: goNext, onPrev: goPrev, enabled: partialNavigationReady && !searchOpen && !annotationsOpen && !encodingDialogOpen && !settings.settingsOpen, readerRootRef })

    const showPaginationPanel = partialNavigationReady && !globalPaginationReady
    const showProgressControl = partialNavigationReady && globalPaginationReady
    const paginationPreparationFailed = globalPaginationStatus === 'recoverable_error'
        || globalPaginationStatus === 'cancelled'
    const loadingLabel = error || globalPaginationError ? tt('loadContentFailed') : (manifest?.encoding || tt('loading'))
    const paginationPercent = globalPaginationProgress.totalSegments > 0
        ? Math.min(99, Math.round((globalPaginationProgress.completedSegments / globalPaginationProgress.totalSegments) * 100))
        : 0
    const canShowNextControl = globalPaginationReady
        ? effectiveViewportPage < totalViewportPages - 1
        : effectiveViewportPage < localRenderPageStartSegments.length - 1 || globalPaginationStatus === 'loading'
    const progressTotalPages = globalPaginationReady
        ? totalViewportPages
        : lastReadyTotalPagesRef.current
    const progressCurrentPage = Number.isFinite(progressTotalPages)
        ? Math.max(1, Math.min(effectiveViewportPage + 1, progressTotalPages))
        : Math.max(1, effectiveViewportPage + 1)
    const progressValue = Number.isFinite(progressTotalPages) && progressTotalPages > 1
        ? (progressCurrentPage - 1) / (progressTotalPages - 1)
        : 0
    const encodingSourceLabel = manifest?.encoding_source === 'override' ? tt('manualEncoding') : tt('automaticEncoding')
    const encodingConfidenceLabel = manifest?.encoding_source === 'override' || !Number.isFinite(manifest?.encoding_confidence)
        ? null
        : `${Math.round(Math.max(0, Math.min(1, manifest.encoding_confidence)) * 100)}%`

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
                            {bookTitle && <span className="text-sm opacity-60 truncate max-w-[18rem]" style={{ color: themeStyle.text }}>{bookTitle}</span>}
                            <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>TXT</span>
                            {manifest?.encoding && (
                                <button
                                    type="button"
                                    onClick={() => setEncodingDialogOpen(true)}
                                    title={`${tt('changeEncoding')} · ${encodingSourceLabel}${encodingConfidenceLabel ? ` ${encodingConfidenceLabel}` : ''}`}
                                    className="rounded-md border px-2 py-1 text-[10px] opacity-60 transition-opacity hover:opacity-100"
                                    style={{ borderColor: themeStyle.border, color: themeStyle.text }}
                                >
                                    <span>{manifest.encoding}</span>
                                    <span> · {encodingSourceLabel}{encodingConfidenceLabel ? ` ${encodingConfidenceLabel}` : ''}</span>
                                </button>
                            )}
                        </>
                    )}
                    actions={(
                        <>
                            <button
                                type="button"
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
                                type="button"
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
                            <button type="button" onClick={addBookmark} title={tt('addBookmark')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></button>
                            <ReaderToolbar
                                settings={settings}
                                readerType="txt"
                                txtTransforms={{
                                    trimSpaces: compactWhitespace,
                                    splitParagraphs,
                                    onTrimSpacesChange: setCompactWhitespace,
                                    onSplitParagraphsChange: setSplitParagraphs,
                                }}
                                txtEncoding={{
                                    encoding: manifest?.encoding,
                                    source: manifest?.encoding_source,
                                    confidence: manifest?.encoding_confidence,
                                    onOpen: () => setEncodingDialogOpen(true),
                                }}
                            />
                        </>
                    )}
                />
            )}
            bookmarkBar={(
                <ReaderBookmarkStrip
                    items={bookmarks}
                    label={tt('bookmarks')}
                    themeStyle={themeStyle}
                    getLabel={(bookmark) => bookmark.label}
                    onActivate={(bookmark) => { void goToViewportPage(bookmark.locator ?? { page: bookmark.position }) }}
                    onRemove={removeBookmark}
                    removeLabel={tt('removeBookmark')}
                />
            )}
            main={(
            <div className="flex-1 relative min-h-0">
                <ReaderSearchPanel
                    open={searchOpen}
                    themeStyle={themeStyle}
                    query={searchDraft}
                    submittedQuery={searchQuery}
                    loading={searchLoading}
                    results={searchResults}
                    meta={searchMeta}
                    error={searchError}
                    activeIndex={activeSearchIndex}
                    onQueryChange={handleSearchQueryChange}
                    onSubmit={handleSearchSubmit}
                    onCancel={handleSearchCancel}
                    onClose={() => setSearchOpen(false)}
                    onResultClick={handleSearchResultClick}
                    formatResultLocation={formatSearchResultLocation}
                    tt={tt}
                />
                <ReaderAnnotationsPanel
                    bookId={id}
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
                <ReaderPageTurnControls
                    themeStyle={themeStyle}
                    showPrev={effectiveViewportPage > 0}
                    showNext={canShowNextControl}
                    onPrev={goPrev}
                    onNext={goNext}
                    previousLabel={tt('previous')}
                    nextLabel={tt('next')}
                />

                <div data-testid="txt-reader-stage" className={`reader-stage ${layout === 'dual' ? 'reader-stage-dual' : ''}`} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${layout === 'dual' ? 0 : hMargin}px`, boxSizing: 'border-box' }}>
                    {loading ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                            <div className="text-sm opacity-60">{tt('openingBook')}</div>
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
                                                className="reader-text-page"
                                                style={{
                                                    height: '100%',
                                                    minHeight: 0,
                                                    maxHeight: '100%',
                                                    margin: 0,
                                                    padding: `${TXT_PAGE_PADDING_PX + TXT_PAGE_VERTICAL_SAFETY_PX}px ${layout === 'dual' ? hMargin : TXT_PAGE_PADDING_PX}px`,
                                                    border: 'none',
                                                    borderRadius: 0,
                                                    backgroundColor: `${themeStyle.card}66`,
                                                    boxSizing: 'border-box',
                                                    overflow: 'visible',
                                                }}
                                            >
                                                <div
                                                    data-testid="txt-page-content"
                                                    style={{
                                                        width: layout === 'dual' ? `calc(100% - ${dualPageOuterInset}px)` : '100%',
                                                        marginLeft: layout === 'dual' && pageIndex === 0 ? 'auto' : 0,
                                                        marginRight: layout === 'dual' && pageIndex === 1 ? 'auto' : 0,
                                                        minWidth: 0,
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
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div data-testid={`txt-content-${contentStatus}`} className="flex h-full flex-col items-center justify-center gap-3">
                                        <div>
                                            {contentStatus === 'empty'
                                                ? tt('emptyContent')
                                                : contentStatus === 'unsupported'
                                                    ? tt('unsupportedContent')
                                                    : contentStatus === 'cancelled'
                                                        ? tt('loadCancelled')
                                                        : tt('loadContentFailed')}
                                        </div>
                                        {contentStatus === 'recoverable_error' && (
                                            <button type="button" onClick={retryContent} className="rounded-lg border px-3 py-1.5 text-sm">
                                                {tt('retry')}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            )}
            bottom={(
                <>
                    {showPaginationPanel && (
                        <div
                            data-testid="txt-pagination-loading"
                            className="reader-ui reader-progress reader-progress-layer txt-pagination-preparation"
                            style={{ borderTop: '1px solid var(--panel-border)' }}
                            aria-live="polite"
                        >
                            <div className="reader-progress-inner">
                                {paginationPreparationFailed ? (
                                    <div className="txt-pagination-status-row">
                                        <span>{tt('pagePreparationFailed')}</span>
                                        <button type="button" onClick={retryGlobalPagination} className="rounded-md border px-3 py-1 text-xs" style={{ borderColor: themeStyle.border }}>
                                            {tt('retry')}
                                        </button>
                                    </div>
                                ) : globalPaginationProgress.phase === 'layout' ? (
                                    <div className="txt-pagination-status-row justify-center">
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                                        <span>{tt('calculatingPageLayout')}</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="txt-pagination-status-row tabular-nums">
                                            <span>{queuedNextPage != null ? tt('preparingNextPage') : tt('preparingPages')}</span>
                                            <span>{paginationPercent}%</span>
                                        </div>
                                        <div
                                            className="txt-pagination-track"
                                            role="progressbar"
                                            aria-label={tt('preparingPages')}
                                            aria-valuemin="0"
                                            aria-valuemax="100"
                                            aria-valuenow={paginationPercent}
                                        >
                                            <div className="txt-pagination-fill" style={{ width: `${paginationPercent}%` }} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <div
                        className="shrink-0"
                        aria-hidden={!showProgressControl}
                        style={{
                            visibility: showProgressControl ? 'visible' : 'hidden',
                            pointerEvents: showProgressControl ? 'auto' : 'none',
                        }}
                    >
                        <ReaderProgressBar
                            currentPage={progressCurrentPage}
                            totalPages={progressTotalPages}
                            onSeekPage={globalPaginationReady ? (page) => { void goToViewportPage({ page: page - 1 }) } : undefined}
                            progress={progressValue}
                            onSeekProgress={globalPaginationReady ? seekToProgress : undefined}
                            extraInfo={manifest ? `TXT ${progressCurrentPage}/${progressTotalPages || '?'}` : `TXT | ${loadingLabel}`}
                            readerFocusRef={readerRootRef}
                        />
                    </div>
                </>
            )}
            overlays={(
                <>
                    <TxtEncodingDialog
                        open={encodingDialogOpen}
                        bookId={id}
                        initialData={manifest}
                        tt={tt}
                        onClose={() => setEncodingDialogOpen(false)}
                        onApplied={handleEncodingApplied}
                    />
                    <ResumeToast
                        message={restoredProgress ? tt('resumedFromLastPosition') : null}
                        actionLabel={tt('startOver')}
                        onAction={handleStartOver}
                        durationMs={5000}
                    />
                </>
            )}
        />
    )
}

export default TxtReader
