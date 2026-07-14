// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import {
    getWindowDisplayState,
    getWindowDisplaySupport,
    setWindowFrameVisible,
    setWindowFullscreen,
} from './windowDisplay'

test('desktop window display commands use the existing Tauri invoke bridge', async () => {
    const invoke = vi.fn(async (command, payload) => {
        if (command === 'get_window_display_state') return { frameVisible: false, fullscreen: true }
        if (command === 'set_window_frame_visible') return { frameVisible: payload.visible, fullscreen: false }
        return { frameVisible: true, fullscreen: payload.fullscreen }
    })
    const windowLike = { __TAURI_INTERNALS__: { invoke } }

    expect(getWindowDisplaySupport(windowLike, {})).toEqual({
        frameControlSupported: true,
        fullscreenSupported: true,
    })
    await expect(getWindowDisplayState(windowLike, {})).resolves.toEqual({ frameVisible: false, fullscreen: true })
    await expect(setWindowFrameVisible(false, windowLike, {})).resolves.toEqual({ frameVisible: false, fullscreen: false })
    await expect(setWindowFullscreen(true, windowLike, {})).resolves.toEqual({ frameVisible: true, fullscreen: true })

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_window_display_state')
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_window_frame_visible', { visible: false })
    expect(invoke).toHaveBeenNthCalledWith(3, 'set_window_fullscreen', { fullscreen: true })
})

test('web fullscreen falls back to the browser Fullscreen API', async () => {
    const documentLike = { fullscreenElement: null, documentElement: {} }
    documentLike.documentElement.requestFullscreen = vi.fn(async () => {
        documentLike.fullscreenElement = documentLike.documentElement
    })
    documentLike.exitFullscreen = vi.fn(async () => {
        documentLike.fullscreenElement = null
    })

    expect(getWindowDisplaySupport({}, documentLike)).toEqual({
        frameControlSupported: false,
        fullscreenSupported: true,
    })
    await expect(setWindowFullscreen(true, {}, documentLike)).resolves.toEqual({ frameVisible: true, fullscreen: true })
    await expect(setWindowFullscreen(false, {}, documentLike)).resolves.toEqual({ frameVisible: true, fullscreen: false })
    expect(documentLike.documentElement.requestFullscreen).toHaveBeenCalledOnce()
    expect(documentLike.exitFullscreen).toHaveBeenCalledOnce()
})
