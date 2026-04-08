import { useCallback, useEffect } from 'react'

function isTextEntryTarget(target) {
    if (!(target instanceof Element)) return false
    const editable = target.closest('input, textarea, [contenteditable="true"]')
    if (!editable) return false
    if (editable instanceof HTMLInputElement) {
        return !['range', 'button', 'checkbox', 'radio'].includes(editable.type)
    }
    return true
}

function restoreReaderFocus(readerRootRef) {
    const target = readerRootRef?.current
    if (target instanceof HTMLElement && document.activeElement !== target) {
        target.focus({ preventScroll: true })
    }
}

function isNextKey(e) {
    return e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.code === 'Space'
}

function isPrevKey(e) {
    return e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || ((e.key === ' ' || e.code === 'Space') && e.shiftKey)
}

function isHandledKey(e) {
    return isNextKey(e) || isPrevKey(e) || e.key === 'Escape'
}

/**
 * Keyboard navigation hook for paginated readers.
 * - ArrowLeft / ArrowUp / PageUp: previous page
 * - ArrowRight / ArrowDown / PageDown / Space: next page
 * - Shift+Space: previous page
 */
export function useKeyboardNav({ onNext, onPrev, onEscape, enabled = true, readerRootRef = null }) {
    const handler = useCallback((e) => {
        if (!enabled) return
        if (isTextEntryTarget(e.target)) return

        restoreReaderFocus(readerRootRef)

        if (isPrevKey(e)) {
            e.preventDefault()
            e.stopPropagation()
            onPrev?.()
        } else if (isNextKey(e)) {
            e.preventDefault()
            e.stopPropagation()
            onNext?.()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onEscape?.()
        }
    }, [onNext, onPrev, onEscape, enabled, readerRootRef])

    const preventHandledKeyup = useCallback((e) => {
        if (!enabled) return
        if (isTextEntryTarget(e.target)) return
        if (!isHandledKey(e)) return
        e.preventDefault()
        e.stopPropagation()
    }, [enabled])

    useEffect(() => {
        window.addEventListener('keydown', handler, true)
        window.addEventListener('keyup', preventHandledKeyup, true)
        return () => {
            window.removeEventListener('keydown', handler, true)
            window.removeEventListener('keyup', preventHandledKeyup, true)
        }
    }, [handler, preventHandledKeyup])
}
