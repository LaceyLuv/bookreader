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

    return (
        <div className="shrink-0 px-4 py-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
            <div className="mx-auto w-full max-w-4xl rounded-xl border px-3 py-2.5 shadow-sm"
                style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--panel-border)' }}>
                <div className="mb-2 flex items-center justify-between text-[11px] tabular-nums opacity-80">
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
                    className="h-3 w-full cursor-pointer"
                    style={{ accentColor: 'var(--accent)' }}
                />

                <div className="mt-2 flex items-center justify-between">
                    <div className="text-[11px] opacity-55 truncate pr-2">{extraInfo}</div>
                    <div className="flex items-center gap-1.5 text-[12px] tabular-nums">
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
                            className="w-16 rounded-md border px-2 py-1 text-right leading-none outline-none disabled:opacity-40"
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
