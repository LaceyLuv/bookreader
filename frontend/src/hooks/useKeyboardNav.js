import { useCallback, useEffect } from 'react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest(
        'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="tab"], [role="slider"]',
    ))
}

function restoreReaderFocus(readerRootRef) {
    const target = readerRootRef?.current
    if (target instanceof HTMLElement && document.activeElement !== target) {
        target.focus({ preventScroll: true })
    }
}

function isNextKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false
    return e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.code === 'Space'
}

function isPrevKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return false
    if ((e.key === ' ' || e.code === 'Space') && e.shiftKey) return true
    if (e.shiftKey) return false
    return e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp'
}

function isHandledKey(e, hasEscapeHandler) {
    return isNextKey(e) || isPrevKey(e) || (hasEscapeHandler && e.key === 'Escape')
}

/**
 * Keyboard navigation hook for paginated readers.
 * - ArrowLeft / ArrowUp / PageUp: previous page
 * - ArrowRight / ArrowDown / PageDown / Space: next page
 * - Shift+Space: previous page
 */
export function useKeyboardNav({ onNext, onPrev, onEscape, enabled = true, readerRootRef = null }) {
    const { keyboardShortcutsEnabled } = useKeyboardShortcuts()
    const handler = useCallback((e) => {
        if (!enabled || e.isComposing) return
        if (isInteractiveTarget(e.target)) return

        if (e.key === 'Escape' && onEscape) {
            e.preventDefault()
            e.stopPropagation()
            onEscape?.()
            return
        }
        if (!keyboardShortcutsEnabled) return

        restoreReaderFocus(readerRootRef)

        if (isPrevKey(e)) {
            e.preventDefault()
            e.stopPropagation()
            onPrev?.()
        } else if (isNextKey(e)) {
            e.preventDefault()
            e.stopPropagation()
            onNext?.()
        }
    }, [onNext, onPrev, onEscape, enabled, keyboardShortcutsEnabled, readerRootRef])

    const preventHandledKeyup = useCallback((e) => {
        if (!enabled || e.isComposing) return
        if (isInteractiveTarget(e.target)) return
        if (!keyboardShortcutsEnabled && e.key !== 'Escape') return
        if (!isHandledKey(e, !!onEscape)) return
        e.preventDefault()
        e.stopPropagation()
    }, [enabled, keyboardShortcutsEnabled, onEscape])

    useEffect(() => {
        window.addEventListener('keydown', handler, true)
        window.addEventListener('keyup', preventHandledKeyup, true)
        return () => {
            window.removeEventListener('keydown', handler, true)
            window.removeEventListener('keyup', preventHandledKeyup, true)
        }
    }, [handler, preventHandledKeyup])
}
