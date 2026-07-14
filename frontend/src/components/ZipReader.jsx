import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
import ReaderLoadProblem from './ReaderLoadProblem'
import ReaderShell, {
    ReaderNoticeBar,
    ReaderPageTurnControls,
    ReaderTopBar,
} from './ReaderShell'
import { API_BOOKS_BASE, authenticateAssetUrl } from '../lib/apiBase'
import { readApiProblem } from '../lib/readErrorDetail'
import { getZipImageLayout } from '../lib/zipReaderLayout'
import { createBookmarkThemeStyle } from '../lib/bookmarkTheme'

const API = API_BOOKS_BASE

function ZipReader() {
    const { id } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const legacyId = location.state?.legacyId ?? null
    const settings = useReaderSettings()
    const {
        themeStyle,
        layout: preferredLayout,
        setLayout,
        hMargin,
        vMargin,
        zipImageScale,
        setZipImageScale,
        tt,
    } = settings
    const layout = useResponsiveReaderLayout(preferredLayout)
    const bookmarkThemeStyle = useMemo(() => createBookmarkThemeStyle(themeStyle), [themeStyle])

    const [images, setImages] = useState([])
    const [loading, setLoading] = useState(true)
    const [listProblem, setListProblem] = useState(null)
    const [listAttempt, setListAttempt] = useState(0)
    const [failedImages, setFailedImages] = useState(() => new Set())
    const [imageRetryVersions, setImageRetryVersions] = useState({})
    const [archiveDiagnostics, setArchiveDiagnostics] = useState([])
    const [imageProblems, setImageProblems] = useState({})
    const [bookmarksOpen, setBookmarksOpen] = useState(false)
    const listGenerationRef = useRef(0)

    useEffect(() => {
        const controller = new AbortController()
        const generation = listGenerationRef.current + 1
        listGenerationRef.current = generation
        setLoading(true)
        setListProblem(null)
        setImages([])
        setFailedImages(new Set())
        setImageRetryVersions({})
        setArchiveDiagnostics([])
        setImageProblems({})
        ; (async () => {
            try {
                const res = await fetch(`${API}/${id}/images`, { signal: controller.signal })
                if (!res.ok) {
                    const problem = await readApiProblem(res, tt('archiveLoadFailed'))
                    if (!controller.signal.aborted && listGenerationRef.current === generation) {
                        setListProblem(problem)
                    }
                    return
                }
                const data = await res.json()
                if (!controller.signal.aborted && listGenerationRef.current === generation) {
                    setImages(Array.isArray(data.images) ? data.images : [])
                    setArchiveDiagnostics(Array.isArray(data.diagnostics) ? data.diagnostics : [])
                }
            } catch (err) {
                if (err?.name !== 'AbortError' && listGenerationRef.current === generation) {
                    console.error('Failed to load images', err)
                    setListProblem({
                        code: 'network_error',
                        message: tt('archiveLoadFailed'),
                        severity: 'error',
                        stage: 'archive',
                        retryable: true,
                        recovery: null,
                        context: null,
                        status: null,
                    })
                }
            } finally {
                if (!controller.signal.aborted && listGenerationRef.current === generation) setLoading(false)
            }
        })()
        return () => {
            controller.abort()
        }
    }, [id, listAttempt])

    const progress = useReadingProgress(id, {
        totalPages: images.length,
        type: 'zip',
        legacyId,
        paginationReady: !loading && !listProblem && images.length > 0,
        locator: () => ({ kind: 'zip', memberName: images[currentPage] || null, page: currentPage, fallbackPage: currentPage }),
        locatorToPosition: (saved) => {
            const memberIndex = saved?.memberName ? images.indexOf(saved.memberName) : -1
            return memberIndex >= 0 ? memberIndex : saved?.page
        },
        bookmarkSnapshot: () => ({
            excerpt: images[currentPage] || `${tt('page')} ${currentPage + 1}`,
        }),
    })
    const {
        currentPosition: currentPage,
        setCurrentPosition: setCurrentPage,
        bookmarks,
        addBookmark,
        removeBookmark,
        updateBookmark,
        goToBookmark,
        restoredProgress,
        startOver,
    } = progress

    const pagesPerView = layout === 'dual' ? 2 : 1
    const readerRootRef = useRef(null)

    const goNext = useCallback(() => {
        if (currentPage + pagesPerView < images.length) {
            setCurrentPage((p) => Math.min(images.length - 1, p + pagesPerView))
        }
    }, [currentPage, pagesPerView, images.length, setCurrentPage])

    const goPrev = useCallback(() => {
        if (currentPage > 0) {
            setCurrentPage((p) => Math.max(0, p - pagesPerView))
        }
    }, [currentPage, pagesPerView, setCurrentPage])

    const seekToImage = useCallback((index) => {
        if (!images.length) return
        setCurrentPage(Math.max(0, Math.min(index, images.length - 1)))
    }, [images.length, setCurrentPage])

    const seekToProgress = useCallback((p) => {
        if (images.length <= 1) return
        seekToImage(Math.round(p * (images.length - 1)))
    }, [images.length, seekToImage])

    const handleStartOver = useCallback(() => {
        startOver()
        seekToImage(0)
    }, [seekToImage, startOver])

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, enabled: !bookmarksOpen && !listProblem && !settings.settingsOpen, readerRootRef })
    useReaderCommandShortcuts({
        enabled: !bookmarksOpen && !loading && !listProblem && images.length > 0 && !settings.settingsOpen,
        settingsShortcutEnabled: !bookmarksOpen,
        searchShortcutEnabled: false,
        onBack: () => navigate('/'),
        onFirstPage: () => seekToImage(0),
        onLastPage: () => seekToImage(images.length - 1),
        onAddBookmark: addBookmark,
        onToggleBookmarkBar: () => settings.setShowZipBookmarkBar(!settings.showZipBookmarkBar),
        onToggleLayout: () => setLayout(preferredLayout === 'dual' ? 'single' : 'dual'),
        onDecreaseScale: () => setZipImageScale(zipImageScale - 0.1),
        onIncreaseScale: () => setZipImageScale(zipImageScale + 0.1),
        onToggleSettings: settings.toggleSettings,
    })

    const imageUrl = (name) => {
        const retryVersion = imageRetryVersions[name] || 0
        const baseUrl = `${API}/${id}/image/${encodeURIComponent(name)}`
        return authenticateAssetUrl(retryVersion > 0 ? `${baseUrl}?retry=${retryVersion}` : baseUrl)
    }
    const markImageFailed = useCallback((name) => {
        setFailedImages((prev) => {
            const next = new Set(prev)
            next.add(name)
            return next
        })
        void fetch(`${API}/${id}/diagnostics?member_name=${encodeURIComponent(name)}`)
            .then(async (response) => (response.ok ? response.json() : null))
            .then((diagnostics) => {
                const problem = Array.isArray(diagnostics?.issues)
                    ? diagnostics.issues.find((issue) => issue?.severity === 'error') || diagnostics.issues[0]
                    : null
                if (problem) setImageProblems((previous) => ({ ...previous, [name]: problem }))
            })
            .catch(() => {})
    }, [id])
    const retryImage = useCallback((name) => {
        setFailedImages((prev) => {
            const next = new Set(prev)
            next.delete(name)
            return next
        })
        setImageRetryVersions((prev) => ({ ...prev, [name]: (prev[name] || 0) + 1 }))
        setImageProblems((previous) => {
            const next = { ...previous }
            delete next[name]
            return next
        })
    }, [])
    const {
        scale: clampedScale,
        singleMaxWidth,
        dualMaxWidth,
        imageMaxHeight,
    } = getZipImageLayout(zipImageScale)
    const renderImagePage = (imageName, pageIndex, maxWidth) => {
        if (!imageName) return null
        if (failedImages.has(imageName)) {
            return (
                <div
                    role="status"
                    className="flex flex-col items-center gap-2 rounded border px-4 py-3 text-sm"
                    style={{
                        maxWidth,
                        borderColor: themeStyle.border,
                        color: themeStyle.text,
                        backgroundColor: `${themeStyle.card}99`,
                    }}
                >
                    <span>{imageProblems[imageName]?.message || tt('imageLoadFailed')}</span>
                    {imageProblems[imageName]?.code && <code className="text-[10px] opacity-60">{imageProblems[imageName].code}</code>}
                    <button
                        type="button"
                        onClick={() => retryImage(imageName)}
                        className="rounded-md border px-2.5 py-1 text-xs"
                        style={{ borderColor: themeStyle.border }}
                    >
                        {tt('retryImage')}
                    </button>
                </div>
            )
        }

        return (
            <img
                src={imageUrl(imageName)}
                alt={`${tt('page')} ${pageIndex + 1}`}
                onError={() => markImageFailed(imageName)}
                className="rounded shadow-lg"
                style={{ maxHeight: imageMaxHeight, maxWidth, objectFit: 'contain' }}
            />
        )
    }

    const handleBookmarkActivate = (bookmark) => {
        const memberIndex = bookmark.locator?.memberName ? images.indexOf(bookmark.locator.memberName) : -1
        goToBookmark({
            ...bookmark,
            position: memberIndex >= 0
                ? memberIndex
                : (bookmark.locator?.fallbackPage ?? bookmark.position),
        })
    }

    const canAddBookmark = !loading && !listProblem && images.length > 0

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
                            <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>ZIP</span>
                            <span className="text-[11px] opacity-30" style={{ color: themeStyle.text }}>- {images.length} {tt('images')}</span>
                        </>
                    )}
                    actions={(
                        <>
                            <ReaderBookmarkToggle
                                open={bookmarksOpen}
                                onToggle={() => setBookmarksOpen((open) => !open)}
                                themeStyle={bookmarkThemeStyle}
                                tt={tt}
                                lang={settings.lang}
                            />
                            <ReaderToolbar settings={settings} readerType="zip" />
                        </>
                    )}
                />
            )}
            notice={(
                <ReaderNoticeBar
                    themeStyle={themeStyle}
                    message={tt('archiveEntriesSkipped')}
                    issues={archiveDiagnostics}
                />
            )}
            bookmarkBar={settings.showZipBookmarkBar && (bookmarksOpen || bookmarks.length > 0) ? (
                <ReaderBookmarkNavigator
                    items={bookmarks}
                    currentPosition={currentPage}
                    themeStyle={bookmarkThemeStyle}
                    onActivate={handleBookmarkActivate}
                    tt={tt}
                    lang={settings.lang}
                />
            ) : null}
            sidePanel={bookmarksOpen ? (
                <ReaderBookmarksPanel
                    open
                    items={bookmarks}
                    currentPosition={currentPage}
                    themeStyle={bookmarkThemeStyle}
                    onClose={() => setBookmarksOpen(false)}
                    onAdd={canAddBookmark ? () => addBookmark() : undefined}
                    onActivate={handleBookmarkActivate}
                    onRemove={removeBookmark}
                    onUpdate={updateBookmark}
                    tt={tt}
                    lang={settings.lang}
                />
            ) : null}
            main={(
                <div className="flex-1 relative min-h-0">
                    <ReaderBookmarkFab
                        onAdd={() => addBookmark()}
                        themeStyle={bookmarkThemeStyle}
                        tt={tt}
                        lang={settings.lang}
                        disabled={!canAddBookmark}
                    />
                    <ReaderPageTurnControls
                        themeStyle={themeStyle}
                        showPrev={currentPage > 0}
                        showNext={currentPage + pagesPerView < images.length}
                        onPrev={goPrev}
                        onNext={goNext}
                        previousLabel={tt('previous')}
                        nextLabel={tt('next')}
                    />
                <div aria-busy={loading} className={`reader-stage reader-zip-stage h-full flex items-center justify-center ${layout === 'dual' ? 'reader-stage-dual' : ''}`} style={{ overflow: clampedScale > 1 ? 'auto' : 'hidden', padding: `${vMargin}px ${hMargin}px`, backgroundColor: 'var(--reader-page-bg)', color: 'var(--reader-page-fg)' }}>
                    {loading ? (
                        <div role="status" aria-label={tt('loading')} className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                    ) : listProblem ? (
                        <ReaderLoadProblem
                            problem={listProblem}
                            title={tt('archiveLoadFailed')}
                            themeStyle={themeStyle}
                            tt={tt}
                            onRetry={() => setListAttempt((value) => value + 1)}
                            onBack={() => navigate('/')}
                            forceRetry
                        />
                    ) : images.length > 0 ? (
                        <div className="flex h-full items-center justify-center gap-4">
                            {renderImagePage(images[currentPage], currentPage, layout === 'dual' ? dualMaxWidth : singleMaxWidth)}
                            {layout === 'dual' && currentPage + 1 < images.length && (
                                renderImagePage(images[currentPage + 1], currentPage + 1, dualMaxWidth)
                            )}
                        </div>
                    ) : (
                        <p className="opacity-40" style={{ color: themeStyle.text }}>{tt('noImagesFound')}</p>
                    )}
                </div>
                </div>
            )}
            bottom={(
                <ReaderProgressBar currentPage={images.length > 0 ? Math.min(images.length, currentPage + 1) : 1} totalPages={images.length > 0 ? images.length : null} onSeekPage={(p) => seekToImage(p - 1)} progress={images.length > 1 ? currentPage / (images.length - 1) : 0} onSeekProgress={seekToProgress} extraInfo={`ZIP  ${currentPage + 1}${layout === 'dual' && currentPage + 1 < images.length ? `-${currentPage + 2}` : ''}/${images.length || '?'}`} readerFocusRef={readerRootRef} />
            )}
            overlays={(
                <ResumeToast
                    message={restoredProgress ? tt('resumedFromLastPosition') : null}
                    actionLabel={tt('startOver')}
                    onAction={handleStartOver}
                    durationMs={5000}
                />
            )}
        />
    )
}

export default ZipReader
