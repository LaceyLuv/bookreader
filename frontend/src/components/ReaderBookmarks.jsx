import { useEffect, useMemo, useRef, useState } from 'react'

const COPY = {
    bookmarks: { en: 'Bookmarks', ko: '북마크' },
    openBookmarks: { en: 'Open bookmarks', ko: '북마크 열기' },
    closeBookmarks: { en: 'Close bookmarks', ko: '북마크 닫기' },
    addBookmark: { en: 'Add bookmark', ko: '북마크 추가' },
    bookmarkNavigator: { en: 'Bookmark navigator', ko: '북마크 이동' },
    currentLocation: { en: 'Current location', ko: '현재 위치' },
    noBookmarks: { en: 'No bookmarks yet', ko: '아직 북마크가 없어요' },
    noBookmarksHint: { en: 'Save this page to find it again quickly.', ko: '이 페이지를 저장하면 빠르게 다시 찾을 수 있어요.' },
    noBookmarksMatch: { en: 'No bookmarks match these filters', ko: '조건에 맞는 북마크가 없어요' },
    clearBookmarkFilters: { en: 'Clear search and filters', ko: '검색과 필터 초기화' },
    allBookmarks: { en: 'All', ko: '전체' },
    recentBookmarks: { en: 'Recent', ko: '최근' },
    importantBookmarks: { en: 'Important', ko: '중요' },
    searchBookmarks: { en: 'Search bookmarks', ko: '북마크 검색' },
    sortBookmarks: { en: 'Sort bookmarks', ko: '북마크 정렬' },
    newestFirst: { en: 'Newest first', ko: '최신순' },
    oldestFirst: { en: 'Oldest first', ko: '오래된순' },
    editBookmark: { en: 'Edit bookmark', ko: '북마크 편집' },
    removeBookmark: { en: 'Remove bookmark', ko: '북마크 삭제' },
    markBookmarkImportant: { en: 'Mark as important', ko: '중요 북마크로 표시' },
    unmarkBookmarkImportant: { en: 'Remove important mark', ko: '중요 표시 해제' },
    bookmarkNote: { en: 'Note', ko: '메모' },
    bookmarkTag: { en: 'Tag', ko: '태그' },
    bookmarkColor: { en: 'Color', ko: '색상' },
    bookmarkNotePlaceholder: { en: 'Add a note…', ko: '메모를 입력하세요…' },
    bookmarkTagPlaceholder: { en: 'e.g. Quote, Idea', ko: '예: 명언, 생각' },
    save: { en: 'Save', ko: '저장' },
    cancel: { en: 'Cancel', ko: '취소' },
    page: { en: 'Page', ko: '페이지' },
    today: { en: 'Today', ko: '오늘' },
    yesterday: { en: 'Yesterday', ko: '어제' },
}

const DEFAULT_COLORS = ['#8b5cf6', '#f59e0b', '#22c55e', '#f43f5e', '#3b82f6', '#d97706']
const I18N_ALIASES = {
    allBookmarks: 'bookmarkAll',
    recentBookmarks: 'bookmarkRecent',
    importantBookmarks: 'bookmarkImportant',
    searchBookmarks: 'bookmarkSearch',
    sortBookmarks: 'bookmarkSort',
    newestFirst: 'bookmarkNewest',
    oldestFirst: 'bookmarkOldest',
    noBookmarks: 'bookmarkEmpty',
    noBookmarksHint: 'bookmarkEmptyHint',
    noBookmarksMatch: 'bookmarkNoResults',
    editBookmark: 'bookmarkEdit',
    markBookmarkImportant: 'bookmarkMarkImportant',
    unmarkBookmarkImportant: 'bookmarkUnmarkImportant',
    save: 'bookmarkSave',
    cancel: 'bookmarkCancel',
}

