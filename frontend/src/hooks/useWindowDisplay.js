import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
    getWindowDisplayState,
    getWindowDisplaySupport,
    setWindowFrameVisible,
    setWindowFullscreen,
} from '../lib/windowDisplay'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

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
    const { keyboardShortcutsEnabled } = useKeyboardShortcuts()
    const initialPreference = useMemo(loadPreference, [])
    const support = useMemo(() => getWindowDisplaySupport(), [])
    const [showWindowFrame, setShowWindowFrameState] = useState(initialPreference.showWindowFrame)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [windowDisplayBusy, setWindowDisplayBusy] = useState(true)
    const [windowDisplayError, setWindowDisplayError] = useState('')
    const framePreferenceRef = useRef(initialPreference.showWindowFrame)
    const fullscreenRef = useRef(false)
    const displayOperationBusyRef = useRef(true)
    const initializationGenerationRef = useRef(0)

    useEffect(() => {
        framePreferenceRef.current = showWindowFrame
    }, [showWindowFrame])

    useEffect(() => {
        fullscreenRef.current = isFullscreen
    }, [isFullscreen])

    useEffect(() => {
        let active = true
        const generation = initializationGenerationRef.current + 1
        initializationGenerationRef.current = generation
        displayOperationBusyRef.current = true
        setWindowDisplayBusy(true)
        const initialize = async () => {
            try {
                const state = support.frameControlSupported
                    ? await setWindowFrameVisible(framePreferenceRef.current)
                    : await getWindowDisplayState()
                if (active) {
                    fullscreenRef.current = state.fullscreen
                    setIsFullscreen(state.fullscreen)
                }
            } catch (error) {
                if (active) setWindowDisplayError(error?.message || String(error))
            } finally {
                if (active && initializationGenerationRef.current === generation) {
                    displayOperationBusyRef.current = false
                    setWindowDisplayBusy(false)
                }
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
            if (!support.frameControlSupported) {
                const fullscreen = Boolean(document.fullscreenElement)
                fullscreenRef.current = fullscreen
                setIsFullscreen(fullscreen)
            }
        }
        document.addEventListener('fullscreenchange', syncBrowserFullscreen)
        return () => document.removeEventListener('fullscreenchange', syncBrowserFullscreen)
    }, [support.frameControlSupported])

    const setShowWindowFrame = useCallback(async (visible) => {
        if (!support.frameControlSupported || displayOperationBusyRef.current) return
        displayOperationBusyRef.current = true
        const next = Boolean(visible)
        const previous = framePreferenceRef.current
        framePreferenceRef.current = next
        setShowWindowFrameState(next)
        setWindowDisplayBusy(true)
        setWindowDisplayError('')
        try {
            const state = await setWindowFrameVisible(next)
            persistPreference(next)
            fullscreenRef.current = state.fullscreen
            setIsFullscreen(state.fullscreen)
        } catch (error) {
            framePreferenceRef.current = previous
            setShowWindowFrameState(previous)
            setWindowDisplayError(error?.message || String(error))
        } finally {
            displayOperationBusyRef.current = false
            setWindowDisplayBusy(false)
        }
    }, [support.frameControlSupported])

    const setFullscreen = useCallback(async (fullscreen) => {
        if (!support.fullscreenSupported || displayOperationBusyRef.current) return
        displayOperationBusyRef.current = true
        setWindowDisplayBusy(true)
        setWindowDisplayError('')
        try {
            let state = await setWindowFullscreen(Boolean(fullscreen))
            if (!fullscreen && support.frameControlSupported) {
                state = await setWindowFrameVisible(framePreferenceRef.current)
            }
            fullscreenRef.current = state.fullscreen
            setIsFullscreen(state.fullscreen)
        } catch (error) {
            setWindowDisplayError(error?.message || String(error))
            try {
                const state = await getWindowDisplayState()
                fullscreenRef.current = state.fullscreen
                setIsFullscreen(state.fullscreen)
            } catch {
                // Preserve the last known state when recovery also fails.
            }
        } finally {
            displayOperationBusyRef.current = false
            setWindowDisplayBusy(false)
        }
    }, [support.frameControlSupported, support.fullscreenSupported])

    const toggleFullscreen = useCallback(async () => {
        await setFullscreen(!fullscreenRef.current)
    }, [setFullscreen])

    useEffect(() => {
        if ((!support.fullscreenSupported && !support.frameControlSupported) || typeof window === 'undefined') return undefined
        const handleFullscreenShortcut = (event) => {
            if (event.repeat) return
            if (
                keyboardShortcutsEnabled
                && event.key === 'F11'
                && event.shiftKey
                && !event.ctrlKey
                && !event.altKey
                && !event.metaKey
                && support.frameControlSupported
            ) {
                event.preventDefault()
                void setShowWindowFrame(!framePreferenceRef.current)
                return
            }
            if (
                keyboardShortcutsEnabled
                && support.fullscreenSupported
                && event.key === 'F11'
                && !event.shiftKey
                && !event.ctrlKey
                && !event.altKey
                && !event.metaKey
            ) {
                event.preventDefault()
                void toggleFullscreen()
                return
            }
            if (
                support.fullscreenSupported
                && event.key === 'Escape'
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
    }, [
        keyboardShortcutsEnabled,
        setFullscreen,
        setShowWindowFrame,
        support.frameControlSupported,
        support.fullscreenSupported,
        toggleFullscreen,
    ])

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
