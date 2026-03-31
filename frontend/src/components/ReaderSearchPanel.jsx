function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderHighlightedSnippet(snippet, query) {
    const safeSnippet = escapeHtml(snippet)
    const trimmedQuery = (query || '').trim()
    if (!trimmedQuery) return safeSnippet
    const pattern = new RegExp(trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    return safeSnippet.replace(pattern, (match) => `<mark style="background-color:rgba(92,124,250,0.24);color:inherit;padding:0 0.04em;border-radius:0.18em">${match}</mark>`)
}

function ReaderSearchPanel({
    open,
    themeStyle,
    query,
    submittedQuery = '',
    loading,
    results,
    activeIndex = null,
    onQueryChange,
    onSubmit,
    onClose,
    onResultClick,
    tt = (key) => key,
}) {
    if (!open) return null

    const trimmedQuery = query.trim()
    const trimmedSubmittedQuery = submittedQuery.trim()
    const canSubmit = Boolean(trimmedQuery) && !loading
    const hasSubmittedQuery = Boolean(trimmedSubmittedQuery)

    return (
        <div className="absolute top-4 right-4 bottom-4 z-30 w-[22rem] rounded-2xl border backdrop-blur-xl shadow-2xl overflow-hidden" style={{ backgroundColor: `${themeStyle.card}f2`, borderColor: themeStyle.border, color: themeStyle.text }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div>
                    <div className="text-[10px] uppercase tracking-widest opacity-40">{tt('search')}</div>
                    <div className="text-sm font-semibold">{tt('insideThisBook')}</div>
                </div>
                <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70" style={{ color: themeStyle.text }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
            </div>
            <form
                className="px-4 py-3"
                style={{ borderBottom: `1px solid ${themeStyle.border}` }}
                onSubmit={(event) => {
                    event.preventDefault()
                    if (canSubmit) onSubmit?.()
                }}
            >
                <div className="flex items-center gap-2">
                    <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder={tt('searchTextPlaceholder')}
                        className="h-10 min-w-0 flex-1 rounded-xl px-3 text-sm"
                        style={{ backgroundColor: 'transparent', color: themeStyle.text, border: `1px solid ${themeStyle.border}` }}
                    />
                    <button
                        type="submit"
                        disabled={!canSubmit}
                        className="h-10 shrink-0 rounded-xl px-3 text-sm font-medium transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
                        style={{ backgroundColor: themeStyle.border, color: themeStyle.text }}
                    >
                        {tt('search')}
                    </button>
                </div>
            </form>
            <div className="h-[calc(100%-7.25rem)] overflow-y-auto px-3 py-3">
                {!trimmedQuery || !hasSubmittedQuery ? (
                    <div className="px-2 py-8 text-sm opacity-50">{tt('searchEmptyPrompt')}</div>
                ) : loading ? (
                    <div className="flex justify-center py-10"><div className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" /></div>
                ) : results.length === 0 ? (
                    <div className="px-2 py-8 text-sm opacity-50">{tt('noMatchesFound')}</div>
                ) : (
                    <div className="space-y-2">
                        {results.map((result) => (
                            <button
                                key={`${result.chapter_index ?? 'txt'}-${result.chapter_match_index ?? result.index}`}
                                type="button"
                                onClick={() => onResultClick(result)}
                                className="w-full rounded-xl px-3 py-3 text-left transition-opacity hover:opacity-85"
                                style={{ backgroundColor: activeIndex === result.index ? `${themeStyle.border}` : 'transparent', border: `1px solid ${themeStyle.border}`, color: themeStyle.text }}
                            >
                                <div className="mb-1 text-[10px] uppercase tracking-widest opacity-40">
                                    {result.chapter_title || result.locator || tt('result')}
                                </div>
                                <div className="text-sm leading-6" dangerouslySetInnerHTML={{ __html: renderHighlightedSnippet(result.snippet, trimmedSubmittedQuery) }} />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default ReaderSearchPanel

