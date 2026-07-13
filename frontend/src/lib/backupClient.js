import { API_DATA_BASE } from './apiBase'
import { downloadResponseBlob } from './downloadResponseBlob'

const SETTINGS_KEY = 'bookreader_settings'
const FOLDER_COLORS_KEY = 'bookreader_folder_colors'
const PROGRESS_KEY = 'bookreader_progress'

function readObject(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '{}')
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch {
        return {}
    }
}

async function errorDetail(response, fallback) {
    try {
        const payload = await response.json()
        return payload?.detail || fallback
    } catch {
        return fallback
    }
}

export function collectBackupClientState() {
    return {
        settings: readObject(SETTINGS_KEY),
        folder_colors: readObject(FOLDER_COLORS_KEY),
        progress: readObject(PROGRESS_KEY),
    }
}

export async function exportBackup(includeBooks = false) {
    const response = await fetch(`${API_DATA_BASE}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_books: includeBooks, client_state: collectBackupClientState() }),
    })
    if (!response.ok) throw new Error(await errorDetail(response, 'Backup failed'))
    return downloadResponseBlob(response, `BookReader-${includeBooks ? 'full' : 'data'}.bookreader-backup`)
}

export async function previewRestore(file) {
    const body = new FormData()
    body.append('file', file)
    const response = await fetch(`${API_DATA_BASE}/restores/preview`, { method: 'POST', body })
    if (!response.ok) throw new Error(await errorDetail(response, 'Backup verification failed'))
    return response.json()
}

export async function commitRestore(restoreId) {
    const response = await fetch(`${API_DATA_BASE}/restores/${encodeURIComponent(restoreId)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_client_state: collectBackupClientState() }),
    })
    if (!response.ok) throw new Error(await errorDetail(response, 'Restore failed'))
    return response.json()
}

export async function discardRestore(restoreId) {
    if (!restoreId) return
    await fetch(`${API_DATA_BASE}/restores/${encodeURIComponent(restoreId)}`, { method: 'DELETE' }).catch(() => {})
}

export function applyRestoredClientState(clientState) {
    if (clientState?.settings && typeof clientState.settings === 'object') {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(clientState.settings))
    }
    if (clientState?.folder_colors && typeof clientState.folder_colors === 'object') {
        localStorage.setItem(FOLDER_COLORS_KEY, JSON.stringify(clientState.folder_colors))
    }
    localStorage.removeItem(PROGRESS_KEY)
}
