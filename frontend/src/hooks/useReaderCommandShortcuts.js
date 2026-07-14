import { useEffect } from 'react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest(
        'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="tab"], [role="slider"]',
    ))
}

function runShortcut(event, action) {
    if (typeof action !== 'function') return false
    event.preventDefault()
    event.stopPropagation()
    action()
    return true
}

function matchesPhysicalKey(event, code, fallbackKey = '') {
    if (event.code === code) return true
    return fallbackKey ? event.key?.toLowerCase() === fallbackKey : false
}

/**
 * App-specific reader commands. Page-turn keys remain in useKeyboardNav so they
 * can repeat, while the commands here are intentionally single-fire actions.
 */
export function useReaderCommandShortcuts({
    enabled = true,
    settingsShortcutEnabled = true,
    searchShortcutEnabled = true,
    onBack,
    onFirstPage,
    onLastPage,
    onSearch,
    onAddBookmark,
    onToggleBookmarkBar,
    onToggleToc,
    onToggleAnnotations,
    onToggleLayout,
    onDecreaseScale,
    onIncreaseScale,
    onToggleSettings,
}) {
    const { keyboardShortcutsEnabled } = useKeyboardShortcuts()

    useEffect(() => {
        if (!keyboardShortcutsEnabled) return undefined

        const handleKeyDown = (event) => {
            if (event.defaultPrevented || event.repeat || event.isComposing) return

            const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
            if (
                settingsShortcutEnabled
                && ctrlOnly
                && (event.code === 'Comma' || event.key === ',')
                && runShortcut(event, onToggleSettings)
            ) return

            if (
                searchShortcutEnabled
                && ctrlOnly
                && matchesPhysicalKey(event, 'KeyF', 'f')
                && runShortcut(event, onSearch)
            ) return

            if (!enabled || isInteractiveTarget(event.target)) return

            if (
                event.altKey
                && !event.ctrlKey
                && !event.metaKey
                && !event.shiftKey
                && event.key === 'ArrowLeft'
                && runShortcut(event, onBack)
            ) return

            if (event.ctrlKey || event.altKey || event.metaKey) return

            if (!event.shiftKey && event.key === 'Home' && runShortcut(event, onFirstPage)) return
            if (!event.shiftKey && event.key === 'End' && runShortcut(event, onLastPage)) return

            if (matchesPhysicalKey(event, 'KeyB', 'b')) {
                if (event.shiftKey) runShortcut(event, onToggleBookmarkBar)
                else runShortcut(event, onAddBookmark)
                return
            }

            if (event.shiftKey) return
            if (matchesPhysicalKey(event, 'KeyT', 't') && runShortcut(event, onToggleToc)) return
            if (matchesPhysicalKey(event, 'KeyM', 'm') && runShortcut(event, onToggleAnnotations)) return
            if (matchesPhysicalKey(event, 'KeyL', 'l') && runShortcut(event, onToggleLayout)) return
            if ((event.code === 'BracketLeft' || event.key === '[') && runShortcut(event, onDecreaseScale)) return
            if (event.code === 'BracketRight' || event.key === ']') runShortcut(event, onIncreaseScale)
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [
        enabled,
        keyboardShortcutsEnabled,
        onAddBookmark,
        onBack,
        onDecreaseScale,
        onFirstPage,
        onIncreaseScale,
        onLastPage,
        onSearch,
        onToggleAnnotations,
        onToggleBookmarkBar,
        onToggleLayout,
        onToggleSettings,
        onToggleToc,
        searchShortcutEnabled,
        settingsShortcutEnabled,
    ])
}
