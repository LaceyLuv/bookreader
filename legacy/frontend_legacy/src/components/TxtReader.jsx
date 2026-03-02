import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReadingProgress } from '../hooks/useReadingProgress'
import ReaderToolbar from './ReaderToolbar'
import ReaderProgressBar from './ReaderProgressBar'
import ResumeToast from './ResumeToast'
import { API_BOOKS_BASE } from '../lib/apiBase'

const API = API_BOOKS_BASE

function TxtReader() {
    const { id } = useParams()
    const navigate = useNavigate()
    const settings = useReaderSettings()
    const { contentStyle, themeStyle, layout, columnGap, hMargin, vMargin,
        lineHeight, letterSpacing, bgColor, textColor, fontFamily, fontWeight, tt, toggleTitleBar } = settings

    const [fullText, setFullText] = useState('')
    const [encoding, setEncoding] = useState('')
    const [loading, setLoading] = useState(true)

    const [totalPages, setTotalPages] = useState(1)
    const [pageWidth, setPageWidth] = useState(0)
    const frameRef = useRef(null)     // Stationary frame (padding + overflow:hidden)
    const scrollerRef = useRef(null)  // Snap-scroll viewport
    const contentRef = useRef(null)
    const stepRef = useRef(0)

    // ─── Load content ───
    useEffect(() => {
        ; (async () => {
            try {
                const res = await axios.get(`${API}/${id}/content`)
                setFullText(res.data.text)
                setEncoding(res.data.encoding)
            } catch { setFullText('Failed to load file content.') }
            setLoading(false)
        })()
    }, [id])

    // ─── Reading progress ───
    const progress = useReadingProgress(id, { totalPages, type: 'txt' })
    const { currentPosition: currentPage, setCurrentPosition: setCurrentPage,
        bookmarks, addBookmark, removeBookmark, goToBookmark,
        resumePrompt, resumeReading, dismissResume } = progress
    const isSpread = layout === 'spread' || layout === 'dual'

    // ─── Measure & re-align using scroll-snap ───
    const measure = useCallback(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth
        const contentStyle = getComputedStyle(contentEl)
        const rawGap = contentStyle.columnGap
        const fallbackGap = parseFloat(contentStyle.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const colW = isSpread
            ? Math.max(1, Math.floor((W - gap) / 2))
            : Math.max(1, Math.floor(W))
        const H = Math.max(1, Math.floor(scroller.clientHeight))
        contentEl.style.columnWidth = `${colW}px`
        contentEl.style.columnCount = isSpread ? '2' : '1'
        contentEl.style.columnFill = 'auto'
        contentEl.style.height = `${H}px`
        contentEl.style.display = 'block'
        contentEl.style.textAlign = 'left'
        contentEl.style.columnRule = isSpread ? '1px solid transparent' : 'none'
        const step = W + gap
        if (step <= 0) return
        const oldStep = stepRef.current > 0 ? stepRef.current : step
        const oldLeft = scroller.scrollLeft
        const idxFromScroll = Math.round(oldLeft / oldStep)
        stepRef.current = step
        setPageWidth(W)
        const pages = Math.max(1, Math.ceil((scroller.scrollWidth + gap) / step))
        setTotalPages(pages)
        const clamped = Math.max(0, Math.min(idxFromScroll, pages - 1))
        scroller.scrollTo({ left: Math.round(clamped * step), behavior: 'auto' })
        setCurrentPage(prev => (prev === clamped ? prev : clamped))
    }, [isSpread, setCurrentPage])

    // Synchronous measurement after DOM commit
    useLayoutEffect(() => {
        if (!loading && fullText) measure()
    }, [loading, fullText, measure, settings.fontSize, settings.font,
        layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing])

    // Deferred: catches font rendering & late reflows
    useEffect(() => {
        if (!loading && fullText) {
            const t = setTimeout(measure, 250)
            return () => clearTimeout(t)
        }
    }, [loading, fullText, measure, settings.fontSize, settings.font,
        layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing])

    // Window resize → re-measure + re-align
    useEffect(() => {
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [measure])

    // ResizeObserver on the FRAME (margin slider → frame padding changes → content area changes)
    useEffect(() => {
        const frame = frameRef.current
        if (!frame || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(() => measure())
        ro.observe(frame)
        return () => ro.disconnect()
    }, [measure])

    // ─── Navigation via scrollTo ───
    const goToPage = useCallback((page) => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const target = Math.max(0, Math.min(page, totalPages - 1))
        const W = scroller.clientWidth
        const contentStyle = getComputedStyle(contentEl)
        const rawGap = contentStyle.columnGap
        const fallbackGap = parseFloat(contentStyle.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap
        if (step <= 0) return
        stepRef.current = step
        const targetLeft = Math.round(target * step)
        console.log('[TxtReader] goToPage:', target, 'W:', W, 'gap:', gap, 'step:', step, 'scrollWidth:', scroller.scrollWidth, 'targetLeft:', targetLeft)
        scroller.scrollTo({ left: targetLeft, behavior: 'smooth' })
        setCurrentPage(target)
    }, [totalPages])

    // Drive scroll whenever currentPage changes (e.g. from keyboard, buttons, bookmarks)
    useEffect(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth
        const contentStyle = getComputedStyle(contentEl)
        const rawGap = contentStyle.columnGap
        const fallbackGap = parseFloat(contentStyle.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap
        if (step <= 0) return
        stepRef.current = step
        scroller.scrollTo({ left: Math.round(currentPage * step), behavior: 'smooth' })
    }, [currentPage])

    useEffect(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        let timer = null
        const onScroll = () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                const W = scroller.clientWidth
                const contentStyle = getComputedStyle(contentEl)
                const rawGap = contentStyle.columnGap
                const fallbackGap = parseFloat(contentStyle.fontSize) || 16
                const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
                const step = W + gap
                if (step <= 0) return
                stepRef.current = step
                const snapIndex = Math.round(scroller.scrollLeft / step)
                const snapLeft = Math.round(snapIndex * step)
                if (Math.abs(scroller.scrollLeft - snapLeft) >= 1) {
                    scroller.scrollTo({ left: snapLeft, behavior: 'auto' })
                }
                const clamped = Math.max(0, Math.min(snapIndex, totalPages - 1))
                setCurrentPage(prev => (prev === clamped ? prev : clamped))
            }, 120)
        }
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            if (timer) clearTimeout(timer)
            scroller.removeEventListener('scroll', onScroll)
        }
    }, [totalPages])

    const goNext = useCallback(() => {
        if (currentPage < totalPages - 1) goToPage(currentPage + 1)
    }, [currentPage, totalPages, goToPage])

    const goPrev = useCallback(() => {
        if (currentPage > 0) goToPage(currentPage - 1)
    }, [currentPage, goToPage])

    const seekToProgress = useCallback((nextProgress) => {
        if (totalPages <= 1) return
        const target = Math.round(nextProgress * (totalPages - 1))
        goToPage(target)
    }, [totalPages, goToPage])

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, onEscape: toggleTitleBar, enabled: true })

    return (
        <div className="readerRoot h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden"
            style={{
                '--reader-font': fontFamily,
                '--reader-bg': bgColor,
                '--reader-fg': textColor,
                '--reader-weight': fontWeight,
                '--reader-border': themeStyle.border,
                '--reader-accent': '#5c7cfa',
                transition: 'background-color 0.3s, color 0.3s',
            }}>

            {/* ── Header ── */}
            <div className="shrink-0 flex items-center justify-between px-6 py-2.5"
                style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/')} title={tt('backToLibrary')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                        style={{ color: themeStyle.text }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                    </button>
                    <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40"
                        style={{ color: themeStyle.text }}>TXT</span>
                    {encoding && <span className="text-[11px] opacity-30" style={{ color: themeStyle.text }}>
                        · {encoding}
                    </span>}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={addBookmark} title={tt('addBookmark')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                        style={{ color: themeStyle.text }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                    </button>
                    <ReaderToolbar settings={settings} />
                </div>
            </div>

            {/* ── Bookmarks ── */}
            {bookmarks.length > 0 && (
                <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto"
                    style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                    <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0"
                        style={{ color: themeStyle.text }}>{tt('bookmarks')}</span>
                    {bookmarks.map(b => (
                        <button key={b.position} onClick={() => goToBookmark(b.position)}
                            className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0"
                            style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
                            {b.label}
                            <span onClick={(e) => { e.stopPropagation(); removeBookmark(b.position) }}
                                className="ml-1.5 opacity-30 hover:opacity-100 cursor-pointer">×</span>
                        </button>
                    ))}
                </div>
            )}

            {/* ── Reading Area ── */}
            <div className="flex-1 relative min-h-0">
                {/* Hover arrows */}
                <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300"
                    onClick={goPrev}>
                    {currentPage > 0 && (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md"
                            style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                        </div>
                    )}
                </div>
                <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300"
                    onClick={goNext}>
                    {currentPage < totalPages - 1 && (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md"
                            style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                        </div>
                    )}
                </div>

                {/* Book-fold center shadow */}
                {layout === 'dual' && (
                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-8 z-10 pointer-events-none"
                        style={{
                            background: `linear-gradient(to right, transparent, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 45%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)'} 50%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 55%, transparent)`,
                        }}
                    />
                )}

                {/* ═══ LAYER 1: STATIONARY FRAME ═══
                    Holds padding (margins). Never scrolls. Clips overflow. */}
                <div
                    ref={frameRef}
                    style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden',
                        padding: `${vMargin}px ${hMargin}px`,
                        boxSizing: 'border-box',
                    }}
                >
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <div className="animate-spin text-4xl">⏳</div>
                        </div>
                    ) : (
                        /* ═══ LAYER 2: SNAP-SCROLL VIEWPORT ═══
                           overflow-x:hidden — all navigation is programmatic.
                           scroll-snap-type keeps alignment pixel-perfect. */
                        <div
                            ref={scrollerRef}
                            className="reader-scroller"
                            style={{
                                position: 'relative',
                                width: '100%',
                                height: '100%',
                                overflowX: 'auto',
                                overflowY: 'hidden',
                                scrollSnapType: 'none',
                                scrollbarGutter: 'stable',
                            }}
                        >
                            {/* ═══ LAYER 3: CONTENT BOX ═══
                                CSS columns generate horizontal overflow.
                                scrollTo() navigates; snap corrects drift. */}
                            <div
                                ref={contentRef}
                                className="select-text"
                                style={{
                                    height: '100%',
                                    boxSizing: 'border-box',
                                    display: 'block',
                                    fontFamily: contentStyle.fontFamily,
                                    fontSize: contentStyle.fontSize,
                                    color: contentStyle.color,
                                    lineHeight: `${lineHeight}`,
                                    letterSpacing: `${letterSpacing}em`,
                                    textAlign: 'left',
                                    hyphens: 'auto',
                                    WebkitHyphens: 'auto',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    columnCount: isSpread ? 2 : 1,
                                    columnGap: `${columnGap}px`,
                                    columnFill: 'auto',
                                    columnRule: isSpread ? '1px solid transparent' : 'none',
                                    breakInside: 'avoid-column',
                                }}
                            >
                                {fullText}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Bottom Bar ── */}
            <ReaderProgressBar
                currentPage={currentPage + 1}
                totalPages={totalPages}
                onSeekPage={(pageNumber) => goToPage(pageNumber - 1)}
                progress={totalPages > 1 ? currentPage / (totalPages - 1) : 0}
                onSeekProgress={seekToProgress}
                extraInfo={`TXT  ${currentPage + 1}/${totalPages}`}
            />

            <ResumeToast resumePrompt={resumePrompt} onResume={resumeReading} onDismiss={dismissResume} tt={tt} />
        </div >
    )
}

export default TxtReader
