import { useEffect, useMemo, useRef, useState } from 'react'

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}

function ReaderProgressBar({
    currentPage = 1,
    totalPages = null,
    onSeekPage,
    progress = 0,
    onSeekProgress,
    extraInfo = '',
}) {
    const hasTotalPages = Number.isFinite(totalPages) && totalPages > 0
    const canSeekPage = hasTotalPages && typeof onSeekPage === 'function'
    const canSeekProgress = typeof onSeekProgress === 'function'

    const normalizedProgress = useMemo(() => clamp(progress || 0, 0, 1), [progress])
    const [draftProgress, setDraftProgress] = useState(normalizedProgress)
    const [isDragging, setIsDragging] = useState(false)
    const lastCommittedProgressRef = useRef(null)

    const [pageInput, setPageInput] = useState(String(currentPage))
    const [isEditingPage, setIsEditingPage] = useState(false)
    const skipPageCommitRef = useRef(false)
    const [isCollapsed, setIsCollapsed] = useState(false)

    useEffect(() => {
        if (!isDragging) setDraftProgress(normalizedProgress)
    }, [normalizedProgress, isDragging])

    useEffect(() => {
        if (!isEditingPage) setPageInput(String(currentPage))
    }, [currentPage, isEditingPage])

    const commitProgressSeek = () => {
        if (!canSeekProgress) return
        const value = clamp(draftProgress, 0, 1)
        if (lastCommittedProgressRef.current === value) return
        lastCommittedProgressRef.current = value
        onSeekProgress(value)
    }

    const commitPageSeek = () => {
        if (!canSeekPage) return
        const parsed = Number.parseInt(pageInput, 10)
        if (!Number.isFinite(parsed)) { setPageInput(String(currentPage)); return }
        const clamped = clamp(parsed, 1, totalPages)
        setPageInput(String(clamped))
        if (clamped !== currentPage) onSeekPage(clamped)
    }

    const handleRangeInput = (e) => {
        const raw = Number(e.target.value)
        if (!Number.isFinite(raw)) return
        setDraftProgress(clamp(raw / 100, 0, 1))
    }

    const previewPage = hasTotalPages ? clamp(Math.round(draftProgress * (totalPages - 1)) + 1, 1, totalPages) : '?'
    const previewPercent = Math.round(draftProgress * 100)
    const maxPageText = hasTotalPages ? totalPages : '?'

    if (isCollapsed) {
        return (
            <div className="group relative shrink-0 h-3" style={{ borderTop: '1px solid var(--panel-border)' }}>
                <button
                    type="button"
                    title="Show progress bar"
                    aria-label="Show progress bar"
                    onClick={() => setIsCollapsed(false)}
                    className="absolute left-1/2 bottom-0 z-10 h-5 w-10 -translate-x-1/2 rounded-t-md border border-b-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--panel-border)', color: 'var(--reader-page-fg)' }}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="mx-auto">
                        <path d="M6 15l6-6 6 6" />
                    </svg>
                </button>
            </div>
        )
    }

    return (
        <div className="relative shrink-0 px-4 py-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
            <button
                type="button"
                title="Hide progress bar"
                aria-label="Hide progress bar"
                onClick={() => setIsCollapsed(true)}
                className="absolute left-1/2 top-0 z-10 h-5 w-10 -translate-x-1/2 -translate-y-[55%] rounded-t-md border border-b-0"
                style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--panel-border)', color: 'var(--reader-page-fg)' }}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="mx-auto">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            <div className="mx-auto w-full max-w-4xl rounded-lg border px-3 py-1.5 shadow-sm"
                style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--panel-border)' }}>
                <div className="mb-1 flex items-center justify-between text-[10px] tabular-nums opacity-80">
                    <span>{previewPage} / {maxPageText}</span>
                    <span>{previewPercent}%</span>
                </div>

                <input
                    type="range" min={0} max={100}
                    value={Math.round(draftProgress * 100)}
                    onInput={handleRangeInput}
                    onChange={commitProgressSeek}
                    onPointerDown={() => { setIsDragging(true); lastCommittedProgressRef.current = null }}
                    onPointerUp={() => { setIsDragging(false); commitProgressSeek() }}
                    onMouseUp={() => { if (!isDragging) return; setIsDragging(false); commitProgressSeek() }}
                    onTouchEnd={() => { if (!isDragging) return; setIsDragging(false); commitProgressSeek() }}
                    className="h-2 w-full cursor-pointer"
                    style={{ accentColor: 'var(--accent)' }}
                />

                <div className="mt-1.5 flex items-center justify-between">
                    <div className="text-[10px] opacity-55 truncate pr-2">{extraInfo}</div>
                    <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
                        <input
                            type="number" min={1} max={hasTotalPages ? totalPages : undefined}
                            value={hasTotalPages ? pageInput : ''} disabled={!canSeekPage} placeholder="?"
                            onFocus={() => setIsEditingPage(true)}
                            onBlur={() => {
                                setIsEditingPage(false)
                                if (skipPageCommitRef.current) { skipPageCommitRef.current = false; return }
                                commitPageSeek()
                            }}
                            onChange={(e) => setPageInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                else if (e.key === 'Escape') {
                                    e.preventDefault(); skipPageCommitRef.current = true
                                    setPageInput(String(currentPage)); setIsEditingPage(false); e.currentTarget.blur()
                                }
                            }}
                            className="w-14 rounded-md border px-2 py-0.5 text-right leading-none outline-none disabled:opacity-40"
                            style={{ borderColor: 'var(--panel-border)', backgroundColor: 'color-mix(in srgb, var(--panel-bg) 85%, transparent)', color: 'var(--reader-page-fg)' }}
                        />
                        <span className="opacity-55">/ {maxPageText}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ReaderProgressBar