function makeTranslator(tt, lang) {
    return (key) => {
        const sourceKey = I18N_ALIASES[key] ?? key
        const translated = typeof tt === 'function' ? tt(sourceKey) : sourceKey
        if (translated != null && translated !== '' && translated !== sourceKey && translated !== key) return translated
        return COPY[key]?.[lang === 'ko' ? 'ko' : 'en'] ?? translated ?? key
    }
}

function BookmarkIcon({ filled = false, size = 18 }) {
    return (
        <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
        </svg>
    )
}

function getBookmarkKey(item, index = 0) {
    return String(item?.id ?? item?.savedAt ?? item?.createdAt ?? `${item?.position ?? 'bookmark'}-${index}`)
}

function getTimestamp(item) {
    const value = item?.updatedAt ?? item?.editedAt ?? item?.savedAt ?? item?.createdAt
    const parsed = value == null ? Number.NaN : Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function getNote(item) {
    return item?.note ?? item?.note_text ?? ''
}

function getTag(item) {
    return item?.tag ?? item?.category ?? ''
}

function isImportant(item) {
    return Boolean(item?.important ?? item?.starred ?? item?.favorite)
}

function getExcerpt(item) {
    return item?.snippet ?? item?.excerpt ?? item?.selected_text ?? item?.preview ?? ''
}

function getLocationLabel(item, t, lang) {
    if (item?.location) return String(item.location)
    if (item?.label) return String(item.label)
    if (item?.locator?.kind === 'epub') {
        const page = item.locator.chapterPage ?? item.locator.fallbackPage
        const chapterTitle = item.locator.chapterTitle
        const pageLabel = Number.isFinite(page)
            ? (lang === 'ko' ? `${page + 1}${t('page')}` : `${t('page')} ${page + 1}`)
            : ''
        if (chapterTitle && pageLabel) return `${chapterTitle} · ${pageLabel}`
        if (chapterTitle) return String(chapterTitle)
        if (pageLabel) return pageLabel
    }
    if (item?.chapter_title) {
        const page = item?.page ?? item?.locator?.chapterPage
        if (!Number.isFinite(page)) return String(item.chapter_title)
        return lang === 'ko'
            ? `${item.chapter_title} · ${page + 1}${t('page')}`
            : `${item.chapter_title} · ${t('page')} ${page + 1}`
    }
    const position = item?.position ?? item?.page ?? item?.locator?.page ?? item?.locator?.fallbackPage
    if (Number.isFinite(position)) return `${t('page')} ${position + 1}`
    return t('currentLocation')
}

function formatSavedAt(item, t, lang) {
    const timestamp = getTimestamp(item)
    if (!timestamp) return ''

    const date = new Date(timestamp)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const dayDiff = Math.round((today - day) / 86_400_000)
    const time = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
        hour: '2-digit', minute: '2-digit', hour12: lang !== 'ko',
    }).format(date)

    if (dayDiff === 0) return `${t('today')} ${time}`
    if (dayDiff === 1) return `${t('yesterday')} ${time}`
    return new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
        month: 'short', day: 'numeric',
        ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
        hour: '2-digit', minute: '2-digit', hour12: lang !== 'ko',
    }).format(date)
}

