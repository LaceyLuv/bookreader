// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { KeyboardShortcutsProvider, useKeyboardShortcuts } from './useKeyboardShortcuts'

function Probe() {
    const { keyboardShortcutsEnabled, setKeyboardShortcutsEnabled } = useKeyboardShortcuts()
    return (
        <>
            <output data-testid="shortcut-state">{String(keyboardShortcutsEnabled)}</output>
            <button type="button" onClick={() => setKeyboardShortcutsEnabled((enabled) => !enabled)}>toggle</button>
        </>
    )
}

function renderProbe() {
    return render(<KeyboardShortcutsProvider><Probe /></KeyboardShortcutsProvider>)
}

beforeEach(() => {
    localStorage.clear()
})

test('keyboard shortcuts default to enabled', () => {
    renderProbe()

    expect(screen.getByTestId('shortcut-state').textContent).toBe('true')
})

test('restores an explicitly disabled preference', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ keyboardShortcutsEnabled: false }))

    renderProbe()

    expect(screen.getByTestId('shortcut-state').textContent).toBe('false')
})

test('toggling shortcuts persists immediately without dropping other reader settings', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ theme: 'sepia' }))
    renderProbe()

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))

    expect(screen.getByTestId('shortcut-state').textContent).toBe('false')
    expect(JSON.parse(localStorage.getItem('bookreader_settings'))).toEqual({
        theme: 'sepia',
        keyboardShortcutsEnabled: false,
    })
})

test('repairs malformed saved settings when the shortcut switch changes', () => {
    localStorage.setItem('bookreader_settings', '{broken json')
    renderProbe()

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))

    expect(JSON.parse(localStorage.getItem('bookreader_settings'))).toEqual({
        keyboardShortcutsEnabled: false,
    })
})
