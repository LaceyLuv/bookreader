// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWindowDisplay, WindowDisplayProvider } from './useWindowDisplay'
import { KeyboardShortcutsProvider } from './useKeyboardShortcuts'

function DisplayProbe() {
    const display = useWindowDisplay()
    return (
        <>
            <output data-testid="frame-visible">{String(display.showWindowFrame)}</output>
            <output data-testid="fullscreen">{String(display.isFullscreen)}</output>
            <output data-testid="display-busy">{String(display.windowDisplayBusy)}</output>
            <output data-testid="display-error">{display.windowDisplayError}</output>
            <button type="button" onClick={() => void display.setShowWindowFrame(!display.showWindowFrame)}>toggle-frame</button>
        </>
    )
}

beforeEach(() => {
    localStorage.clear()
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
})

test('restores the saved frame preference and preserves it across fullscreen', async () => {
    localStorage.setItem('bookreader_window_display', JSON.stringify({ showWindowFrame: false }))
    let fullscreen = false
    const invoke = vi.fn(async (command, payload) => {
        if (command === 'set_window_frame_visible') return { frameVisible: payload.visible, fullscreen }
        if (command === 'set_window_fullscreen') {
            fullscreen = payload.fullscreen
            return { frameVisible: false, fullscreen }
        }
        return { frameVisible: false, fullscreen }
    })
    window.__TAURI_INTERNALS__ = { invoke }

    render(<WindowDisplayProvider><DisplayProbe /></WindowDisplayProvider>)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_window_frame_visible', { visible: false }))
    await waitFor(() => expect(screen.getByTestId('display-busy').textContent).toBe('false'))
    expect(screen.getByTestId('frame-visible').textContent).toBe('false')

    fireEvent.keyDown(window, { key: 'F11' })
    await waitFor(() => expect(screen.getByTestId('fullscreen').textContent).toBe('true'))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('fullscreen').textContent).toBe('false'))
    fireEvent.keyDown(window, { key: 'F11' })
    await waitFor(() => expect(screen.getByTestId('fullscreen').textContent).toBe('true'))
    fireEvent.keyDown(window, { key: 'F11' })
    await waitFor(() => expect(screen.getByTestId('fullscreen').textContent).toBe('false'))

    const calls = invoke.mock.calls.map(([command, payload]) => [command, payload])
    expect(calls).toContainEqual(['set_window_fullscreen', { fullscreen: true }])
    expect(calls).toContainEqual(['set_window_fullscreen', { fullscreen: false }])
    expect(calls.at(-1)).toEqual(['set_window_frame_visible', { visible: false }])
})

test('rolls back the frame preference when the native update fails', async () => {
    let initializationComplete = false
    const invoke = vi.fn(async (command, payload) => {
        if (command === 'set_window_frame_visible' && initializationComplete && payload.visible === false) {
            throw new Error('native frame failed')
        }
        initializationComplete = true
        return { frameVisible: true, fullscreen: false }
    })
    window.__TAURI_INTERNALS__ = { invoke }

    render(<WindowDisplayProvider><DisplayProbe /></WindowDisplayProvider>)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_window_frame_visible', { visible: true }))
    await waitFor(() => expect(screen.getByTestId('display-busy').textContent).toBe('false'))
    fireEvent.click(screen.getByRole('button', { name: 'toggle-frame' }))

    await waitFor(() => expect(screen.getByTestId('display-error').textContent).toBe('native frame failed'))
    expect(screen.getByTestId('frame-visible').textContent).toBe('true')
    expect(localStorage.getItem('bookreader_window_display')).toBeNull()
})

