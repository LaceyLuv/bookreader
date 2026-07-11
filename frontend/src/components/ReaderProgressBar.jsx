import { useEffect, useMemo, useRef, useState } from 'react'

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}

function restoreReaderFocus(readerFocusRef) {
    const target = readerFocusRef?.current
    if (!(target instanceof HTMLElement)) return
    window.queueMicrotask(() => {
        target.focus({ preventScroll: true })
    })
}

function releaseControlFocus(event, readerFocusRef) {
    const control = event?.currentTarget
    if (control instanceof HTMLElement) {
        control.blur()
    }
    restoreReaderFocus(readerFocusRef)
}

function ReaderProgressBar({
    currentPage = 1,
    totalPages = null,
    onSeekPage,
    progress = 0,
    onSeekProgress,
    extraInfo = '',
    readerFocusRef = null,
    onVisibilityChange,
}) {
    const hasTotalPages = Number.isFinite(totalPages) && totalPages > 0
    const canSeekPage = hasTotalPages && typeof onSeekPage === 'function'
    const canSeekProgress = typeof onSeekProgress === 'function'

    const normalizedProgress = useMemo(() => clamp(progress || 0, 0, 1), [progress])
    const [draftProgress, setDraftProgress] = useState(normalizedProgress)
    const [isDragging, setIsDragging] = useState(false)
    const lastCommittedProgressRef = useRef(null)
    const pointerFocusGuardRef = useRef(false)
    const lastPointerInteractionAtRef = useRef(0)

    const [pageInput, setPageInput] = useState(String(currentPage))
    const [isEditingPage, setIsEditingPage] = useState(false)
    const skipPageCommitRef = useRef(false)
    const pageInputRef = useRef(null)
    const [isCollapsed, setIsCollapsed] = useState(false)

    useEffect(() => {
        const handleProgressShortcut = (event) => {
            const target = event.target
            const isEditing = target instanceof HTMLElement
                && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
            const isHKey = event.code === 'KeyH' || event.key?.toLowerCase() === 'h' || event.key === 'ㅗ'
            if (!event.ctrlKey || event.altKey || event.metaKey || !isHKey || isEditing) return

            event.preventDefault()
            const nextCollapsed = !isCollapsed
            setIsCollapsed(nextCollapsed)
            onVisibilityChange?.(!nextCollapsed)
            restoreReaderFocus(readerFocusRef)
        }

        window.addEventListener('keydown', handleProgressShortcut)
        return () => window.removeEventListener('keydown', handleProgressShortcut)
    }, [isCollapsed, onVisibilityChange, readerFocusRef])

    useEffect(() => {
        if (!isDragging) setDraftProgress(normalizedProgress)
    }, [normalizedProgress, isDragging])

    useEffect(() => {
        if (!isEditingPage) setPageInput(String(currentPage))
    }, [currentPage, isEditingPage])

    useEffect(() => {
        if (!isEditingPage) return
        pageInputRef.current?.focus()
        pageInputRef.current?.select()
    }, [isEditingPage])

    const markPointerInteraction = () => {
        pointerFocusGuardRef.current = true
        lastPointerInteractionAtRef.current = Date.now()
    }

    const releasePointerGuard = () => {
        window.queueMicrotask(() => {
            pointerFocusGuardRef.current = false
        })
    }

    const handleControlFocus = () => {
        if (!pointerFocusGuardRef.current) return
        restoreReaderFocus(readerFocusRef)
        releasePointerGuard()
    }

    const handleControlKeyDown = (event) => {
        const key = event.key === ' ' ? 'Space' : event.key
        if (key !== 'Space' && key !== 'Enter') return
        if (Date.now() - lastPointerInteractionAtRef.current > 1500) return
        event.preventDefault()
        event.stopPropagation()
        releaseControlFocus(event, readerFocusRef)
    }

    const commitProgressSeek = () => {
        if (!canSeekProgress) return
        const value = clamp(draftProgress, 0, 1)
        if (lastCommittedProgressRef.current === value) return
        lastCommittedProgressRef.current = value
        onSeekProgress(value)
        restoreReaderFocus(readerFocusRef)
    }

    const commitPageSeek = () => {
        if (!canSeekPage) return
        const parsed = Number.parseInt(pageInput, 10)
        if (!Number.isFinite(parsed)) {
            setPageInput(String(currentPage))
            return
        }
        const clamped = clamp(parsed, 1, totalPages)
        setPageInput(String(clamped))
        if (clamped !== currentPage) onSeekPage(clamped)
        restoreReaderFocus(readerFocusRef)
    }

    const cancelPageSeek = () => {
        skipPageCommitRef.current = true
        setPageInput(String(currentPage))
        setIsEditingPage(false)
        restoreReaderFocus(readerFocusRef)
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
                    title="Show progress bar (Ctrl+H)"
                    aria-label="Show progress bar"
                    data-reader-progress-control="true"
                    onPointerDown={markPointerInteraction}
                    onFocus={handleControlFocus}
                    onKeyDown={handleControlKeyDown}
                    onClick={(event) => {
                        setIsCollapsed(false)
                        onVisibilityChange?.(true)
                        releaseControlFocus(event, readerFocusRef)
                    }}
                    className="reader-progress-expand absolute bottom-0 left-4 z-10 h-7 w-7 rounded-t-md border border-b-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
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
        <div className="reader-progress relative shrink-0" style={{ borderTop: '1px solid var(--panel-border)' }}>
            <button
                type="button"
                title="Hide progress bar (Ctrl+H)"
                aria-label="Hide progress bar"
                data-reader-progress-control="true"
                onPointerDown={markPointerInteraction}
                onFocus={handleControlFocus}
                onKeyDown={handleControlKeyDown}
                onClick={(event) => {
                    setIsCollapsed(true)
                    onVisibilityChange?.(false)
                    releaseControlFocus(event, readerFocusRef)
                }}
                className="reader-progress-collapse absolute left-4 top-1/2 z-10 h-7 w-7 -translate-y-1/2 rounded-md"
                style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--panel-border)', color: 'var(--reader-page-fg)' }}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="mx-auto">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            <div className="reader-progress-inner" style={{ backgroundColor: 'var(--panel-bg)' }}>
                <div className="reader-progress-summary tabular-nums">
                    <span aria-hidden="true" />
                    <div className="reader-progress-pages">
                        {isEditingPage ? (
                            <span className="reader-progress-page-editor">
                                <input
                                    ref={pageInputRef}
                                    type="number"
                                    min={1}
                                    max={hasTotalPages ? totalPages : undefined}
                                    aria-label="Page number"
                                    data-reader-progress-control="true"
                                    value={hasTotalPages ? pageInput : ''}
                                    disabled={!canSeekPage}
                                    placeholder="?"
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') event.currentTarget.blur()
                                        else if (event.key === 'Escape') {
                                            event.preventDefault()
                                            cancelPageSeek()
                                        }
                                    }}
                                    onBlur={() => {
                                        setIsEditingPage(false)
                                        if (skipPageCommitRef.current) {
                                            skipPageCommitRef.current = false
                                            return
                                        }
                                        commitPageSeek()
                                    }}
                                    onChange={(event) => setPageInput(event.target.value)}
                                />
                                <span>/ {maxPageText}</span>
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="reader-progress-page-button"
                                aria-label="Edit page number"
                                disabled={!canSeekPage}
                                onClick={() => setIsEditingPage(true)}
                            >
                                {previewPage} / {maxPageText}
                            </button>
                        )}
                    </div>
                    <span className="reader-progress-percent">{previewPercent}%</span>
                </div>

                <input
                    type="range" min={0} max={100}
                    data-reader-progress-control="true"
                    value={Math.round(draftProgress * 100)}
                    onInput={handleRangeInput}
                    onChange={commitProgressSeek}
                    onFocus={handleControlFocus}
                    onKeyDown={handleControlKeyDown}
                    onPointerDown={() => {
                        markPointerInteraction()
                        setIsDragging(true)
                        lastCommittedProgressRef.current = null
                    }}
                    onPointerUp={(event) => {
                        setIsDragging(false)
                        commitProgressSeek()
                        releaseControlFocus(event, readerFocusRef)
                    }}
                    onMouseUp={(event) => {
                        if (!isDragging) return
                        setIsDragging(false)
                        commitProgressSeek()
                        releaseControlFocus(event, readerFocusRef)
                    }}
                    onTouchEnd={(event) => {
                        if (!isDragging) return
                        setIsDragging(false)
                        commitProgressSeek()
                        releaseControlFocus(event, readerFocusRef)
                    }}
                    className="reader-progress-range w-full cursor-pointer"
                    style={{ accentColor: 'var(--accent)' }}
                />

            </div>
        </div>
    )
}

export default ReaderProgressBar
