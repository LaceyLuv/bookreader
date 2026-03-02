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

function EpubReader() {
    const { id } = useParams()
    const navigate = useNavigate()
    const settings = useReaderSettings()
    const { contentStyle, themeStyle, layout, columnGap, hMargin, vMargin,
        lineHeight, letterSpacing, bgColor, textColor, fontFamily, fontWeight, tt, toggleTitleBar } = settings

    const [toc, setToc] = useState([])
    const [bookTitle, setBookTitle] = useState('')
    const [chapter, setChapter] = useState(null)
    const [loading, setLoading] = useState(true)
    const [sidebarOpen, setSidebarOpen] = useState(false)

    const [chapterPage, setChapterPage] = useState(0)
    const [chapterTotalPages, setChapterTotalPages] = useState(1)
    const [pageWidth, setPageWidth] = useState(0)
    const frameRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const stepRef = useRef(0)

    const [totalChapters, setTotalChapters] = useState(1)
    const progress = useReadingProgress(id, { totalPages: totalChapters, type: 'epub' })
    const { currentPosition: chapterIndex, setCurrentPosition: setChapterIndex,
        bookmarks, addBookmark, removeBookmark, goToBookmark,
        resumePrompt, resumeReading, dismissResume } = progress
    const isSpread = layout === 'spread' || layout === 'dual'

    // ??? Load TOC ???
    useEffect(() => {
        ; (async () => {
            try {
                const res = await axios.get(`${API}/${id}/toc`)
                setBookTitle(res.data.title)
                setToc(res.data.toc)
                setTotalChapters(res.data.toc.length || 1)
                loadChapter(0)
            } catch (err) {
                console.error('Failed to load TOC', err)
                setLoading(false)
            }
        })()
    }, [id])

    const loadChapter = async (index) => {
        setLoading(true)
        setChapterIndex(index)
        setChapterPage(0)
        try {
            const res = await axios.get(`${API}/${id}/chapter/${index}`)
            setChapter(res.data)
        } catch {
            setChapter({ title: 'Error', html: '<p>Failed to load chapter.</p>', index, total: 0 })
        }
        setLoading(false)
    }

    // ??? Measure & re-align using scroll-snap ???
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
        setChapterTotalPages(pages)
        const clamped = Math.max(0, Math.min(idxFromScroll, pages - 1))
        scroller.scrollTo({ left: Math.round(clamped * step), behavior: 'auto' })
        setChapterPage(prev => (prev === clamped ? prev : clamped))
    }, [isSpread, setChapterPage])

    // Synchronous measurement
    useLayoutEffect(() => {
        if (!loading && chapter) measure()
    }, [loading, chapter, measure, settings.fontSize, settings.font,
        layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing, sidebarOpen])

    // Deferred measurement
    useEffect(() => {
        if (!loading && chapter) {
            const t = setTimeout(measure, 250)
            return () => clearTimeout(t)
        }
    }, [loading, chapter, measure, settings.fontSize, settings.font,
        layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing, sidebarOpen])

    // Window resize
    useEffect(() => {
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [measure])

    // ResizeObserver on FRAME
    useEffect(() => {
        const frame = frameRef.current
        if (!frame || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(() => measure())
        ro.observe(frame)
        return () => ro.disconnect()
    }, [measure])

    // ??? Navigation via scrollTo ???
    const goToPage = useCallback((page) => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const target = Math.max(0, Math.min(page, chapterTotalPages - 1))
        const W = scroller.clientWidth
        const contentStyle = getComputedStyle(contentEl)
        const rawGap = contentStyle.columnGap
        const fallbackGap = parseFloat(contentStyle.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap
        if (step <= 0) return
        stepRef.current = step
        const targetLeft = Math.round(target * step)
        console.log('[EpubReader] goToPage:', target, 'W:', W, 'gap:', gap, 'step:', step, 'scrollWidth:', scroller.scrollWidth, 'targetLeft:', targetLeft)
        scroller.scrollTo({ left: targetLeft, behavior: 'smooth' })
        setChapterPage(target)
    }, [chapterTotalPages])

    // Drive scroll whenever chapterPage changes
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
        scroller.scrollTo({ left: Math.round(chapterPage * step), behavior: 'smooth' })
    }, [chapterPage])

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
                const clamped = Math.max(0, Math.min(snapIndex, chapterTotalPages - 1))
                setChapterPage(prev => (prev === clamped ? prev : clamped))
            }, 120)
        }
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            if (timer) clearTimeout(timer)
            scroller.removeEventListener('scroll', onScroll)
        }
    }, [chapterTotalPages])

    const goNext = useCallback(() => {
        if (chapterPage < chapterTotalPages - 1) {
            goToPage(chapterPage + 1)
        } else if (chapter && chapterIndex < chapter.total - 1) {
            loadChapter(chapterIndex + 1)
        }
    }, [chapterPage, chapterTotalPages, chapter, chapterIndex, goToPage])

    const goPrev = useCallback(() => {
        if (chapterPage > 0) {
            goToPage(chapterPage - 1)
        } else if (chapterIndex > 0) {
            loadChapter(chapterIndex - 1)
        }
    }, [chapterPage, chapterIndex, goToPage])

    const seekToBookProgress = useCallback((nextProgress) => {
        if (totalChapters <= 1) return
        const target = Math.round(nextProgress * (totalChapters - 1))
        if (target !== chapterIndex) loadChapter(target)
    }, [chapterIndex, totalChapters])

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

            {/* ?? Header ?? */}
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
                        style={{ color: themeStyle.text }}>EPUB</span>
                    <span className="text-sm opacity-60 truncate max-w-[18rem]" style={{ color: themeStyle.text }}>
                        {bookTitle}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={addBookmark} title={tt('bookmark')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                        style={{ color: themeStyle.text }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                    </button>
                    <button onClick={() => setSidebarOpen(o => !o)} title={tt('toc')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                        style={{ color: themeStyle.text }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg>
                    </button>
                    <ReaderToolbar settings={settings} />
                </div>
            </div>

            {/* ?? Bookmarks ?? */}
            {bookmarks.length > 0 && (
                <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto"
                    style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                    <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0"
                        style={{ color: themeStyle.text }}>{tt('bookmarks')}</span>
                    {bookmarks.map(b => (
                        <button key={b.position} onClick={() => { goToBookmark(b.position); loadChapter(b.position) }}
                            className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0"
                            style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
                            {tt('chapter')} {b.position + 1}
                            <span onClick={(e) => { e.stopPropagation(); removeBookmark(b.position) }}
                                className="ml-1.5 opacity-30 hover:opacity-100 cursor-pointer">횞</span>
                        </button>
                    ))}
                </div>
            )}

            {/* ?? Body ?? */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* TOC Sidebar */}
                {sidebarOpen && (
                    <div className="w-56 shrink-0 overflow-y-auto py-4 px-3"
                        style={{ borderRight: `1px solid ${themeStyle.border}`, backgroundColor: themeStyle.card }}>
                        <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-3 px-2"
                            style={{ color: themeStyle.text }}>{tt('contents')}</h3>
                        <div className="space-y-0.5">
                            {toc.map(item => (
                                <button key={item.index} onClick={() => loadChapter(item.index)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-all
                                        ${chapterIndex === item.index ? 'font-medium' : 'opacity-50 hover:opacity-100'}`}
                                    style={{
                                        color: themeStyle.text,
                                        backgroundColor: chapterIndex === item.index ? themeStyle.border : 'transparent',
                                    }}>
                                    {item.title}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reading Area */}
                <div className="flex-1 relative min-h-0">
                    {/* Hover arrows */}
                    <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300"
                        onClick={goPrev}>
                        {(chapterPage > 0 || chapterIndex > 0) && (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md"
                                style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                            </div>
                        )}
                    </div>
                    <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300"
                        onClick={goNext}>
                        {(chapterPage < chapterTotalPages - 1 || (chapter && chapterIndex < chapter.total - 1)) && (
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

                    {/* LAYER 1: STATIONARY FRAME */}
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
                                <div className="animate-spin text-4xl">...</div>
                            </div>
                        ) : chapter ? (
                            /* LAYER 2: SNAP-SCROLL VIEWPORT */
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
                                {/* LAYER 3: CONTENT BOX */}
                                <div
                                    ref={contentRef}
                                    className="select-text epubContent
                                        [&_p]:mb-4 [&_p]:break-inside-avoid
                                        [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-5 [&_h1]:break-after-avoid
                                        [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-4 [&_h2]:break-after-avoid
                                        [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mb-3 [&_h3]:break-after-avoid
                                        [&_img]:max-w-full [&_img]:max-h-[50vh] [&_img]:rounded-lg [&_img]:mx-auto [&_img]:my-4 [&_img]:break-inside-avoid
                                        [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:opacity-80 [&_blockquote]:break-inside-avoid"
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
                                        columnCount: isSpread ? 2 : 1,
                                        columnGap: `${columnGap}px`,
                                        columnFill: 'auto',
                                        columnRule: isSpread ? '1px solid transparent' : 'none',
                                        breakInside: 'avoid-column',
                                    }}
                                    dangerouslySetInnerHTML={{ __html: chapter.html }}
                                />
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* ?? Bottom Bar ?? */}
            {chapter && (
                <ReaderProgressBar
                    currentPage={chapterIndex + 1}
                    totalPages={null}
                    progress={totalChapters > 1 ? chapterIndex / (totalChapters - 1) : 0}
                    onSeekProgress={seekToBookProgress}
                    extraInfo={`${tt('chapter')} ${chapterIndex + 1}/${chapter?.total || '?'}  |  ${chapterPage + 1}/${chapterTotalPages}`}
                />
            )}

            <ResumeToast resumePrompt={resumePrompt}
                onResume={() => { resumeReading(); if (resumePrompt) loadChapter(resumePrompt.position) }}
                onDismiss={dismissResume} tt={tt} />
        </div>
    )
}

export default EpubReader



