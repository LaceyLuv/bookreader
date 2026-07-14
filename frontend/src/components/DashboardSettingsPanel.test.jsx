// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import DashboardSettingsPanel from './DashboardSettingsPanel'
import { applyRestoredClientState, commitRestore, previewRestore } from '../lib/backupClient'
import { KeyboardShortcutsProvider } from '../hooks/useKeyboardShortcuts'

vi.mock('../lib/backupClient', () => ({
    applyRestoredClientState: vi.fn(),
    commitRestore: vi.fn(),
    discardRestore: vi.fn(),
    exportBackup: vi.fn(),
    previewRestore: vi.fn(),
}))

function props(overrides = {}) {
    return {
        open: true,
        onClose: vi.fn(),
        onGoToLibrary: vi.fn(),
        onDataRestored: vi.fn(),
        tt: key => key,
        filters: {
            searchQuery: '', setSearchQuery: vi.fn(), sortBy: 'recent', setSortBy: vi.fn(),
            statusFilter: 'all', setStatusFilter: vi.fn(), flagFilter: 'all', setFlagFilter: vi.fn(),
            sortOptions: [], statusOptions: [], flagFilterOptions: [], groupSeries: false,
            setGroupSeries: vi.fn(), groupDuplicates: false, setGroupDuplicates: vi.fn(),
            allTags: [], selectedTag: 'all', setSelectedTag: vi.fn(), allCollections: [],
            selectedCollection: 'all', setSelectedCollection: vi.fn(), clearFilters: vi.fn(), activeFilterCount: 0,
        },
        folders: [], folderColors: {}, getDefaultFolderColor: () => '#000000',
        onFolderColorChange: vi.fn(), folderDraft: '', setFolderDraft: vi.fn(), folderSaving: false,
        onAddFolder: vi.fn(), onRenameFolder: vi.fn(), onRemoveFolder: vi.fn(), folderStatsById: {},
        selection: {
            selectionMode: false, setSelectionMode: vi.fn(), summary: '', selectedCount: 0,
            allVisibleSelected: false, toggleVisibleSelection: vi.fn(), bulkFolderId: '',
            setBulkFolderId: vi.fn(), bulkMoving: false, handleBulkMove: vi.fn(), clearSelection: vi.fn(),
        },
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
})

test('requires a verified preview before applying restore', async () => {
    previewRestore.mockResolvedValue({
        restore_id: 'verified-session', kind: 'full', created_at: '2026-07-13T00:00:00Z',
        counts: { books: 2, annotations: 3, fonts: 1 }, warnings: [],
    })
    commitRestore.mockResolvedValue({ ok: true, snapshot_filename: 'before.bookreader-backup', client_state: { settings: {} } })
    const onDataRestored = vi.fn()
    const { container } = render(<DashboardSettingsPanel {...props({ onDataRestored })} />)

    expect(screen.queryByText('applyRestore')).toBeNull()
    const input = container.querySelector('input[accept*="bookreader-backup"]')
    fireEvent.change(input, { target: { files: [new File(['bundle'], 'backup.bookreader-backup')] } })
    await screen.findByText('backup.bookreader-backup')
    fireEvent.click(screen.getByText('applyRestore'))

    await waitFor(() => expect(commitRestore).toHaveBeenCalledWith('verified-session'))
    expect(applyRestoredClientState).toHaveBeenCalledWith({ settings: {} })
    expect(onDataRestored).toHaveBeenCalledOnce()
})

test('library settings persist the keyboard shortcut switch', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(
        <KeyboardShortcutsProvider>
            <DashboardSettingsPanel {...props()} />
        </KeyboardShortcutsProvider>,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'enableKeyboardShortcuts' }))

    expect(JSON.parse(localStorage.getItem('bookreader_settings')).keyboardShortcutsEnabled).toBe(false)
})
