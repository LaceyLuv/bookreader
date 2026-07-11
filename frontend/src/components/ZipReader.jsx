import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useResponsiveReaderLayout } from '../hooks/useResponsiveReaderLayout'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReadingProgress } from '../hooks/useReadingProgress'
import ReaderToolbar from './ReaderToolbar'
import ReaderProgressBar from './ReaderProgressBar'
import ResumeToast from './ResumeToast'
import { API_BOOKS_BASE } from '../lib/apiBase'
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
    const [failedImages, setFailedImages] = useState(() => new Set())

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setFailedImages(new Set())
        ; (async () => {
            try {
                const res = await fetch(`${API}/${id}/images`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                if (!cancelled) setImages(Array.isArray(data.images) ? data.images : [])
            } catch {
                console.error('Failed to load images')
                if (!cancelled) setImages([])
            }
            if (!cancelled) setLoading(false)
        })()
        return () => {
            cancelled = true
        }
    }, [id])

    const progress = useReadingProgress(id, {
        totalPages: images.length,
        type: 'zip',
        legacyId,
        paginationReady: !loading && images.length > 0,
        locator: () => ({ kind: 'zip', memberName: images[currentPage] || null, page: currentPage }),
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
        resumePrompt,
        resumeReading,
        dismissResume,
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

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, enabled: true, readerRootRef })

    const imageUrl = (name) => `${API}/${id}/image/${encodeURIComponent(name)}`
    const markImageFailed = useCallback((name) => {
        setFailedImages((prev) => {
            const next = new Set(prev)
            next.add(name)
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
                    className="rounded border px-4 py-3 text-sm opacity-70"
                    style={{
                        maxWidth,
                        borderColor: themeStyle.border,
                        color: themeStyle.text,
                        backgroundColor: `${themeStyle.card}99`,
                    }}
                >
                    {tt('imageLoadFailed')}
                </div>
            )
        }

        return (
            <img
                src={imageUrl(imageName)}
                alt={`Page ${pageIndex + 1}`}
                onError={() => markImageFailed(imageName)}
                className="rounded shadow-lg"
                style={{ maxHeight: imageMaxHeight, maxWidth, objectFit: 'contain' }}
            />
        )
    }

    return (
        <div ref={readerRootRef} tabIndex={-1} className="readerRoot reader-shell h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)', transition: 'background-color 0.3s, color 0.3s' }}>
            <div className="reader-ui reader-topbar shrink-0 flex items-center justify-between" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="reader-topbar-meta flex items-center gap-3">
                    <button onClick={() => navigate('/')} title={tt('backToLibrary')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
                    <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>ZIP</span>
                    <span className="text-[11px] opacity-30" style={{ color: themeStyle.text }}>- {images.length} {tt('images')}</span>
                </div>
                <div className="reader-topbar-actions flex items-center gap-2">
                    <button onClick={addBookmark} title={tt('bookmark')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></button>
                    <ReaderToolbar settings={settings} readerType="zip" />
                </div>
            </div>

            {bookmarks.length > 0 && (
                <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                    <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0" style={{ color: themeStyle.text }}>{tt('bookmarks')}</span>
                    {bookmarks.map((b) => (
                        <button key={b.position} onClick={() => goToBookmark(b.position)} className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0" style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
                            Img {b.position + 1}<span onClick={(e) => { e.stopPropagation(); removeBookmark(b.position) }} className="ml-1.5 opacity-30 hover:opacity-100 cursor-pointer">x</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 relative min-h-0">
                <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goPrev}>{currentPage > 0 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></div>)}</div>
                <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goNext}>{currentPage + pagesPerView < images.length && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>)}</div>

                <div className={`reader-stage reader-zip-stage h-full flex items-center justify-center ${layout === 'dual' ? 'reader-stage-dual' : ''}`} style={{ overflow: clampedScale > 1 ? 'auto' : 'hidden', padding: `${vMargin}px ${hMargin}px`, backgroundColor: 'var(--reader-page-bg)', color: 'var(--reader-page-fg)' }}>
                    {loading ? (
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
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

            <ReaderProgressBar currentPage={images.length > 0 ? Math.min(images.length, currentPage + 1) : 1} totalPages={images.length > 0 ? images.length : null} onSeekPage={(p) => seekToImage(p - 1)} progress={images.length > 1 ? currentPage / (images.length - 1) : 0} onSeekProgress={seekToProgress} extraInfo={`ZIP  ${currentPage + 1}${layout === 'dual' && currentPage + 1 < images.length ? `-${currentPage + 2}` : ''}/${images.length || '?'}`} readerFocusRef={readerRootRef} />
            <ResumeToast resumePrompt={resumePrompt} onResume={resumeReading} onDismiss={dismissResume} tt={tt} />
        </div>
    )
}

export default ZipReader
