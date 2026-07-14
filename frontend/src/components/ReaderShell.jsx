function ReaderShell({
    rootRef,
    topBar = null,
    notice = null,
    bookmarkBar = null,
    sidePanel = null,
    main,
    bottom = null,
    overlays = null,
    tail = null,
}) {
    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            className="readerRoot reader-shell relative h-[calc(100vh-var(--titlebar-height,0px))] flex flex-col overflow-hidden"
            style={{
                backgroundColor: 'var(--app-bg)',
                color: 'var(--app-fg)',
                transition: 'background-color 0.3s, color 0.3s',
            }}
        >
            {topBar}
            {notice}
            <div className="reader-shell-body relative flex min-h-0 flex-1 overflow-hidden">
                <div className="reader-shell-reading relative flex min-w-0 flex-1 flex-col">
                    {bookmarkBar && (
                        <div className="reader-shell-bookmark-overlay absolute inset-x-0 top-0 z-20">
                            {bookmarkBar}
                        </div>
                    )}
                    {main}
                    {bottom}
                </div>
                {sidePanel}
            </div>
            {overlays}
            {tail}
        </div>
    )
}

function ReaderTopBar({
    themeStyle,
    backLabel,
    onBack,
    meta = null,
    actions = null,
}) {
    return (
        <div
            className="reader-ui reader-topbar shrink-0 flex items-center justify-between"
            style={{ borderBottom: `1px solid ${themeStyle.border}` }}
        >
            <div className="reader-topbar-meta flex items-center gap-3">
                <button
                    type="button"
                    onClick={onBack}
                    title={backLabel}
                    aria-label={backLabel}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-60"
                    style={{ color: themeStyle.text }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
                <div className="h-5 w-px opacity-20" style={{ backgroundColor: themeStyle.text }} />
                {meta}
            </div>
            <div data-tauri-drag-region className="min-w-4 flex-1 self-stretch" aria-hidden="true" />
            <div className="reader-topbar-actions flex items-center gap-2">
                {actions}
            </div>
        </div>
    )
}

function ReaderPageTurnControls({
    themeStyle,
    showPrev,
    showNext,
    onPrev,
    onNext,
    previousLabel = 'Previous',
    nextLabel = 'Next',
}) {
    const controlStyle = {
        backgroundColor: `${themeStyle.card}cc`,
        border: `1px solid ${themeStyle.border}`,
        color: themeStyle.text,
    }

    return (
        <>
            <button
                type="button"
                aria-label={previousLabel}
                disabled={!showPrev}
                data-testid="reader-prev-control"
                className="absolute inset-y-0 left-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300 disabled:pointer-events-none"
                onClick={onPrev}
            >
                {showPrev && (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={controlStyle}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                    </div>
                )}
            </button>
            <button
                type="button"
                aria-label={nextLabel}
                disabled={!showNext}
                data-testid="reader-next-control"
                className="absolute inset-y-0 right-0 w-16 z-20 flex items-center justify-center cursor-pointer opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300 disabled:pointer-events-none"
                onClick={onNext}
            >
                {showNext && (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md" style={controlStyle}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                    </div>
                )}
            </button>
        </>
    )
}

function ReaderBookmarkStrip({
    items = [],
    label,
    themeStyle,
    getItemKey = (item) => item?.id ?? item?.savedAt ?? item?.position,
    getLabel = (item) => item?.label ?? '',
    onActivate,
    onRemove,
    removeLabel = 'Remove bookmark',
    className = '',
}) {
    if (items.length === 0) return null

    return (
        <div
            className={`${className} shrink-0 px-6 py-1.5 flex items-center gap-2 overflow-x-auto`.trim()}
            style={{ borderBottom: `1px solid ${themeStyle.border}` }}
        >
            <span className="text-[10px] uppercase tracking-widest opacity-30 shrink-0" style={{ color: themeStyle.text }}>
                {label}
            </span>
            {items.map((item) => {
                const itemLabel = getLabel(item)
                const accessibleItemLabel = typeof itemLabel === 'string' || typeof itemLabel === 'number'
                    ? String(itemLabel)
                    : undefined
                return (
                    <div
                        key={getItemKey(item)}
                        className="flex shrink-0 items-center overflow-hidden rounded border text-[11px] transition-all hover:opacity-70"
                        style={{ borderColor: themeStyle.border, color: themeStyle.text }}
                    >
                        <button
                            type="button"
                            aria-label={accessibleItemLabel}
                            onClick={() => onActivate?.(item)}
                            className="py-0.5 pl-2"
                        >
                            {itemLabel}
                        </button>
                        <button
                            type="button"
                            aria-label={accessibleItemLabel ? `${removeLabel}: ${accessibleItemLabel}` : removeLabel}
                            onClick={(event) => {
                                event.stopPropagation()
                                onRemove?.(item)
                            }}
                            className="py-0.5 pl-1.5 pr-2 opacity-30 hover:opacity-100"
                        >
                            ×
                        </button>
                    </div>
                )
            })}
        </div>
    )
}

function ReaderNoticeBar({ themeStyle, message, issues = [] }) {
    const codes = issues.map((issue) => issue?.code).filter(Boolean)
    if (codes.length === 0) return null

    return (
        <div
            role="status"
            aria-live="polite"
            className="reader-ui shrink-0 border-b px-6 py-2 text-xs"
            style={{
                borderColor: themeStyle.border,
                color: themeStyle.text,
                backgroundColor: themeStyle.card,
            }}
        >
            {message} · {codes.join(', ')}
        </div>
    )
}

export {
    ReaderBookmarkStrip,
    ReaderNoticeBar,
    ReaderPageTurnControls,
    ReaderTopBar,
}

export default ReaderShell