function bookmarkMatchesPosition(item, currentPosition) {
    if (currentPosition == null) return false
    if (typeof currentPosition === 'number') return item?.position === currentPosition || item?.page === currentPosition
    if (typeof currentPosition !== 'object') return false
    if (currentPosition.id != null && item?.id != null) return currentPosition.id === item.id
    if (currentPosition.savedAt != null && item?.savedAt != null) return currentPosition.savedAt === item.savedAt
    if (currentPosition.locator && item?.locator) {
        const currentLocator = currentPosition.locator
        const itemLocator = item.locator
        const kind = currentLocator.kind ?? itemLocator.kind
        if (kind === 'epub') {
            const sameChapter = currentLocator.chapterHref && itemLocator.chapterHref
                ? currentLocator.chapterHref === itemLocator.chapterHref
                : currentLocator.chapterIndex === itemLocator.chapterIndex
            const currentPage = currentLocator.chapterPage ?? currentLocator.fallbackPage
            const itemPage = itemLocator.chapterPage ?? itemLocator.fallbackPage
            if (sameChapter && Number.isFinite(currentPage) && Number.isFinite(itemPage)) return currentPage === itemPage
        } else if (kind === 'zip') {
            if (currentLocator.memberName && itemLocator.memberName) return currentLocator.memberName === itemLocator.memberName
            const currentPage = currentLocator.page ?? currentLocator.fallbackPage
            const itemPage = itemLocator.page ?? itemLocator.fallbackPage
            if (Number.isFinite(currentPage) && Number.isFinite(itemPage)) return currentPage === itemPage
        } else if (kind === 'txt') {
            const currentSegment = currentLocator.segmentId ?? currentLocator.startSegmentId
            const itemSegment = itemLocator.segmentId ?? itemLocator.startSegmentId
            if (Number.isFinite(currentSegment) && Number.isFinite(itemSegment)) return currentSegment === itemSegment
            const currentPage = currentLocator.page ?? currentLocator.fallbackPage
            const itemPage = itemLocator.page ?? itemLocator.fallbackPage
            if (Number.isFinite(currentPage) && Number.isFinite(itemPage)) return currentPage === itemPage
        }
    }
    if (Number.isFinite(currentPosition.position) && Number.isFinite(item?.position)) return currentPosition.position === item.position
    return false
}

function ReaderBookmarkToggle({
    open = false,
    onToggle,
    themeStyle = {},
    tt = (key) => key,
    lang = 'en',
    panelId = 'reader-bookmarks-panel',
    keyboardShortcut,
    className = '',
}) {
    const t = makeTranslator(tt, lang)
    const label = open ? t('closeBookmarks') : t('openBookmarks')

    return (
        <button
            type="button"
            className={`reader-bookmark-toggle flex h-8 w-8 items-center justify-center rounded-lg border-0 transition hover:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${className}`.trim()}
            style={{
                color: themeStyle.text ?? '#4b3825',
                backgroundColor: open ? (themeStyle.selected ?? themeStyle.card ?? '#f4ead9') : 'transparent',
                outlineColor: themeStyle.accent ?? '#9b6b36',
            }}
            aria-label={label}
            title={label}
            aria-controls={panelId}
            aria-expanded={open}
            aria-pressed={open}
            aria-keyshortcuts={keyboardShortcut}
            onClick={onToggle}
            disabled={!onToggle}
        >
            <BookmarkIcon />
        </button>
    )
}

function ReaderBookmarkNavigator({
    items = [],
    currentPosition = null,
    onActivate,
    themeStyle = {},
    tt = (key) => key,
    lang = 'en',
    className = '',
}) {
    const t = makeTranslator(tt, lang)
    const safeItems = Array.isArray(items) ? items : []
    const selectedIndex = safeItems.findIndex((item) => bookmarkMatchesPosition(item, currentPosition))
    const currentLabel = typeof currentPosition === 'number'
        ? `${t('page')} ${currentPosition + 1}`
        : (currentPosition?.label || t('currentLocation'))

    return (
        <div
            className={`reader-bookmark-navigator reader-ui flex min-w-0 items-center gap-3 border-b px-5 py-3 text-xs ${className}`.trim()}
            style={{
                borderColor: themeStyle.border ?? '#ded4c5',
                color: themeStyle.text ?? '#4b3825',
                backgroundColor: themeStyle.card ?? '#fffaf1',
            }}
        >
            <span className="shrink-0 font-semibold opacity-65">{t('bookmarks')}</span>
            <select
                aria-label={t('bookmarkNavigator')}
                className="max-w-[14rem] rounded-xl border bg-transparent px-3 py-2 font-medium outline-none focus-visible:ring-2"
                style={{ borderColor: themeStyle.border ?? '#ded4c5', backgroundColor: themeStyle.card ?? '#fffaf1' }}
                value={selectedIndex < 0 ? '' : String(selectedIndex)}
                onChange={(event) => {
                    const index = Number(event.target.value)
                    if (Number.isInteger(index) && safeItems[index]) onActivate?.(safeItems[index])
                }}
                disabled={safeItems.length === 0 || !onActivate}
            >
                <option value="">{safeItems.length === 0 ? t('noBookmarks') : currentLabel}</option>
                {safeItems.map((item, index) => (
                    <option key={getBookmarkKey(item, index)} value={index}>
                        {getLocationLabel(item, t, lang)}{getTag(item) ? ` · ${getTag(item)}` : ''}
                    </option>
                ))}
            </select>
        </div>
    )
}

