function ReaderSelectionMenu({ selection, themeStyle, onHighlight, onNote, onClear, tt = (key) => key }) {
    if (!selection?.rect) return null

    return (
        <div
            className="fixed z-40 -translate-x-1/2 rounded-2xl border px-3 py-3 shadow-2xl backdrop-blur-xl"
            style={{
                left: `${selection.rect.left}px`,
                top: `${selection.rect.top}px`,
                backgroundColor: `${themeStyle.card}f4`,
                borderColor: themeStyle.border,
                color: themeStyle.text,
            }}
        >
            <div className="mb-2 max-w-[18rem] text-[11px] leading-5 opacity-60">
                {selection.snippet}
            </div>
            <div className="flex items-center gap-2">
                <button type="button" onClick={onHighlight} className="rounded-xl px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80" style={{ backgroundColor: 'rgba(255, 212, 59, 0.2)', color: themeStyle.text }}>
                    {tt('highlight')}
                </button>
                <button type="button" onClick={onNote} className="rounded-xl px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80" style={{ backgroundColor: 'rgba(76, 201, 240, 0.18)', color: themeStyle.text }}>
                    {tt('note')}
                </button>
                <button type="button" onClick={onClear} className="rounded-xl px-3 py-1.5 text-sm transition-opacity hover:opacity-70" style={{ border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}>
                    {tt('cancel')}
                </button>
            </div>
        </div>
    )
}

export default ReaderSelectionMenu
