import { useMemo, useState } from 'react'

function formatLocation(annotation, tt, lang) {
    if (annotation.chapter_title) {
        if (annotation.page != null) {
            return lang === 'ko'
                ? `${annotation.chapter_title} · ${annotation.page + 1}${tt('page')}`
                : `${annotation.chapter_title} · ${tt('page')} ${annotation.page + 1}`
        }
        return annotation.chapter_title
    }
    if (annotation.chapter_index != null) {
        if (annotation.page != null) {
            return lang === 'ko'
                ? `${annotation.chapter_index + 1}${tt('chapter')} · ${annotation.page + 1}${tt('page')}`
                : `Chapter ${annotation.chapter_index + 1} · ${tt('page')} ${annotation.page + 1}`
        }
        return lang === 'ko'
            ? `${annotation.chapter_index + 1}${tt('chapter')}`
            : `Chapter ${annotation.chapter_index + 1}`
    }
    if (annotation.page != null) {
        return lang === 'ko'
            ? `${annotation.page + 1}${tt('page')}`
            : `${tt('page')} ${annotation.page + 1}`
    }
    return annotation.locator || tt('savedLocation')
}

function getVisibleAnnotations(annotations, filterValue) {
    if (filterValue === 'all') return annotations
    return annotations.filter((annotation) => annotation.kind === filterValue)
}

function ReaderAnnotationsPanel({
    open,
    themeStyle,
    loading,
    annotations,
    activeAnnotationId,
    onClose,
    onItemClick,
    onDeleteItem,
    onEditItem,
    onColorItem,
    tt = (key) => key,
    lang = 'en',
}) {
    const [filterValue, setFilterValue] = useState('all')

    const visibleAnnotations = useMemo(
        () => getVisibleAnnotations(annotations, filterValue),
        [annotations, filterValue],
    )

    if (!open) return null

    const filterChipStyle = (value) => ({
        border: `1px solid ${themeStyle.border}`,
        color: value === filterValue ? '#5c7cfa' : themeStyle.text,
        backgroundColor: value === filterValue ? `${themeStyle.border}` : 'transparent',
    })

    return (
        <div className="absolute top-4 right-4 bottom-4 z-30 w-[22rem] rounded-2xl border backdrop-blur-xl shadow-2xl overflow-hidden" style={{ backgroundColor: `${themeStyle.card}f2`, borderColor: themeStyle.border, color: themeStyle.text }}>
            <div className="px-4 py-3" style={{ borderBottom: `1px solid ${themeStyle.border}` }}>
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <div className="text-[10px] uppercase tracking-widest opacity-40">{tt('annotations')}</div>
                        <div className="text-sm font-semibold">{tt('notesAndHighlights')}</div>
                    </div>
                    <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70" style={{ color: themeStyle.text }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                    <button type="button" onClick={() => setFilterValue('all')} className="rounded-full px-3 py-1 transition-opacity hover:opacity-80" style={filterChipStyle('all')}>{tt('all')}</button>
                    <button type="button" onClick={() => setFilterValue('highlight')} className="rounded-full px-3 py-1 transition-opacity hover:opacity-80" style={filterChipStyle('highlight')}>{tt('highlights')}</button>
                    <button type="button" onClick={() => setFilterValue('note')} className="rounded-full px-3 py-1 transition-opacity hover:opacity-80" style={filterChipStyle('note')}>{tt('notes')}</button>
                </div>
            </div>
            <div className="h-[calc(100%-6.75rem)] overflow-y-auto px-3 py-3">
                {loading ? (
                    <div className="flex justify-center py-10"><div className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" /></div>
                ) : visibleAnnotations.length === 0 ? (
                    <div className="px-2 py-8 text-sm opacity-50">{annotations.length === 0 ? tt('selectTextToSaveAnnotation') : tt('noAnnotationsMatchFilter')}</div>
                ) : (
                    <div className="space-y-2">
                        {visibleAnnotations.map((annotation) => (
                            <div
                                key={annotation.id}
                                className="rounded-xl border px-3 py-3"
                                style={{
                                    backgroundColor: activeAnnotationId === annotation.id ? `${themeStyle.border}` : 'transparent',
                                    borderColor: themeStyle.border,
                                    color: themeStyle.text,
                                }}
                            >
                                <div className="mb-2 flex items-start justify-between gap-3">
                                    <button type="button" onClick={() => onItemClick(annotation)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-85">
                                        <div className="text-[10px] uppercase tracking-widest opacity-40">{annotation.kind === 'note' ? tt('note') : tt('highlight')}</div>
                                        <div className="text-[11px] opacity-55">{formatLocation(annotation, tt, lang)}</div>
                                    </button>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => onColorItem(annotation)}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                                            style={{ color: themeStyle.text, border: `1px solid ${themeStyle.border}` }}
                                            title={tt('changeColor')}
                                        >
                                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: annotation.color || (annotation.kind === 'note' ? 'rgba(76, 201, 240, 0.24)' : 'rgba(255, 212, 59, 0.42)') }} />
                                        </button>
                                        {annotation.kind === 'note' && (
                                            <button
                                                type="button"
                                                onClick={() => onEditItem(annotation)}
                                                className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                                                style={{ color: themeStyle.text, border: `1px solid ${themeStyle.border}` }}
                                                title={tt('editNote')}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => onDeleteItem(annotation)}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                                            style={{ color: themeStyle.text, border: `1px solid ${themeStyle.border}` }}
                                            title={tt('deleteAnnotation')}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /></svg>
                                        </button>
                                    </div>
                                </div>
                                <button type="button" onClick={() => onItemClick(annotation)} className="w-full text-left transition-opacity hover:opacity-85">
                                    <div className="text-sm leading-6">{annotation.snippet || annotation.selected_text}</div>
                                    {annotation.note_text && (
                                        <div className="mt-2 rounded-lg px-3 py-2 text-sm opacity-80" style={{ backgroundColor: `${themeStyle.border}99` }}>
                                            {annotation.note_text}
                                        </div>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default ReaderAnnotationsPanel
