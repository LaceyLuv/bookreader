// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { captureEpubBookmarkAnchor, findNearestTextOffset, resolveEpubBookmarkPage } from './epubBookmarkAnchor'

test('finds the quote occurrence nearest to the durable EPUB text offset', () => {
    const text = 'repeat near the start — filler filler filler — repeat near the end'

    expect(findNearestTextOffset(text, 'repeat', 0)).toBe(0)
    expect(findNearestTextOffset(text, 'repeat', text.length)).toBe(text.lastIndexOf('repeat'))
    expect(findNearestTextOffset(text, 'missing', 0)).toBeNull()
})

test('captures a text anchor from the visible column and resolves it after repagination', () => {
    const scroller = document.createElement('div')
    const root = document.createElement('div')
    root.innerHTML = '<style>.epub-content { color: black; }</style><span data-left="10">First page text. </span><span data-left="110">Second page anchor text.</span>'
    scroller.appendChild(root)
    document.body.appendChild(scroller)
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, value: 0, writable: true })
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 })

    const originalRects = Range.prototype.getClientRects
    Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value() {
            const element = this.startContainer?.parentElement
            const left = Number(element?.dataset?.left || 0)
            return [{ left, top: 0, right: left + 8, bottom: 16, width: 8, height: 16 }]
        },
    })

    const anchor = captureEpubBookmarkAnchor(root, scroller, 1, 100)
    expect(anchor.textOffset).toBe('First page text. '.length)
    expect(anchor.quote.exact).toContain('Second page anchor text.')

    root.querySelector('[data-left="110"]').dataset.left = '210'
    expect(resolveEpubBookmarkPage(root, scroller, anchor, 200, 3)).toBe(1)

    if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: originalRects })
    else delete Range.prototype.getClientRects
    scroller.remove()
})
