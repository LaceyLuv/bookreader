// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useReaderSettings } from './useReaderSettings'
import { KeyboardShortcutsProvider } from './useKeyboardShortcuts'

function SettingsProbe() {
    const settings = useReaderSettings()
    return (
        <>
            <output data-testid="font-mode">{settings.fontMode}</output>
            <output data-testid="background-color">{settings.bgColor}</output>
            <output data-testid="text-color">{settings.textColor}</output>
            <output data-testid="title-bar">{String(settings.showTitleBar)}</output>
            <output data-testid="zip-bookmark-bar">{String(settings.showZipBookmarkBar)}</output>
            <output data-testid="keyboard-shortcuts">{String(settings.keyboardShortcutsEnabled)}</output>
            <button type="button" onClick={() => settings.setKeyboardShortcutsEnabled(false)}>disable shortcuts</button>
            <button type="button" onClick={settings.resetDefaults}>reset settings</button>
        </>
    )
}

function renderSettings() {
    return render(<KeyboardShortcutsProvider><SettingsProbe /></KeyboardShortcutsProvider>)
}

beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
})

test('reader settings default to EPUB embedded font mode', () => {
    renderSettings()

    expect(screen.getByTestId('font-mode').textContent).toBe('embedded')
    expect(screen.getByTestId('background-color').textContent).toBe('#fbfaf6')
    expect(screen.getByTestId('text-color').textContent).toBe('#38342f')
    expect(screen.getByTestId('title-bar').textContent).toBe('false')
    expect(screen.getByTestId('zip-bookmark-bar').textContent).toBe('true')
    expect(screen.getByTestId('keyboard-shortcuts').textContent).toBe('true')
})

test('legacy saved settings migrate to EPUB embedded font mode by default', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({
        theme: 'dark',
        fontMode: 'user',
        showTitleBar: true,
    }))

    renderSettings()

    expect(screen.getByTestId('font-mode').textContent).toBe('embedded')
    expect(screen.getByTestId('title-bar').textContent).toBe('false')
})

test('restores a hidden ZIP bookmark bar without changing legacy title-bar behavior', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({
        settingsVersion: 2,
        showZipBookmarkBar: false,
    }))

    renderSettings()

    expect(screen.getByTestId('zip-bookmark-bar').textContent).toBe('false')
    expect(screen.getByTestId('title-bar').textContent).toBe('false')
})

test('restores, persists, and resets the keyboard shortcut preference', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({
        settingsVersion: 2,
        keyboardShortcutsEnabled: false,
    }))
    renderSettings()

    expect(screen.getByTestId('keyboard-shortcuts').textContent).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'reset settings' }))

    expect(screen.getByTestId('keyboard-shortcuts').textContent).toBe('true')
    expect(JSON.parse(localStorage.getItem('bookreader_settings')).keyboardShortcutsEnabled).toBe(true)
})

test('an external shortcut update is not overwritten by stale reader settings', () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({
        settingsVersion: 2,
        theme: 'light',
        keyboardShortcutsEnabled: true,
    }))
    const view = renderSettings()
    const externalSettings = {
        settingsVersion: 2,
        theme: 'dark',
        keyboardShortcutsEnabled: false,
    }
    localStorage.setItem('bookreader_settings', JSON.stringify(externalSettings))

    fireEvent(window, new StorageEvent('storage', { key: 'bookreader_settings' }))
    expect(screen.getByTestId('keyboard-shortcuts').textContent).toBe('false')
    view.unmount()

    expect(JSON.parse(localStorage.getItem('bookreader_settings'))).toEqual(externalSettings)
})
