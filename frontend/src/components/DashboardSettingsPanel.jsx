import { useEffect, useRef, useState } from 'react'
import { API_FONTS_BASE } from '../lib/apiBase'
import { emitUserFontsUpdated } from './FontStyleInjector'

export default function DashboardSettingsPanel({ open, onClose, onGoToLibrary, tt, filters, folders, folderColors, getDefaultFolderColor, onFolderColorChange, folderDraft, setFolderDraft, folderSaving, onAddFolder, onRenameFolder, onRemoveFolder, folderStatsById, selection }) {
    const panelRef = useRef(null)
    const fontInputRef = useRef(null)
    const [fonts, setFonts] = useState([])
    const [fontBusy, setFontBusy] = useState(false)
    const [fontError, setFontError] = useState('')

    const loadFonts = async () => {
        try {
            const response = await fetch(API_FONTS_BASE)
            if (!response.ok) throw new Error(tt('fontLoadFailed'))
            const data = await response.json()
            setFonts(Array.isArray(data) ? data : (data?.fonts || []))
            setFontError('')
        } catch (error) {
            setFontError(error.message || tt('fontLoadFailed'))
        }
    }

    useEffect(() => {
        if (!open) return undefined
        loadFonts()
        const previous = document.activeElement
        requestAnimationFrame(() => panelRef.current?.focus())
        const handleKey = (event) => {
            if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => {
            document.removeEventListener('keydown', handleKey)
            previous?.focus?.()
        }
    }, [open])

    const uploadFont = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setFontBusy(true)
        try {
            const body = new FormData()
            body.append('file', file)
            const response = await fetch(API_FONTS_BASE, { method: 'POST', body })
            if (!response.ok) throw new Error(tt('fontUploadFailed'))
            await loadFonts()
            emitUserFontsUpdated()
        } catch (error) {
            setFontError(error.message || tt('fontUploadFailed'))
        } finally {
            setFontBusy(false)
        }
    }

    const deleteFont = async (font) => {
        if (!window.confirm(`${font.filename} - ${tt('deleteLabel')}?`)) return
        setFontBusy(true)
        try {
            const response = await fetch(`${API_FONTS_BASE}/${encodeURIComponent(font.id)}`, { method: 'DELETE' })
            if (!response.ok) throw new Error(tt('fontDeleteFailed'))
            const family = `UserFont_${font.id}`
            try {
                const saved = JSON.parse(localStorage.getItem('bookreader_settings') || '{}')
                if (saved.fontFamily === family) {
                    localStorage.setItem('bookreader_settings', JSON.stringify({ ...saved, font: 'system', fontFamily: '', fontMode: 'user' }))
                }
            } catch { /* keep font management usable when storage is unavailable */ }
            await loadFonts()
            emitUserFontsUpdated()
        } catch (error) {
            setFontError(error.message || tt('fontDeleteFailed'))
        } finally {
            setFontBusy(false)
        }
    }

    if (!open) return null
    const fieldClass = 'dashboard-settings-field'

    return (
        <div className="dashboard-settings-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tt('librarySettings')} className="dashboard-settings-panel">
                <header className="dashboard-settings-header">
                    <div><span>{tt('library')}</span><h2>{tt('librarySettings')}</h2></div>
                    <button type="button" onClick={onClose} aria-label={tt('close')}>×</button>
                </header>
                <div className="dashboard-settings-scroll">
                    <section>
                        <h3>{tt('searchAndFilter')}</h3>
                        <input
                            className={fieldClass}
                            value={filters.searchQuery}
                            onFocus={() => onGoToLibrary(false)}
                            onKeyDown={event => event.key === 'Enter' && onGoToLibrary(true)}
                            onChange={e => filters.setSearchQuery(e.target.value)}
                            placeholder={tt('searchLibraryPlaceholder')}
                        />
                        <div className="dashboard-settings-grid">
                            <select className={fieldClass} value={filters.sortBy} onChange={e => filters.setSortBy(e.target.value)}>{filters.sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                            <select className={fieldClass} value={filters.statusFilter} onChange={e => filters.setStatusFilter(e.target.value)}><option value="all">{tt('allStatuses')}</option>{filters.statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                            <select className={fieldClass} value={filters.flagFilter} onChange={e => filters.setFlagFilter(e.target.value)}>{filters.flagFilterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                        </div>
                        <div className="dashboard-settings-toggles">
                            <label><input type="checkbox" checked={filters.groupSeries} onChange={() => filters.setGroupSeries(v => !v)} /> {tt('groupSeries')}</label>
                            <label><input type="checkbox" checked={filters.groupDuplicates} onChange={() => filters.setGroupDuplicates(v => !v)} /> {tt('groupDuplicates')}</label>
                        </div>
                        {filters.allTags.length > 0 && <div className="dashboard-settings-chips"><span>{tt('tagsLabel')}</span><button type="button" className={filters.selectedTag === 'all' ? 'active' : ''} onClick={() => filters.setSelectedTag('all')}>{tt('all')}</button>{filters.allTags.map(tag => <button type="button" key={tag} className={filters.selectedTag === tag ? 'active' : ''} onClick={() => filters.setSelectedTag(tag)}>#{tag}</button>)}</div>}
                        {filters.allCollections.length > 0 && <div className="dashboard-settings-chips"><span>{tt('collectionsLabel')}</span><button type="button" className={filters.selectedCollection === 'all' ? 'active' : ''} onClick={() => filters.setSelectedCollection('all')}>{tt('all')}</button>{filters.allCollections.map(collection => <button type="button" key={collection} className={filters.selectedCollection === collection ? 'active' : ''} onClick={() => filters.setSelectedCollection(collection)}>{collection}</button>)}</div>}
                        <button className="dashboard-outline-button" type="button" onClick={filters.clearFilters}>{tt('resetFilters')} {filters.activeFilterCount ? `(${filters.activeFilterCount})` : ''}</button>
                    </section>
                    <section>
                        <h3>{tt('selection')}</h3>
                        <label className="dashboard-settings-switch"><span>{tt('selectionMode')}</span><input type="checkbox" checked={selection.selectionMode} onChange={e => { selection.setSelectionMode(e.target.checked); onGoToLibrary(true) }} /></label>
                        {selection.selectionMode && <div className="dashboard-settings-stack">
                            <p>{selection.summary}</p>
                            <button className="dashboard-outline-button" type="button" onClick={selection.toggleVisibleSelection}>{selection.allVisibleSelected ? tt('unselectVisible') : tt('selectVisible')}</button>
                            <select className={fieldClass} value={selection.bulkFolderId} onChange={e => selection.setBulkFolderId(e.target.value)}><option value="">{tt('noFolder')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
                            <button className="dashboard-primary-button" type="button" disabled={!selection.selectedCount || selection.bulkMoving} onClick={() => selection.handleBulkMove()}>{selection.bulkMoving ? tt('moving') : tt('moveSelected')}</button>
                            {selection.selectedCount > 0 && <button className="dashboard-outline-button" type="button" onClick={selection.clearSelection}>{tt('clear')}</button>}
                        </div>}
                    </section>
                    <section>
                        <h3>{tt('libraryFoldersTitle')}</h3>
                        <div className="dashboard-settings-row"><input className={fieldClass} value={folderDraft} onChange={e => setFolderDraft(e.target.value)} placeholder={tt('folderNamePlaceholder')} /><button className="dashboard-primary-button" type="button" disabled={folderSaving} onClick={onAddFolder}>+</button></div>
                        <div className="dashboard-folder-manager">{folders.map(folder => <div key={folder.id} style={{ '--folder-color': folderColors[folder.id] || getDefaultFolderColor(folder.id) }}><label className="dashboard-folder-color" title={tt('folderColor')}><input type="color" value={folderColors[folder.id] || getDefaultFolderColor(folder.id)} onChange={event => onFolderColorChange(folder.id, event.target.value)} /><span /></label><div className="dashboard-folder-name"><strong>{folder.name}</strong><span>{folderStatsById[folder.id]?.total || 0} {tt('books')}</span></div><div><button type="button" onClick={() => onRenameFolder(folder)}>{tt('rename')}</button><button type="button" onClick={() => onRemoveFolder(folder)}>{tt('deleteLabel')}</button></div></div>)}</div>
                    </section>
                    <section>
                        <h3>{tt('fontManagement')}</h3>
                        <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={uploadFont} />
                        <button className="dashboard-primary-button" type="button" disabled={fontBusy} onClick={() => fontInputRef.current?.click()}>{fontBusy ? tt('loading') : tt('addFont')}</button>
                        <div className="dashboard-font-list">{fonts.map(font => <div key={font.id}><span>{font.filename}</span><button type="button" disabled={fontBusy} onClick={() => deleteFont(font)}>{tt('deleteLabel')}</button></div>)}</div>
                        {!fontBusy && fonts.length === 0 && <p>{tt('noUploadedFonts')}</p>}
                        {fontError && <p className="dashboard-settings-error">{fontError}</p>}
                    </section>
                </div>
            </aside>
        </div>
    )
}
