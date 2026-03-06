import { useCallback, useEffect } from 'react'

const INTERACTIVE_SELECTOR = 'input, textarea, select, button, a, [contenteditable="true"], [role="button"]'

function isInteractiveTarget(target) {
    return target instanceof Element && !!target.closest(INTERACTIVE_SELECTOR)
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
export function useKeyboardNav({ onNext, onPrev, onEscape, enabled = true }) {
    const handler = useCallback((e) => {
        if (!enabled) return
        if (isInteractiveTarget(e.target)) return

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
    }, [onNext, onPrev, onEscape, enabled])

    const preventHandledKeyup = useCallback((e) => {
        if (!enabled) return
        if (isInteractiveTarget(e.target)) return
        if (!isHandledKey(e)) return
        e.preventDefault()
        e.stopPropagation()
    }, [enabled])

    useEffect(() => {
        window.addEventListener('keydown', handler)
        window.addEventListener('keyup', preventHandledKeyup)
        return () => {
            window.removeEventListener('keydown', handler)
            window.removeEventListener('keyup', preventHandledKeyup)
        }
    }, [handler, preventHandledKeyup])
}