function ReaderBookmarkFab({
    onAdd,
    themeStyle = {},
    tt = (key) => key,
    lang = 'en',
    className = '',
    showLabel = true,
    disabled = false,
}) {
    const t = makeTranslator(tt, lang)

    return (
        <div className={`reader-bookmark-fab reader-ui group pointer-events-none absolute bottom-24 right-6 z-20 flex flex-col items-center gap-2 max-sm:bottom-20 max-sm:right-4 ${className}`.trim()}>
            <button
                type="button"
                className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-2xl border shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                    color: themeStyle.text ?? '#60462c',
                    borderColor: themeStyle.border ?? '#e2d4bf',
                    backgroundColor: themeStyle.card ?? '#fff8e9',
                    outlineColor: themeStyle.accent ?? '#9b6b36',
                }}
                aria-label={t('addBookmark')}
                title={t('addBookmark')}
                onClick={onAdd}
                disabled={disabled || !onAdd}
            >
                <BookmarkIcon size={22} />
            </button>
            {showLabel && (
                <span
                    className="reader-bookmark-fab__label pointer-events-none translate-y-1 rounded-lg border px-3 py-1.5 text-[11px] font-semibold opacity-0 shadow-md transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
                    style={{ color: themeStyle.text ?? '#60462c', borderColor: themeStyle.border ?? '#e2d4bf', backgroundColor: themeStyle.card ?? '#fffaf1' }}
                    aria-hidden="true"
                >
                    {t('addBookmark')}
                </span>
            )}
        </div>
    )
}

function BookmarkEditor({ item, color, t, themeStyle, onCancel, onSave }) {
    const [note, setNote] = useState(getNote(item))
    const [tag, setTag] = useState(getTag(item))
    const [selectedColor, setSelectedColor] = useState(
        /^#[0-9a-f]{6}$/i.test(item?.color ?? '') ? item.color : color,
    )

    return (
        <form
            className="reader-bookmarks-editor mt-3 space-y-3 rounded-xl border p-3"
            style={{ borderColor: themeStyle.border ?? '#e2d4bf', backgroundColor: themeStyle.editor ?? 'rgba(255,255,255,0.38)' }}
            onSubmit={(event) => {
                event.preventDefault()
                onSave({ note: note.trim(), tag: tag.trim(), color: selectedColor })
            }}
        >
            <label className="block text-[11px] font-semibold">
                <span className="mb-1.5 block opacity-70">{t('bookmarkNote')}</span>
                <textarea
                    autoFocus
                    rows={3}
                    maxLength={1000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t('bookmarkNotePlaceholder')}
                    className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2"
                    style={{ borderColor: themeStyle.border ?? '#e2d4bf', backgroundColor: themeStyle.card ?? '#fffaf1' }}
                />
            </label>
            <label className="block text-[11px] font-semibold">
                <span className="mb-1.5 block opacity-70">{t('bookmarkTag')}</span>
                <input
                    value={tag}
                    maxLength={40}
                    onChange={(event) => setTag(event.target.value)}
                    placeholder={t('bookmarkTagPlaceholder')}
                    className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2"
                    style={{ borderColor: themeStyle.border ?? '#e2d4bf', backgroundColor: themeStyle.card ?? '#fffaf1' }}
                />
            </label>
            <label className="flex items-center justify-between gap-3 text-[11px] font-semibold">
                <span className="opacity-70">{t('bookmarkColor')}</span>
                <input
                    type="color"
                    value={selectedColor}
                    onChange={(event) => setSelectedColor(event.target.value)}
                    className="h-8 w-12 cursor-pointer rounded-lg border bg-transparent p-1"
                    style={{ borderColor: themeStyle.border ?? '#e2d4bf' }}
                />
            </label>
            <div className="flex justify-end gap-2">
                <button type="button" className="rounded-lg px-3 py-2 text-[11px] font-semibold hover:opacity-70" onClick={onCancel}>{t('cancel')}</button>
                <button
                    type="submit"
                    className="rounded-lg px-4 py-2 text-[11px] font-bold text-white shadow-sm hover:opacity-90"
                    style={{ backgroundColor: themeStyle.accent ?? '#76512e' }}
                >
                    {t('save')}
                </button>
            </div>
        </form>
    )
}

