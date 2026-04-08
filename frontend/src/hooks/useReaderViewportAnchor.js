import { useCallback, useRef } from 'react'

function defaultResolveRangeAtPoint(root, scroller) {
    const rect = scroller.getBoundingClientRect()
    const pointX = rect.left + Math.min(24, rect.width / 2)
    const pointY = rect.top + Math.min(24, rect.height / 2)

    if (typeof document.caretRangeFromPoint === 'function') {
        return document.caretRangeFromPoint(pointX, pointY)
    }

    if (typeof document.caretPositionFromPoint === 'function') {
        const position = document.caretPositionFromPoint(pointX, pointY)
        if (!position) return null
        const range = document.createRange()
        range.setStart(position.offsetNode, position.offset)
        range.collapse(true)
        return range
    }

    const firstNode = root.firstChild
    if (!(firstNode instanceof Node)) return null
    const range = document.createRange()
    range.setStart(firstNode, 0)
    range.collapse(true)
    return range
}

function createMarker() {
    const marker = document.createElement('span')
    marker.setAttribute('data-reader-anchor', 'true')
    marker.setAttribute('aria-hidden', 'true')
    marker.textContent = '\u200b'
    marker.style.display = 'inline-block'
    marker.style.width = '0'
    marker.style.height = '0'
    marker.style.overflow = 'hidden'
    marker.style.pointerEvents = 'none'
    return marker
}

export function useReaderViewportAnchor(options = {}) {
    const anchorRef = useRef(null)
    const resolveRangeAtPoint = options.resolveRangeAtPoint ?? defaultResolveRangeAtPoint

    const clearAnchor = useCallback(() => {
        const current = anchorRef.current
        if (current?.marker?.isConnected) {
            current.marker.remove()
        }
        anchorRef.current = null
    }, [])

    const captureAnchor = useCallback((root) => {
        const scroller = root?.parentElement
        if (!(root instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null

        clearAnchor()

        const anchor = {
            fallbackScrollLeft: scroller.scrollLeft,
            fallbackScrollTop: scroller.scrollTop,
            marker: null,
        }

        const range = resolveRangeAtPoint(root, scroller)
        if (range) {
            const collapsedRange = range.cloneRange()
            collapsedRange.collapse(true)
            const marker = createMarker()
            collapsedRange.insertNode(marker)
            anchor.marker = marker
        }

        anchorRef.current = anchor
        return anchor
    }, [clearAnchor, resolveRangeAtPoint])

    const restoreAnchor = useCallback((root) => {
        const scroller = root?.parentElement
        const anchor = anchorRef.current
        if (!(root instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !anchor) return false

        if (anchor.marker?.isConnected) {
            anchor.marker.scrollIntoView({ block: 'start', inline: 'start' })
            anchor.marker.remove()
            root.normalize()
        } else {
            scroller.scrollTo({ left: anchor.fallbackScrollLeft, top: anchor.fallbackScrollTop, behavior: 'auto' })
        }

        anchorRef.current = null
        return true
    }, [])

    return {
        anchorRef,
        captureAnchor,
        restoreAnchor,
        clearAnchor,
    }
}
