import { useEffect, useRef, useState } from 'react'
import { API_FONTS_BASE } from '../lib/apiBase'
import { emitUserFontsUpdated } from './FontStyleInjector'
import { applyRestoredClientState, commitRestore, discardRestore, exportBackup, previewRestore } from '../lib/backupClient'

export default function DashboardSettingsPanel({ open, onClose, onGoToLibrary, onDataRestored, tt, filters, folders, folderColors, getDefaultFolderColor, onFolderColorChange, folderDraft, setFolderDraft, folderSaving, onAddFolder, onRenameFolder, onRemoveFolder, folderStatsById, selection }) {
    const panelRef = useRef(null)
    const fontInputRef = useRef(null)
    const restoreInputRef = useRef(null)
    const [fonts, setFonts] = useState([])
    const [fontBusy, setFontBusy] = useState(false)
    const [fontError, setFontError] = useState('')
    const [dataBusy, setDataBusy] = useState('')
    const [dataError, setDataError] = useState('')
    const [dataStatus, setDataStatus] = useState('')
    const [restorePreview, setRestorePreview] = useState(null)
    const [restoreFileName, setRestoreFileName] = useState('')

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

    const createBackup = async (includeBooks) => {
        setDataBusy(includeBooks ? 'full-backup' : 'data-backup')
        setDataError('')
        setDataStatus('')
        try {
            const filename = await exportBackup(includeBooks)
            setDataStatus(`${tt('backupCreated')}: ${filename}`)
        } catch (error) {
            setDataError(error.message || tt('backupFailed'))
        } finally {
            setDataBusy('')
        }
    }

    const chooseRestore = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (restorePreview?.restore_id) void discardRestore(restorePreview.restore_id)
        setDataBusy('preview')
        setDataError('')
        setDataStatus('')
        setRestorePreview(null)
        setRestoreFileName(file.name)
        try {
            setRestorePreview(await previewRestore(file))
        } catch (error) {
            setDataError(error.message || tt('backupVerifyFailed'))
        } finally {
            setDataBusy('')
        }
    }

    const applyRestore = async () => {
        if (!restorePreview?.restore_id) return
        const counts = restorePreview.counts || {}
        if (!window.confirm(`${tt('restoreConfirm')}\n${counts.books || 0} ${tt('books')}, ${counts.annotations || 0} ${tt('annotations')}`)) return
        setDataBusy('restore')
        setDataError('')
        try {
            const result = await commitRestore(restorePreview.restore_id)
            applyRestoredClientState(result.client_state)
            emitUserFontsUpdated()
            setDataStatus(`${tt('restoreComplete')} (${result.snapshot_filename})`)
            setRestorePreview(null)
            if (onDataRestored) onDataRestored(result)
            else window.location.reload()
        } catch (error) {
            setDataError(error.message || tt('restoreFailed'))
        } finally {
            setDataBusy('')
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
                    <section>
                        <h3>{tt('dataAndBackup')}</h3>
                        <p className="dashboard-settings-help">{tt('backupPrivacyWarning')}</p>
                        <div className="dashboard-settings-stack">
                            <button className="dashboard-primary-button" type="button" disabled={!!dataBusy} onClick={() => createBackup(false)}>{dataBusy === 'data-backup' ? tt('creatingBackup') : tt('backupReadingData')}</button>
                            <button className="dashboard-outline-button" type="button" disabled={!!dataBusy} onClick={() => createBackup(true)}>{dataBusy === 'full-backup' ? tt('creatingBackup') : tt('backupWithBooks')}</button>
                            <input ref={restoreInputRef} type="file" accept=".bookreader-backup,.zip,application/zip" hidden onChange={chooseRestore} />
                            <button className="dashboard-outline-button" type="button" disabled={!!dataBusy} onClick={() => restoreInputRef.current?.click()}>{dataBusy === 'preview' ? tt('verifyingBackup') : tt('chooseBackupToRestore')}</button>
                        </div>
                        {restorePreview && <div className="dashboard-restore-preview" role="status">
                            <strong>{restoreFileName}</strong>
                            <span>{restorePreview.kind === 'full' ? tt('fullBackup') : tt('readingDataBackup')} · {restorePreview.created_at?.slice(0, 10)}</span>
                            <span>{restorePreview.counts?.books || 0} {tt('books')} · {restorePreview.counts?.annotations || 0} {tt('annotations')} · {restorePreview.counts?.fonts || 0} {tt('fonts')}</span>
                            {(restorePreview.warnings || []).map(warning => <span key={warning} className="dashboard-settings-warning">{warning}</span>)}
                            <button className="dashboard-primary-button" type="button" disabled={!!dataBusy} onClick={applyRestore}>{dataBusy === 'restore' ? tt('restoringBackup') : tt('applyRestore')}</button>
                        </div>}
                        {dataStatus && <p className="dashboard-settings-success" role="status">{dataStatus}</p>}
                        {dataError && <p className="dashboard-settings-error" role="alert">{dataError}</p>}
                    </section>
                </div>
            </aside>
        </div>
    )
}
