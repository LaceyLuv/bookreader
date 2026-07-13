// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { useWindowDisplay, WindowDisplayProvider } from './useWindowDisplay'

function DisplayProbe() {
    const display = useWindowDisplay()
    return (
        <>
            <output data-testid="frame-visible">{String(display.showWindowFrame)}</output>
            <output data-testid="fullscreen">{String(display.isFullscreen)}</output>
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
    fireEvent.click(screen.getByRole('button', { name: 'toggle-frame' }))

    await waitFor(() => expect(screen.getByTestId('display-error').textContent).toBe('native frame failed'))
    expect(screen.getByTestId('frame-visible').textContent).toBe('true')
    expect(localStorage.getItem('bookreader_window_display')).toBeNull()
})
