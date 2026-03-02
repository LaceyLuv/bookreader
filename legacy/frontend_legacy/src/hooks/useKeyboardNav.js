import { useCallback, useEffect } from 'react'

/**
 * Keyboard navigation hook for paginated readers.
 * - ArrowLeft / ArrowUp / PageUp: previous page
 * - ArrowRight / ArrowDown / PageDown / Space: next page
 * - Shift+Space: previous page
 */
export function useKeyboardNav({ onNext, onPrev, onEscape, enabled = true }) {
    const handler = useCallback((e) => {
        if (!enabled) return
        // Don't capture if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return

        if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
            e.preventDefault()
            onPrev?.()
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
            e.preventDefault()
            onNext?.()
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            onPrev?.()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            onEscape?.()
        }
    }, [onNext, onPrev, onEscape, enabled])

    useEffect(() => {
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [handler])
}
