// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import ReaderBookmarksPanel, {
    ReaderBookmarkFab,
    ReaderBookmarkNavigator,
    ReaderBookmarkToggle,
} from './ReaderBookmarks'

const themeStyle = { card: '#fffaf1', border: '#ded4c5', text: '#403426', accent: '#76512e' }
const items = [
    { id: 'old', position: 0, label: 'Page 1', savedAt: '2026-01-01T10:00:00Z', snippet: 'A beginning worth remembering', tag: 'Quote', color: '#8b5cf6' },
    { id: 'important', position: 4, label: 'Page 5', savedAt: '2026-06-01T10:00:00Z', note: 'An important idea', important: true, tag: 'Idea', color: '#22c55e' },
    { id: 'new', position: 11, label: 'Page 12', savedAt: '2026-07-01T10:00:00Z', snippet: 'The newest passage' },
]

const identity = (key) => key

function renderPanel(overrides = {}) {
    const callbacks = {
        onClose: vi.fn(), onAdd: vi.fn(), onActivate: vi.fn(), onRemove: vi.fn(), onUpdate: vi.fn(),
    }
    render(
        <ReaderBookmarksPanel
            open
            items={items}
            themeStyle={themeStyle}
            currentPosition={4}
            tt={identity}
            lang="en"
            {...callbacks}
            {...overrides}
        />,
    )
    return callbacks
}

test('renders an accessible panel, filters, searches, and sorts bookmarks', async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getByRole('complementary', { name: 'Bookmarks' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All 3' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Important 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Page 5' }).getAttribute('aria-current')).toBe('location')

    await user.click(screen.getByRole('button', { name: 'Important 1' }))
    expect(screen.getByText('An important idea')).toBeTruthy()
    expect(screen.queryByText('The newest passage')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'All 3' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search bookmarks' }), 'beginning')
    expect(screen.getByText('A beginning worth remembering')).toBeTruthy()
    expect(screen.queryByText('An important idea')).toBeNull()

    await user.clear(screen.getByRole('searchbox', { name: 'Search bookmarks' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort bookmarks' }), 'oldest')
    const cards = screen.getAllByRole('listitem')
    expect(within(cards[0]).getByText('Page 1')).toBeTruthy()
    expect(within(cards.at(-1)).getByText('Page 12')).toBeTruthy()
})

test('adds, activates, stars, edits, and removes bookmarks through callbacks', async () => {
    const user = userEvent.setup()
    const callbacks = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await user.click(screen.getByRole('button', { name: 'Page 12' }))
    await user.click(screen.getByRole('button', { name: 'Mark as important: Page 12' }))
    await user.click(screen.getByRole('button', { name: 'Edit bookmark: Page 12' }))

    const note = screen.getByRole('textbox', { name: 'Note' })
    const tag = screen.getByRole('textbox', { name: 'Tag' })
    expect(note.maxLength).toBe(1000)
    await user.type(note, 'Read this again')
    await user.type(tag, 'Memo')
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#f43f5e' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Remove bookmark: Page 12' }))

    expect(callbacks.onAdd).toHaveBeenCalledOnce()
    expect(callbacks.onActivate).toHaveBeenCalledWith(items[2])
    expect(callbacks.onUpdate).toHaveBeenNthCalledWith(1, items[2], { important: true })
    expect(callbacks.onUpdate).toHaveBeenNthCalledWith(2, items[2], {
        note: 'Read this again', tag: 'Memo', color: '#f43f5e',
    })
    expect(callbacks.onRemove).toHaveBeenCalledWith(items[2])
})

test('matches the exact EPUB chapter page instead of every bookmark in the chapter', () => {
    const chapterBookmarks = [
        { id: 'page-1', position: 2, label: 'Chapter page 1', locator: { kind: 'epub', chapterIndex: 2, chapterPage: 0 } },
        { id: 'page-2', position: 2, label: 'Chapter page 2', locator: { kind: 'epub', chapterIndex: 2, chapterPage: 1 } },
    ]
    render(
        <ReaderBookmarksPanel
            open
            items={chapterBookmarks}
            currentPosition={{
                position: 2,
                label: 'Page 2',
                locator: { kind: 'epub', chapterIndex: 2, chapterPage: 1 },
            }}
            themeStyle={themeStyle}
            tt={identity}
            onClose={vi.fn()}
            onActivate={vi.fn()}
        />,
    )

    expect(screen.getByRole('button', { name: 'Chapter page 1' }).hasAttribute('aria-current')).toBe(false)
    expect(screen.getByRole('button', { name: 'Chapter page 2' }).getAttribute('aria-current')).toBe('location')
})

test('Escape closes the panel before a window-level reader shortcut runs', () => {
    const onClose = vi.fn()
    const readerShortcut = vi.fn()
    window.addEventListener('keydown', readerShortcut)
    renderPanel({ onClose })

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(document.body, event)

    expect(event.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
    expect(readerShortcut).not.toHaveBeenCalled()
    window.removeEventListener('keydown', readerShortcut)
})

test('shared toggle, navigator, and floating add button expose accessible actions', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const onActivate = vi.fn()
    const onAdd = vi.fn()
    render(
        <div>
            <ReaderBookmarkToggle open onToggle={onToggle} themeStyle={themeStyle} tt={identity} />
            <ReaderBookmarkNavigator items={items} currentPosition={0} onActivate={onActivate} themeStyle={themeStyle} tt={identity} />
            <ReaderBookmarkFab onAdd={onAdd} themeStyle={themeStyle} tt={identity} />
        </div>,
    )

    const toggle = screen.getByRole('button', { name: 'Close bookmarks' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.classList.contains('border-0')).toBe(true)
    expect(toggle.classList.contains('h-8')).toBe(true)
    await user.click(toggle)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bookmark navigator' }), '2')
    await user.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onToggle).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith(items[2])
    expect(onAdd).toHaveBeenCalledOnce()
})

test('shows empty and no-match states and can reset filtering', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
        <ReaderBookmarksPanel open items={[]} themeStyle={themeStyle} tt={identity} lang="en" onClose={vi.fn()} />,
    )
    expect(screen.getByText('No bookmarks yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add bookmark' }).disabled).toBe(true)

    rerender(<ReaderBookmarksPanel open items={items} themeStyle={themeStyle} tt={identity} lang="en" onClose={vi.fn()} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search bookmarks' }), 'not present')
    expect(screen.getByText('No bookmarks match these filters')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(screen.getByText('The newest passage')).toBeTruthy()
})

test('traps focus and makes the reading surface inert in the narrow overlay layout', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })))
    const { unmount } = render(
        <div>
            <div className="reader-shell-reading"><button type="button">Reader control</button></div>
            <ReaderBookmarksPanel open items={[]} themeStyle={themeStyle} tt={identity} lang="en" onClose={vi.fn()} onAdd={vi.fn()} />
        </div>,
    )

    const panel = screen.getByRole('dialog', { name: 'Bookmarks' })
    const readingSurface = document.querySelector('.reader-shell-reading')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(readingSurface.inert).toBe(true)
    expect(readingSurface.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close bookmarks' }))

    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Sort bookmarks' }))

    unmount()
    expect(readingSurface.inert).toBe(false)
    expect(readingSurface.hasAttribute('aria-hidden')).toBe(false)
    vi.unstubAllGlobals()
})
