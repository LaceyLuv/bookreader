// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'

import {
    applyRestoredClientState,
    collectBackupClientState,
    commitRestore,
    exportBackup,
    previewRestore,
} from './backupClient'

beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:backup')
    URL.revokeObjectURL = vi.fn()
})

test('collects only the allowlisted local state', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ theme: 'sepia' }))
    localStorage.setItem('bookreader_folder_colors', JSON.stringify({ shelf: '#fff' }))
    localStorage.setItem('bookreader_progress', JSON.stringify({ book: { position: 2 } }))
    localStorage.setItem('__BOOKREADER_SAFE_MODE__', '1')

    expect(collectBackupClientState()).toEqual({
        settings: { theme: 'sepia' },
        folder_colors: { shelf: '#fff' },
        progress: { book: { position: 2 } },
    })
})

test('exports through authenticated fetch and downloads the returned bundle', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'Content-Disposition': 'attachment; filename="verified.bookreader-backup"' }),
        blob: async () => new Blob(['bundle']),
    })))

    const filename = await exportBackup(true)

    expect(filename).toBe('verified.bookreader-backup')
    expect(JSON.parse(fetch.mock.calls[0][1].body).include_books).toBe(true)
    expect(click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:backup')
})

test('uses the Gyeol filename when the backup response omits content disposition', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        blob: async () => new Blob(['bundle']),
    })))

    await expect(exportBackup(false)).resolves.toBe('Gyeol-data.bookreader-backup')
})

test('previews and commits the same restore session', async () => {
    vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ restore_id: 'session-1', kind: 'data' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, client_state: {} }) }))

    const preview = await previewRestore(new File(['bundle'], 'backup.bookreader-backup'))
    await commitRestore(preview.restore_id)

    expect(fetch.mock.calls[0][0]).toContain('/restores/preview')
    expect(fetch.mock.calls[1][0]).toContain('/restores/session-1/commit')
})

test('applies restored settings only after commit and clears stale local progress', () => {
    localStorage.setItem('bookreader_progress', JSON.stringify({ stale: { position: 9 } }))
    localStorage.setItem('__BOOKREADER_SAFE_MODE__', '1')

    applyRestoredClientState({ settings: { theme: 'dark' }, folder_colors: { shelf: '#123456' } })

    expect(JSON.parse(localStorage.getItem('bookreader_settings'))).toEqual({ theme: 'dark' })
    expect(JSON.parse(localStorage.getItem('bookreader_folder_colors'))).toEqual({ shelf: '#123456' })
    expect(localStorage.getItem('bookreader_progress')).toBeNull()
    expect(localStorage.getItem('__BOOKREADER_SAFE_MODE__')).toBe('1')
})