function ReaderBookmarksPanel({
    open = false,
    items = [],
    themeStyle = {},
    currentPosition = null,
    onClose,
    onAdd,
    onActivate,
    onRemove,
    onUpdate,
    tt = (key) => key,
    lang = 'en',
    panelId = 'reader-bookmarks-panel',
    className = '',
}) {
    const t = useMemo(() => makeTranslator(tt, lang), [lang, tt])
    const safeItems = Array.isArray(items) ? items : []
    const [filter, setFilter] = useState('all')
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState('newest')
    const [editingKey, setEditingKey] = useState(null)
    const [isModal, setIsModal] = useState(false)
    const panelRef = useRef(null)
    const closeButtonRef = useRef(null)
    const lastFocusedRef = useRef(null)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined
        const media = window.matchMedia('(max-width: 980px)')
        const update = () => setIsModal(media.matches)
        update()
        if (typeof media.addEventListener === 'function') media.addEventListener('change', update)
        else media.addListener?.(update)
        return () => {
            if (typeof media.removeEventListener === 'function') media.removeEventListener('change', update)
            else media.removeListener?.(update)
        }
    }, [])

    useEffect(() => {
        if (!open) {
            setEditingKey(null)
            return undefined
        }

        lastFocusedRef.current = document.activeElement
        closeButtonRef.current?.focus()
        const closeOnEscape = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            onCloseRef.current?.()
        }
        window.addEventListener('keydown', closeOnEscape, true)
        return () => {
            window.removeEventListener('keydown', closeOnEscape, true)
            if (lastFocusedRef.current instanceof HTMLElement && lastFocusedRef.current.isConnected) {
                lastFocusedRef.current.focus()
            }
        }
    }, [open])

    useEffect(() => {
        if (!open || !isModal) return undefined
        const panel = panelRef.current
        const readingSurface = panel?.parentElement?.querySelector?.('.reader-shell-reading')
        const previousInert = readingSurface?.inert
        const previousAriaHidden = readingSurface?.getAttribute?.('aria-hidden')
        if (readingSurface) {
            readingSurface.inert = true
            readingSurface.setAttribute('aria-hidden', 'true')
        }

        const trapFocus = (event) => {
            if (event.key !== 'Tab' || event.defaultPrevented) return
            const focusable = Array.from(panel?.querySelectorAll?.(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            ) || []).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
            if (focusable.length === 0) {
                event.preventDefault()
                panel?.focus()
                return
            }
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        panel?.addEventListener('keydown', trapFocus)
        return () => {
            panel?.removeEventListener('keydown', trapFocus)
            if (readingSurface) {
                readingSurface.inert = Boolean(previousInert)
                if (previousAriaHidden == null) readingSurface.removeAttribute('aria-hidden')
                else readingSurface.setAttribute('aria-hidden', previousAriaHidden)
            }
        }
    }, [isModal, open])

    const recentKeys = useMemo(() => new Set(
        safeItems
            .map((item, index) => ({ key: getBookmarkKey(item, index), timestamp: getTimestamp(item), index }))
            .sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)
            .slice(0, 5)
            .map(({ key }) => key),
    ), [safeItems])

    const visibleItems = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase(lang === 'ko' ? 'ko-KR' : 'en-US')
        return safeItems
            .map((item, index) => ({ item, index, key: getBookmarkKey(item, index) }))
            .filter(({ item, key }) => {
                if (filter === 'important' && !isImportant(item)) return false
                if (filter === 'recent' && !recentKeys.has(key)) return false
                if (!normalizedQuery) return true
                return [
                    getLocationLabel(item, t, lang), getExcerpt(item), getNote(item), getTag(item),
                ].some((value) => String(value ?? '').toLocaleLowerCase(lang === 'ko' ? 'ko-KR' : 'en-US').includes(normalizedQuery))
            })
            .sort((a, b) => {
                const direction = sort === 'oldest' ? 1 : -1
                return (getTimestamp(a.item) - getTimestamp(b.item)) * direction || (a.index - b.index) * direction
            })
    }, [filter, lang, query, recentKeys, safeItems, sort, t])

    if (!open) return null

    const importantCount = safeItems.filter(isImportant).length
    const clearFilters = () => {
        setFilter('all')
        setQuery('')
    }
    const filterStyle = (value) => ({
        color: filter === value ? (themeStyle.activeText ?? themeStyle.text ?? '#5f4227') : (themeStyle.text ?? '#5f4227'),
        borderColor: filter === value ? (themeStyle.accent ?? '#9b6b36') : (themeStyle.border ?? '#e2d4bf'),
        backgroundColor: filter === value ? (themeStyle.selected ?? '#f3e7d4') : 'transparent',
    })

    return (
        <aside
            ref={panelRef}
            id={panelId}
            role={isModal ? 'dialog' : undefined}
            aria-modal={isModal ? 'true' : undefined}
            aria-label={t('bookmarks')}
            tabIndex={-1}
            className={`reader-bookmarks-panel reader-ui absolute inset-y-0 right-0 z-30 flex flex-col overflow-hidden rounded-l-2xl border-l shadow-2xl max-sm:rounded-2xl max-sm:border ${className}`.trim()}
            style={{
                color: themeStyle.text ?? '#4d3927',
                borderColor: themeStyle.border ?? '#e2d4bf',
                backgroundColor: themeStyle.card ?? '#fffaf1',
            }}
        >
            <header className="reader-bookmarks-header shrink-0 border-b px-5 pb-4 pt-5" style={{ borderColor: themeStyle.border ?? '#e2d4bf' }}>
                <div className="mb-5 flex items-center justify-between gap-4">
                    <h2 className="text-base font-bold">{t('bookmarks')}</h2>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label={t('closeBookmarks')}
                        title={t('closeBookmarks')}
                        className="flex h-9 w-9 items-center justify-center rounded-xl transition hover:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        disabled={!onClose}
                    >
                        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </div>
                <button
                    type="button"
                    onClick={onAdd}
                    disabled={!onAdd}
                    className="reader-bookmarks-add flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ backgroundColor: themeStyle.accent ?? '#674523', outlineColor: themeStyle.accent ?? '#674523' }}
                >
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    {t('addBookmark')}
                </button>
                <div className="reader-bookmarks-filters mt-5 flex items-center gap-2 overflow-x-auto pb-1">
                    <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className="shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold transition hover:opacity-75" style={filterStyle('all')}>
                        {t('allBookmarks')} <span className="ml-1 opacity-60">{safeItems.length}</span>
                    </button>
                    <button type="button" aria-pressed={filter === 'recent'} onClick={() => setFilter('recent')} className="shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold transition hover:opacity-75" style={filterStyle('recent')}>
                        {t('recentBookmarks')}
                    </button>
                    <button type="button" aria-pressed={filter === 'important'} onClick={() => setFilter('important')} className="shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold transition hover:opacity-75" style={filterStyle('important')}>
                        {t('importantBookmarks')} <span className="ml-1 opacity-60">{importantCount}</span>
                    </button>
                </div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <label className="reader-bookmarks-search relative block min-w-0">
                        <span className="sr-only">{t('searchBookmarks')}</span>
                        <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-55" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t('searchBookmarks')}
                            className="w-full rounded-xl border bg-transparent py-2.5 pl-9 pr-3 text-xs outline-none focus-visible:ring-2"
                            style={{ borderColor: themeStyle.border ?? '#e2d4bf', backgroundColor: themeStyle.input ?? 'rgba(255,255,255,0.3)' }}
                        />
                    </label>
                    <label>
                        <span className="sr-only">{t('sortBookmarks')}</span>
                        <select
                            aria-label={t('sortBookmarks')}
                            value={sort}
                            onChange={(event) => setSort(event.target.value)}
                            className="h-full max-w-[7.5rem] rounded-xl border bg-transparent px-2 text-[11px] font-semibold outline-none focus-visible:ring-2"
                            style={{ borderColor: themeStyle.border ?? '#e2d4bf', backgroundColor: themeStyle.card ?? '#fffaf1' }}
                        >
                            <option value="newest">{t('newestFirst')}</option>
                            <option value="oldest">{t('oldestFirst')}</option>
                        </select>
                    </label>
                </div>
            </header>

            <div className="reader-bookmarks-list min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite" aria-atomic="false">
                {visibleItems.length === 0 ? (
                    <div className="reader-bookmarks-empty flex min-h-52 flex-col items-center justify-center px-7 py-10 text-center">
                        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border opacity-45" style={{ borderColor: themeStyle.border ?? '#e2d4bf' }}><BookmarkIcon size={24} /></span>
                        <p className="text-sm font-bold">{safeItems.length === 0 ? t('noBookmarks') : t('noBookmarksMatch')}</p>
                        <p className="mt-2 max-w-60 text-xs leading-5 opacity-55">{safeItems.length === 0 ? t('noBookmarksHint') : ''}</p>
                        {safeItems.length > 0 && (
                            <button type="button" className="mt-4 rounded-lg border px-3 py-2 text-xs font-semibold hover:opacity-70" style={{ borderColor: themeStyle.border ?? '#e2d4bf' }} onClick={clearFilters}>
                                {t('clearBookmarkFilters')}
                            </button>
                        )}
                    </div>
                ) : (
                    <ol className="space-y-2.5">
                        {visibleItems.map(({ item, index, key }) => {
                            const active = bookmarkMatchesPosition(item, currentPosition)
                            const important = isImportant(item)
                            const note = getNote(item)
                            const excerpt = getExcerpt(item)
                            const tag = getTag(item)
                            const color = /^#[0-9a-f]{6}$/i.test(item?.color ?? '') ? item.color : DEFAULT_COLORS[index % DEFAULT_COLORS.length]
                            const location = getLocationLabel(item, t, lang)
                            const editing = editingKey === key
                            return (
                                <li
                                    key={key}
                                    className={`reader-bookmarks-card relative overflow-hidden rounded-xl border px-4 py-3 shadow-sm transition ${active ? 'reader-bookmarks-card--active' : ''}`.trim()}
                                    style={{
                                        borderColor: active ? (themeStyle.accent ?? color) : (themeStyle.border ?? '#e2d4bf'),
                                        backgroundColor: active ? (themeStyle.selected ?? 'rgba(244,234,217,0.72)') : (themeStyle.item ?? 'rgba(255,255,255,0.22)'),
                                    }}
                                >
                                    <span className="reader-bookmarks-card__accent absolute bottom-3 left-1 top-3 w-1 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                                    <div className="flex items-start gap-3 pl-1">
                                        <button
                                            type="button"
                                            onClick={() => onActivate?.(item)}
                                            className="min-w-0 flex-1 text-left outline-none transition hover:opacity-75 focus-visible:underline disabled:cursor-default"
                                            disabled={!onActivate}
                                            aria-current={active ? 'location' : undefined}
                                        >
                                            <span className="block truncate text-xs font-bold">{location}</span>
                                        </button>
                                        <time className="shrink-0 text-[10px] opacity-50" dateTime={item?.updatedAt ?? item?.editedAt ?? item?.savedAt ?? item?.createdAt ?? undefined}>{formatSavedAt(item, t, lang)}</time>
                                    </div>
                                    {tag && (
                                        <span className="ml-1 mt-2 inline-flex max-w-full truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold" style={{ color, borderColor: `${color}66`, backgroundColor: `${color}12` }}>
                                            {tag}
                                        </span>
                                    )}
                                    {(note || excerpt) && (
                                        <button
                                            type="button"
                                            onClick={() => onActivate?.(item)}
                                            disabled={!onActivate}
                                            className="ml-1 mt-2 block w-[calc(100%-0.25rem)] text-left text-xs leading-5 outline-none transition hover:opacity-75 focus-visible:underline disabled:cursor-default"
                                        >
                                            <span className="line-clamp-3">{note || excerpt}</span>
                                        </button>
                                    )}
                                    <div className="reader-bookmarks-card__actions mt-2 flex items-center justify-end gap-1 pl-1">
                                        {onUpdate && (
                                            <button
                                                type="button"
                                                aria-label={`${t('editBookmark')}: ${location}`}
                                                title={t('editBookmark')}
                                                aria-expanded={editing}
                                                onClick={() => setEditingKey(editing ? null : key)}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:opacity-60 focus-visible:outline focus-visible:outline-2"
                                            >
                                                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                                            </button>
                                        )}
                                        {onRemove && (
                                            <button
                                                type="button"
                                                aria-label={`${t('removeBookmark')}: ${location}`}
                                                title={t('removeBookmark')}
                                                onClick={() => onRemove(item)}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:opacity-60 focus-visible:outline focus-visible:outline-2"
                                            >
                                                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6" /></svg>
                                            </button>
                                        )}
                                        {onUpdate && (
                                            <button
                                                type="button"
                                                aria-label={`${important ? t('unmarkBookmarkImportant') : t('markBookmarkImportant')}: ${location}`}
                                                title={important ? t('unmarkBookmarkImportant') : t('markBookmarkImportant')}
                                                aria-pressed={important}
                                                onClick={() => onUpdate(item, { important: !important })}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:scale-105 focus-visible:outline focus-visible:outline-2"
                                                style={{ color: important ? '#f2a11f' : 'currentColor' }}
                                            >
                                                <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill={important ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="m12 2.7 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z" /></svg>
                                            </button>
                                        )}
                                    </div>
                                    {editing && (
                                        <BookmarkEditor
                                            key={key}
                                            item={item}
                                            color={color}
                                            t={t}
                                            themeStyle={themeStyle}
                                            onCancel={() => setEditingKey(null)}
                                            onSave={(patch) => {
                                                onUpdate?.(item, patch)
                                                setEditingKey(null)
                                            }}
                                        />
                                    )}
                                </li>
                            )
                        })}
                    </ol>
                )}
            </div>
        </aside>
    )
}

const ReaderBookmarkPanel = ReaderBookmarksPanel
const ReaderBookmarks = ReaderBookmarksPanel

export {
    ReaderBookmarkFab,
    ReaderBookmarkNavigator,
    ReaderBookmarkPanel,
    ReaderBookmarks,
    ReaderBookmarksPanel,
    ReaderBookmarkToggle,
}

export default ReaderBookmarksPanel
