import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
    getWindowDisplayState,
    getWindowDisplaySupport,
    setWindowFrameVisible,
    setWindowFullscreen,
} from '../lib/windowDisplay'

const STORAGE_KEY = 'bookreader_window_display'

function loadPreference() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
        return { showWindowFrame: parsed?.showWindowFrame !== false }
    } catch {
        return { showWindowFrame: true }
    }
}

function persistPreference(showWindowFrame) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ showWindowFrame: Boolean(showWindowFrame) }))
    } catch {
        // Keep the current session usable when storage is unavailable.
    }
}

const DEFAULT_VALUE = {
    showWindowFrame: true,
    setShowWindowFrame: async () => {},
    isFullscreen: false,
    toggleFullscreen: async () => {},
    frameControlSupported: false,
    fullscreenSupported: false,
    windowDisplayBusy: false,
    windowDisplayError: '',
    clearWindowDisplayError: () => {},
}

const WindowDisplayContext = createContext(DEFAULT_VALUE)

export function WindowDisplayProvider({ children }) {
    const initialPreference = useMemo(loadPreference, [])
    const support = useMemo(() => getWindowDisplaySupport(), [])
    const [showWindowFrame, setShowWindowFrameState] = useState(initialPreference.showWindowFrame)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [windowDisplayBusy, setWindowDisplayBusy] = useState(false)
    const [windowDisplayError, setWindowDisplayError] = useState('')
    const framePreferenceRef = useRef(initialPreference.showWindowFrame)
    const fullscreenRef = useRef(false)

    useEffect(() => {
        framePreferenceRef.current = showWindowFrame
    }, [showWindowFrame])

    useEffect(() => {
        fullscreenRef.current = isFullscreen
    }, [isFullscreen])

    useEffect(() => {
        let active = true
        const initialize = async () => {
            try {
                const state = support.frameControlSupported
                    ? await setWindowFrameVisible(framePreferenceRef.current)
                    : await getWindowDisplayState()
                if (active) setIsFullscreen(state.fullscreen)
            } catch (error) {
                if (active) setWindowDisplayError(error?.message || String(error))
            }
        }
        void initialize()
        return () => {
            active = false
        }
    }, [support.frameControlSupported])

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const syncBrowserFullscreen = () => {
            if (!support.frameControlSupported) setIsFullscreen(Boolean(document.fullscreenElement))
        }
        document.addEventListener('fullscreenchange', syncBrowserFullscreen)
        return () => document.removeEventListener('fullscreenchange', syncBrowserFullscreen)
    }, [support.frameControlSupported])

    const setShowWindowFrame = useCallback(async (visible) => {
        if (!support.frameControlSupported) return
        const next = Boolean(visible)
        const previous = framePreferenceRef.current
        framePreferenceRef.current = next
        setShowWindowFrameState(next)
        setWindowDisplayBusy(true)
        setWindowDisplayError('')
        try {
            const state = await setWindowFrameVisible(next)
            persistPreference(next)
            setIsFullscreen(state.fullscreen)
        } catch (error) {
            framePreferenceRef.current = previous
            setShowWindowFrameState(previous)
            setWindowDisplayError(error?.message || String(error))
        } finally {
            setWindowDisplayBusy(false)
        }
    }, [support.frameControlSupported])

    const setFullscreen = useCallback(async (fullscreen) => {
        if (!support.fullscreenSupported) return
        setWindowDisplayBusy(true)
        setWindowDisplayError('')
        try {
            let state = await setWindowFullscreen(Boolean(fullscreen))
            if (!fullscreen && support.frameControlSupported) {
                state = await setWindowFrameVisible(framePreferenceRef.current)
            }
            setIsFullscreen(state.fullscreen)
        } catch (error) {
            setWindowDisplayError(error?.message || String(error))
            try {
                const state = await getWindowDisplayState()
                setIsFullscreen(state.fullscreen)
            } catch {
                // Preserve the last known state when recovery also fails.
            }
        } finally {
            setWindowDisplayBusy(false)
        }
    }, [support.frameControlSupported, support.fullscreenSupported])

    const toggleFullscreen = useCallback(async () => {
        await setFullscreen(!fullscreenRef.current)
    }, [setFullscreen])

    useEffect(() => {
        if (!support.fullscreenSupported || typeof window === 'undefined') return undefined
        const handleFullscreenShortcut = (event) => {
            if (event.repeat) return
            if (event.key === 'F11') {
                event.preventDefault()
                void toggleFullscreen()
                return
            }
            if (
                event.key === 'Escape'
                && fullscreenRef.current
                && !event.defaultPrevented
                && !document.querySelector('[role="dialog"][aria-modal="true"]')
            ) {
                event.preventDefault()
                void setFullscreen(false)
            }
        }
        window.addEventListener('keydown', handleFullscreenShortcut)
        return () => window.removeEventListener('keydown', handleFullscreenShortcut)
    }, [setFullscreen, support.fullscreenSupported, toggleFullscreen])

    const value = useMemo(() => ({
        showWindowFrame,
        setShowWindowFrame,
        isFullscreen,
        toggleFullscreen,
        frameControlSupported: support.frameControlSupported,
        fullscreenSupported: support.fullscreenSupported,
        windowDisplayBusy,
        windowDisplayError,
        clearWindowDisplayError: () => setWindowDisplayError(''),
    }), [
        isFullscreen,
        setShowWindowFrame,
        showWindowFrame,
        support.frameControlSupported,
        support.fullscreenSupported,
        toggleFullscreen,
        windowDisplayBusy,
        windowDisplayError,
    ])

    return createElement(WindowDisplayContext.Provider, { value }, children)
}

export function useWindowDisplay() {
    return useContext(WindowDisplayContext)
}
