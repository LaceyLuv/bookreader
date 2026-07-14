function getTauriInvoke(windowLike = globalThis.window) {
    const invoke = windowLike?.__TAURI_INTERNALS__?.invoke
    return typeof invoke === 'function' ? invoke.bind(windowLike.__TAURI_INTERNALS__) : null
}

function getBrowserFullscreen(documentLike = globalThis.document) {
    return Boolean(documentLike?.fullscreenElement)
}

export function getWindowDisplaySupport(
    windowLike = globalThis.window,
    documentLike = globalThis.document,
) {
    const desktop = Boolean(getTauriInvoke(windowLike))
    const browserFullscreen = Boolean(
        documentLike?.documentElement?.requestFullscreen
        && documentLike?.exitFullscreen,
    )
    return {
        frameControlSupported: desktop,
        fullscreenSupported: desktop || browserFullscreen,
    }
}

function normalizeDesktopState(value) {
    return {
        frameVisible: value?.frameVisible !== false,
        fullscreen: value?.fullscreen === true,
    }
}

export async function getWindowDisplayState(
    windowLike = globalThis.window,
    documentLike = globalThis.document,
) {
    const invoke = getTauriInvoke(windowLike)
    if (invoke) {
        return normalizeDesktopState(await invoke('get_window_display_state'))
    }
    return {
        frameVisible: true,
        fullscreen: getBrowserFullscreen(documentLike),
    }
}

export async function setWindowFrameVisible(
    visible,
    windowLike = globalThis.window,
    documentLike = globalThis.document,
) {
    const invoke = getTauriInvoke(windowLike)
    if (!invoke) return getWindowDisplayState(windowLike, documentLike)
    return normalizeDesktopState(await invoke('set_window_frame_visible', { visible: Boolean(visible) }))
}

export async function setWindowFullscreen(
    fullscreen,
    windowLike = globalThis.window,
    documentLike = globalThis.document,
) {
    const invoke = getTauriInvoke(windowLike)
    if (invoke) {
        return normalizeDesktopState(await invoke('set_window_fullscreen', { fullscreen: Boolean(fullscreen) }))
    }

    const shouldEnter = Boolean(fullscreen)
    if (shouldEnter && !documentLike?.fullscreenElement) {
        const requestFullscreen = documentLike?.documentElement?.requestFullscreen
        if (typeof requestFullscreen !== 'function') throw new Error('Fullscreen is unavailable.')
        await requestFullscreen.call(documentLike.documentElement)
    } else if (!shouldEnter && documentLike?.fullscreenElement) {
        const exitFullscreen = documentLike?.exitFullscreen
        if (typeof exitFullscreen !== 'function') throw new Error('Fullscreen is unavailable.')
        await exitFullscreen.call(documentLike)
    }

    return {
        frameVisible: true,
        fullscreen: getBrowserFullscreen(documentLike),
    }
}