test('Shift+F11 toggles only the Windows frame', async () => {
    const invoke = vi.fn(async (command, payload) => ({
        frameVisible: command === 'set_window_frame_visible' ? payload.visible : true,
        fullscreen: false,
    }))
    window.__TAURI_INTERNALS__ = { invoke }

    render(<WindowDisplayProvider><DisplayProbe /></WindowDisplayProvider>)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_window_frame_visible', { visible: true }))
    await waitFor(() => expect(screen.getByTestId('display-busy').textContent).toBe('false'))
    fireEvent.keyDown(window, { key: 'F11', shiftKey: true })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_window_frame_visible', { visible: false }))
    expect(invoke.mock.calls.some(([command]) => command === 'set_window_fullscreen')).toBe(false)
})

test('disabled shortcuts ignore F11 but retain Escape as a fullscreen safety action', async () => {
    localStorage.setItem('bookreader_settings', JSON.stringify({ keyboardShortcutsEnabled: false }))
    let fullscreen = true
    const invoke = vi.fn(async (command, payload) => {
        if (command === 'set_window_fullscreen') fullscreen = payload.fullscreen
        return { frameVisible: true, fullscreen }
    })
    window.__TAURI_INTERNALS__ = { invoke }

    render(
        <KeyboardShortcutsProvider>
            <WindowDisplayProvider><DisplayProbe /></WindowDisplayProvider>
        </KeyboardShortcutsProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('fullscreen').textContent).toBe('true'))
    await waitFor(() => expect(screen.getByTestId('display-busy').textContent).toBe('false'))

    fireEvent.keyDown(window, { key: 'F11' })
    expect(invoke.mock.calls.some(([command]) => command === 'set_window_fullscreen')).toBe(false)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_window_fullscreen', { fullscreen: false }))
})

test('ignores overlapping F11 requests until the native fullscreen update finishes', async () => {
    let finishFullscreen
    const invoke = vi.fn((command, payload) => {
        if (command === 'set_window_frame_visible') {
            return Promise.resolve({ frameVisible: payload.visible, fullscreen: false })
        }
        if (command === 'set_window_fullscreen') {
            return new Promise((resolve) => {
                finishFullscreen = () => resolve({ frameVisible: true, fullscreen: payload.fullscreen })
            })
        }
        return Promise.resolve({ frameVisible: true, fullscreen: false })
    })
    window.__TAURI_INTERNALS__ = { invoke }

    render(<WindowDisplayProvider><DisplayProbe /></WindowDisplayProvider>)
    await waitFor(() => expect(screen.getByTestId('display-busy').textContent).toBe('false'))

    fireEvent.keyDown(window, { key: 'F11' })
    fireEvent.keyDown(window, { key: 'F11' })

    expect(invoke.mock.calls.filter(([command]) => command === 'set_window_fullscreen')).toHaveLength(1)
    finishFullscreen()
    await waitFor(() => expect(screen.getByTestId('fullscreen').textContent).toBe('true'))
})

test('ignores overlapping Shift+F11 requests until the native frame update finishes', async () => {
    let initialized = false
    let finishFrameUpdate
    const invoke = vi.fn((command, payload) => {
        if (command !== 'set_window_frame_visible') {
            return Promise.resolve({ frameVisible: true, fullscreen: false })
        }
        if (!initialized) {
            initialized = true
            return Promise.resolve({ frameVisible: payload.visible, fullscreen: false })
        }
        return new Promise((resolve) => {
            finishFrameUpdate = () => resolve({ frameVisible: payload.visible, fullscreen: false })
        })
    })
    window.__TAURI_INTERNALS__ = { invoke }

    render(<WindowDisplayProvider><DisplayProbe /></WindowDisplayProvider>)
    await waitFor(() => expect(screen.getByTestId('display-busy').textContent).toBe('false'))

    fireEvent.keyDown(window, { key: 'F11', shiftKey: true })
    fireEvent.keyDown(window, { key: 'F11', shiftKey: true })

    expect(invoke.mock.calls.filter(([command]) => command === 'set_window_frame_visible')).toHaveLength(2)
    finishFrameUpdate()
    await waitFor(() => expect(screen.getByTestId('frame-visible').textContent).toBe('false'))
})
