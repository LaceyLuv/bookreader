import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const SETTINGS_STORAGE_KEY = 'bookreader_settings'

function readKeyboardShortcutsEnabled() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}')
        return saved?.keyboardShortcutsEnabled !== false
    } catch {
        return true
    }
}

function persistKeyboardShortcutsEnabled(enabled) {
    let settings = {}
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}')
        settings = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
    } catch {
        // Recover a damaged settings value instead of making the switch session-only.
    }

    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
            ...settings,
            keyboardShortcutsEnabled: Boolean(enabled),
        }))
    } catch {
        // Keep the current session usable when storage is unavailable.
    }
}

const KeyboardShortcutsContext = createContext({
    keyboardShortcutsEnabled: true,
    setKeyboardShortcutsEnabled: () => {},
})

export function KeyboardShortcutsProvider({ children }) {
    const [keyboardShortcutsEnabled, setEnabledState] = useState(readKeyboardShortcutsEnabled)

    const setKeyboardShortcutsEnabled = useCallback((value) => {
        setEnabledState((previous) => {
            const next = typeof value === 'function' ? Boolean(value(previous)) : Boolean(value)
            persistKeyboardShortcutsEnabled(next)
            return next
        })
    }, [])

    useEffect(() => {
        const syncFromStorage = (event) => {
            if (event.key && event.key !== SETTINGS_STORAGE_KEY) return
            setEnabledState(readKeyboardShortcutsEnabled())
        }
        window.addEventListener('storage', syncFromStorage)
        return () => window.removeEventListener('storage', syncFromStorage)
    }, [])

    const value = useMemo(() => ({
        keyboardShortcutsEnabled,
        setKeyboardShortcutsEnabled,
    }), [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled])

    return createElement(KeyboardShortcutsContext.Provider, { value }, children)
}

export function useKeyboardShortcuts() {
    return useContext(KeyboardShortcutsContext)
}

export { readKeyboardShortcutsEnabled }
