import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useResponsiveReaderLayout } from '../hooks/useResponsiveReaderLayout'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReadingProgress } from '../hooks/useReadingProgress'
import ReaderToolbar from './ReaderToolbar'
import ReaderProgressBar from './ReaderProgressBar'
import ResumeToast from './ResumeToast'
import ReaderLoadProblem from './ReaderLoadProblem'
import ReaderShell, {
    ReaderBookmarkStrip,
    ReaderNoticeBar,
    ReaderPageTurnControls,
    ReaderTopBar,
} from './ReaderShell'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { readApiProblem } from '../lib/readErrorDetail'
import { getZipImageLayout } from '../lib/zipReaderLayout'

const API = API_BOOKS_BASE

function ZipReader() {
    const { id } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const legacyId = location.state?.legacyId ?? null
    const settings = useReaderSettings()
    const { themeStyle, layout: preferredLayout, hMargin, vMargin, zipImageScale, tt } = settings
    const layout = useResponsiveReaderLayout(preferredLayout)

    const [images, setImages] = useState([])
    const [loading, setLoading] = useState(true)
    const [listProblem, setListProblem] = useState(null)
    const [listAttempt, setListAttempt] = useState(0)
    const [failedImages, setFailedImages] = useState(() => new Set())
    const [imageRetryVersions, setImageRetryVersions] = useState({})
    const [archiveDiagnostics, setArchiveDiagnostics] = useState([])
    const [imageProblems, setImageProblems] = useState({})
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
    })
    const {
        currentPosition: currentPage,
        setCurrentPosition: setCurrentPage,
        bookmarks,
        addBookmark,
        removeBookmark,
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

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, enabled: !listProblem && !settings.settingsOpen, readerRootRef })

    const imageUrl = (name) => {
        const retryVersion = imageRetryVersions[name] || 0
        const baseUrl = `${API}/${id}/image/${encodeURIComponent(name)}`
        return retryVersion > 0 ? `${baseUrl}?retry=${retryVersion}` : baseUrl
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
                            <button type="button" onClick={addBookmark} title={tt('bookmark')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></button>
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
            bookmarkBar={(
                <ReaderBookmarkStrip
                    items={bookmarks}
                    label={tt('bookmarks')}
                    themeStyle={themeStyle}
                    getLabel={(bookmark) => `Img ${bookmark.position + 1}`}
                    onActivate={(bookmark) => {
                        const memberIndex = bookmark.locator?.memberName ? images.indexOf(bookmark.locator.memberName) : -1
                        goToBookmark({
                            ...bookmark,
                            position: memberIndex >= 0
                                ? memberIndex
                                : (bookmark.locator?.fallbackPage ?? bookmark.position),
                        })
                    }}
                    onRemove={removeBookmark}
                    removeLabel={tt('removeBookmark')}
                />
            )}
            main={(
                <div className="flex-1 relative min-h-0">
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
