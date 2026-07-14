// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { KeyboardShortcutsProvider } from './useKeyboardShortcuts'
import { useReaderCommandShortcuts } from './useReaderCommandShortcuts'

function Harness({ actions }) {
    useReaderCommandShortcuts({
        enabled: true,
        settingsShortcutEnabled: true,
        searchShortcutEnabled: true,
        onBack: actions.back,
        onFirstPage: actions.first,
        onLastPage: actions.last,
        onSearch: actions.search,
        onAddBookmark: actions.bookmark,
        onToggleBookmarkBar: actions.bookmarkBar,
        onToggleToc: actions.toc,
        onToggleAnnotations: actions.annotations,
        onToggleLayout: actions.layout,
        onDecreaseScale: actions.decrease,
        onIncreaseScale: actions.increase,
        onToggleSettings: actions.settings,
    })
    return <input aria-label="editor" />
}

function createActions() {
    return Object.fromEntries([
        'back', 'first', 'last', 'search', 'bookmark', 'bookmarkBar', 'toc',
        'annotations', 'layout', 'decrease', 'increase', 'settings',
    ].map((name) => [name, vi.fn()]))
}

function renderHarness(actions) {
    return render(
        <KeyboardShortcutsProvider>
            <Harness actions={actions} />
        </KeyboardShortcutsProvider>,
    )
}

beforeEach(() => {
    localStorage.clear()
})

test('maps reader command keys to their matching actions', () => {
    const actions = createActions()
    renderHarness(actions)

    fireEvent.keyDown(window, { key: 'Home', code: 'Home' })
    fireEvent.keyDown(window, { key: 'End', code: 'End' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', ctrlKey: true })
    fireEvent.keyDown(window, { key: ',', code: 'Comma', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'ㅠ', code: 'KeyB' })
    fireEvent.keyDown(window, { key: 'B', code: 'KeyB', shiftKey: true })
    fireEvent.keyDown(window, { key: 'ㅅ', code: 'KeyT' })
    fireEvent.keyDown(window, { key: 'ㅡ', code: 'KeyM' })
    fireEvent.keyDown(window, { key: 'ㅣ', code: 'KeyL' })
    fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' })
    fireEvent.keyDown(window, { key: ']', code: 'BracketRight' })

    for (const action of Object.values(actions)) expect(action).toHaveBeenCalledOnce()
})

test('does not run single-key reader commands while editing text', () => {
    const actions = createActions()
    const { getByRole } = renderHarness(actions)
    const input = getByRole('textbox', { name: 'editor' })
    input.focus()

    fireEvent.keyDown(input, { key: 'b', code: 'KeyB' })
    fireEvent.keyDown(input, { key: 'l', code: 'KeyL' })

    expect(actions.bookmark).not.toHaveBeenCalled()
    expect(actions.layout).not.toHaveBeenCalled()
})

test('leaves events untouched when shortcuts are disabled', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ keyboardShortcutsEnabled: false }))
    const actions = createActions()
    renderHarness(actions)
    const event = new KeyboardEvent('keydown', {
        key: 'b', code: 'KeyB', bubbles: true, cancelable: true,
    })

    window.dispatchEvent(event)

    expect(actions.bookmark).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
})

test('ignores repeat and IME composition events', () => {
    const actions = createActions()
    renderHarness(actions)

    fireEvent.keyDown(window, { key: 'b', code: 'KeyB', repeat: true })
    fireEvent.keyDown(window, { key: 'b', code: 'KeyB', isComposing: true })

    expect(actions.bookmark).not.toHaveBeenCalled()
})
