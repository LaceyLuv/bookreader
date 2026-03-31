function normalizeSelectionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

export function clearCurrentSelection() {
    if (typeof window === 'undefined') return
    const selection = window.getSelection()
    selection?.removeAllRanges()
}

export function getSelectionSnapshot(root) {
    if (!root || typeof window === 'undefined') return null
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

    const range = selection.getRangeAt(0)
    const commonAncestor = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer?.parentElement
    if (!commonAncestor || !root.contains(commonAncestor)) return null

    const selectedText = normalizeSelectionText(selection.toString())
    if (!selectedText) return null

    const measurementRange = range.cloneRange()
    measurementRange.selectNodeContents(root)
    measurementRange.setEnd(range.startContainer, range.startOffset)
    const startOffset = measurementRange.toString().length
    const endOffset = startOffset + range.toString().length
    if (endOffset <= startOffset) return null

    const rect = range.getBoundingClientRect()
    const viewportWidth = window.innerWidth || 1280
    const viewportHeight = window.innerHeight || 720
    const centerX = clamp(rect.left + (rect.width / 2), 80, viewportWidth - 80)
    const top = rect.top > 96 ? rect.top - 56 : rect.bottom + 16
    const topY = clamp(top, 16, viewportHeight - 80)

    return {
        selectedText,
        startOffset,
        endOffset,
        snippet: selectedText.length > 180 ? `${selectedText.slice(0, 177)}...` : selectedText,
        rect: {
            left: centerX,
            top: topY,
        },
    }
}
