import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useReadingProgress } from '../hooks/useReadingProgress'
import ReaderToolbar from './ReaderToolbar'
import ReaderProgressBar from './ReaderProgressBar'
import ResumeToast from './ResumeToast'
import { API_BOOKS_BASE } from '../lib/apiBase'

const API = API_BOOKS_BASE

function removeExtraWhitespaceAndEmptyLines(text) {
    if (typeof text !== 'string' || !text) return ''
    return text
        .replace(/\r\n/g, '\n')
        // Keep a single space between words/sentences when spacing is excessive.
        .replace(/[ \t]{2,}/g, ' ')
        // Keep one empty line when multiple blank lines are present.
        .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
        // Trim trailing spaces on each line.
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
    const settings = useReaderSettings()
    const { contentStyle, themeStyle, layout, columnGap, hMargin, vMargin,
        lineHeight, letterSpacing, tt, toggleTitleBar } = settings

    const [fullText, setFullText] = useState('')
    const [encoding, setEncoding] = useState('')
    const [loading, setLoading] = useState(true)
    const [compactWhitespace, setCompactWhitespace] = useState(false)
    const [splitParagraphs, setSplitParagraphs] = useState(false)

    const [totalPages, setTotalPages] = useState(1)
    const [pageWidth, setPageWidth] = useState(0)
    const frameRef = useRef(null)
    const scrollerRef = useRef(null)
    const contentRef = useRef(null)
    const stepRef = useRef(0)

    // ─── Load content ───
    useEffect(() => {
        ; (async () => {
            try {
                const res = await fetch(`${API}/${id}/content`)
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                setFullText(data.text)
                setEncoding(data.encoding)
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
    const displayedText = useMemo(() => {
        let nextText = fullText
        if (compactWhitespace) nextText = removeExtraWhitespaceAndEmptyLines(nextText)
        if (splitParagraphs) nextText = splitDenseParagraphs(nextText)
        return nextText
    }, [fullText, compactWhitespace, splitParagraphs])

    // ─── Measure & re-align ───
    const measure = useCallback(() => {
        const scroller = scrollerRef.current
        const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const W = scroller.clientWidth
        const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap
        const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const colW = isSpread ? Math.max(1, Math.floor((W - gap) / 2)) : Math.max(1, Math.floor(W))
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

    useLayoutEffect(() => { if (!loading && displayedText) measure() }, [loading, displayedText, measure, settings.fontSize, settings.font, layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing])
    useEffect(() => { if (!loading && displayedText) { const t = setTimeout(measure, 250); return () => clearTimeout(t) } }, [loading, displayedText, measure, settings.fontSize, settings.font, layout, columnGap, hMargin, vMargin, lineHeight, letterSpacing])
    useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure) }, [measure])
    useEffect(() => { const frame = frameRef.current; if (!frame || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(() => measure()); ro.observe(frame); return () => ro.disconnect() }, [measure])

    // ─── Navigation via scrollTo ───
    const goToPage = useCallback((page) => {
        const scroller = scrollerRef.current; const contentEl = contentRef.current
        if (!scroller || !contentEl) return
        const target = Math.max(0, Math.min(page, totalPages - 1))
        const W = scroller.clientWidth; const cs = getComputedStyle(contentEl)
        const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16
        const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0)
        const step = W + gap; if (step <= 0) return; stepRef.current = step
        scroller.scrollTo({ left: Math.round(target * step), behavior: 'auto' })
        setCurrentPage(target)
    }, [totalPages])

    useEffect(() => { const s = scrollerRef.current; const c = contentRef.current; if (!s || !c) return; const W = s.clientWidth; const cs = getComputedStyle(c); const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16; const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0); const step = W + gap; if (step <= 0) return; stepRef.current = step; s.scrollTo({ left: Math.round(currentPage * step), behavior: 'auto' }) }, [currentPage])

    useEffect(() => {
        const s = scrollerRef.current; const c = contentRef.current; if (!s || !c) return; let timer = null
        const onScroll = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { const W = s.clientWidth; const cs = getComputedStyle(c); const rawGap = cs.columnGap; const fallbackGap = parseFloat(cs.fontSize) || 16; const gap = rawGap === 'normal' ? fallbackGap : (parseFloat(rawGap) || 0); const step = W + gap; if (step <= 0) return; stepRef.current = step; const idx = Math.round(s.scrollLeft / step); const snapLeft = Math.round(idx * step); if (Math.abs(s.scrollLeft - snapLeft) >= 1) s.scrollTo({ left: snapLeft, behavior: 'auto' }); const clamped = Math.max(0, Math.min(idx, totalPages - 1)); setCurrentPage(prev => (prev === clamped ? prev : clamped)) }, 120) }
        s.addEventListener('scroll', onScroll, { passive: true }); return () => { if (timer) clearTimeout(timer); s.removeEventListener('scroll', onScroll) }
    }, [totalPages])

    const goNext = useCallback(() => { if (currentPage < totalPages - 1) goToPage(currentPage + 1) }, [currentPage, totalPages, goToPage])
    const goPrev = useCallback(() => { if (currentPage > 0) goToPage(currentPage - 1) }, [currentPage, goToPage])
    const seekToProgress = useCallback((p) => { if (totalPages <= 1) return; goToPage(Math.round(p * (totalPages - 1))) }, [totalPages, goToPage])

    useKeyboardNav({ onNext: goNext, onPrev: goPrev, onEscape: toggleTitleBar, enabled: true })

    return (
        <div className="readerRoot h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden"
            style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)', transition: 'background-color 0.3s, color 0.3s' }}>

            <div className="shrink-0 flex items-center justify-between px-6 py-2.5" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate('/')} title={tt('backToLibrary')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
                    <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest opacity-40" style={{ color: themeStyle.text }}>TXT</span>
                    {encoding && <span className="text-[11px] opacity-30" style={{ color: themeStyle.text }}>· {encoding}</span>}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={addBookmark} title={tt('addBookmark')} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60" style={{ color: themeStyle.text }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></button>
                    <ReaderToolbar settings={settings} readerType="txt" />
                </div>
            </div>

            <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <button
                    onClick={() => setCompactWhitespace((v) => !v)}
                    className="px-2.5 py-1 rounded text-[11px] border transition-all"
                    style={{
                        borderColor: compactWhitespace ? 'var(--accent)' : themeStyle.border,
                        color: themeStyle.text,
                        backgroundColor: compactWhitespace ? themeStyle.border : 'transparent',
                    }}
                >
                    공백, 빈줄 제거
                </button>
                <button
                    onClick={() => setSplitParagraphs((v) => !v)}
                    className="px-2.5 py-1 rounded text-[11px] border transition-all"
                    style={{
                        borderColor: splitParagraphs ? 'var(--accent)' : themeStyle.border,
                        color: themeStyle.text,
                        backgroundColor: splitParagraphs ? themeStyle.border : 'transparent',
                    }}
                >
                    문단 나누기
                </button>
            </div>

            {bookmarks.length > 0 && (
                <div className="shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                    <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0" style={{ color: themeStyle.text }}>{tt('bookmarks')}</span>
                    {bookmarks.map(b => (
                        <button key={b.position} onClick={() => goToBookmark(b.position)} className="px-2 py-0.5 rounded text-[11px] border transition-all hover:opacity-70 shrink-0" style={{ borderColor: themeStyle.border, color: themeStyle.text }}>
                            {b.label}<span onClick={(e) => { e.stopPropagation(); removeBookmark(b.position) }} className="ml-1.5 opacity-30 hover:opacity-100 cursor-pointer">×</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 relative min-h-0">
                <div className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goPrev}>{currentPage > 0 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg></div>)}</div>
                <div className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 transition-opacity duration-300" onClick={goNext}>{currentPage < totalPages - 1 && (<div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: `${themeStyle.card}cc`, border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>)}</div>

                {layout === 'dual' && (<div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-8 z-10 pointer-events-none" style={{ background: `linear-gradient(to right, transparent, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 45%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)'} 50%, ${themeStyle.bg === '#1a1b1e' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)'} 55%, transparent)` }} />)}

                <div ref={frameRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: `${vMargin}px ${hMargin}px`, boxSizing: 'border-box' }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                        </div>
                    ) : (
                        <div ref={scrollerRef} className="reader-scroller" style={{ position: 'relative', width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'none', scrollbarGutter: 'stable' }}>
                            <div ref={contentRef} className="select-text" style={{ height: '100%', boxSizing: 'border-box', display: 'block', backgroundColor: 'var(--reader-page-bg)', color: 'var(--reader-page-fg)', fontFamily: contentStyle.fontFamily, fontWeight: contentStyle.fontWeight, fontSize: contentStyle.fontSize, lineHeight: `${lineHeight}`, letterSpacing: `${letterSpacing}em`, textAlign: 'left', hyphens: 'auto', WebkitHyphens: 'auto', wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'pre-wrap', columnCount: isSpread ? 2 : 1, columnGap: `${columnGap}px`, columnFill: 'auto', columnRule: isSpread ? '1px solid transparent' : 'none', breakInside: 'avoid-column' }}>
                                {displayedText}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ReaderProgressBar currentPage={currentPage + 1} totalPages={totalPages} onSeekPage={(p) => goToPage(p - 1)} progress={totalPages > 1 ? currentPage / (totalPages - 1) : 0} onSeekProgress={seekToProgress} extraInfo={`TXT  ${currentPage + 1}/${totalPages}`} />
            <ResumeToast resumePrompt={resumePrompt} onResume={resumeReading} onDismiss={dismissResume} tt={tt} />
        </div>
    )
}

export default TxtReader
