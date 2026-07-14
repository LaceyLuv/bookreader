const QUOTE_LENGTH = 180
const CONTEXT_LENGTH = 40

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

function getTextWalker(root) {
    const documentRef = root?.ownerDocument
    if (!documentRef?.createTreeWalker) return null
    const showText = documentRef.defaultView?.NodeFilter?.SHOW_TEXT ?? 4
    return documentRef.createTreeWalker(root, showText)
}

function isReadableTextNode(node) {
    const parent = node?.parentElement
    if (!parent) return false
    return !parent.closest('style, script, noscript, template, [hidden], [aria-hidden="true"]')
}

function nextReadableTextNode(walker) {
    let node = walker?.nextNode?.() || null
    while (node && !isReadableTextNode(node)) node = walker.nextNode()
    return node
}

function getReadableText(root) {
    const walker = getTextWalker(root)
    if (!walker) return ''
    let text = ''
    let node = nextReadableTextNode(walker)
    while (node) {
        text += String(node.nodeValue || '')
        node = nextReadableTextNode(walker)
    }
    return text
}

function getRangeRects(range) {
    if (!range) return []
    const isVisibleRect = (rect) => Number.isFinite(rect?.left) && ((Number(rect.width) || 0) > 0 || (Number(rect.height) || 0) > 0)
    const rects = typeof range.getClientRects === 'function'
        ? Array.from(range.getClientRects()).filter(isVisibleRect)
        : []
    if (rects.length > 0) return rects
    if (typeof range.getBoundingClientRect !== 'function') return []
    const rect = range.getBoundingClientRect()
    return isVisibleRect(rect) ? [rect] : []
}

function resolveTextPoint(root, requestedOffset) {
    const walker = getTextWalker(root)
    if (!walker) return null
    const totalLength = getReadableText(root).length
    const targetOffset = clamp(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0, Math.max(0, totalLength - 1))
    let consumed = 0
    let node = nextReadableTextNode(walker)
    while (node) {
        const length = String(node.nodeValue || '').length
        if (targetOffset < consumed + length) {
            return { node, offset: targetOffset - consumed }
        }
        consumed += length
        node = nextReadableTextNode(walker)
    }
    return null
}

function getCharacterPage(root, scroller, textOffset, step) {
    if (!root || !scroller || !(step > 0)) return null
    const point = resolveTextPoint(root, textOffset)
    if (!point) return null
    const text = String(point.node.nodeValue || '')
    const initialOffset = clamp(point.offset, 0, Math.max(0, text.length - 1))
    const viewport = scroller.getBoundingClientRect?.()
    if (!viewport) return null
    const range = root.ownerDocument?.createRange?.()
    if (!range) return null
    const scanEnd = Math.min(text.length, initialOffset + 32)
    for (let offset = initialOffset; offset < scanEnd; offset += 1) {
        if (/\s/.test(text[offset])) continue
        range.setStart(point.node, offset)
        range.setEnd(point.node, Math.min(text.length, offset + 1))
        const rect = getRangeRects(range)[0]
        if (!rect) continue
        const logicalLeft = rect.left - viewport.left + (Number(scroller.scrollLeft) || 0)
        if (Number.isFinite(logicalLeft)) return Math.max(0, Math.floor((logicalLeft + 0.5) / step))
    }
    return null
}

function findTextOffsetForPage(root, scroller, targetPage, step) {
    const walker = getTextWalker(root)
    if (!walker) return null
    let consumed = 0
    let node = nextReadableTextNode(walker)

    while (node) {
        const text = String(node.nodeValue || '')
        const firstText = text.search(/\S/)
        if (firstText >= 0) {
            let lastText = text.length - 1
            while (lastText > firstText && /\s/.test(text[lastText])) lastText -= 1
            const firstPage = getCharacterPage(root, scroller, consumed + firstText, step)
            const lastPage = getCharacterPage(root, scroller, consumed + lastText, step)
            if (firstPage === targetPage) return consumed + firstText
            if (Number.isFinite(firstPage) && Number.isFinite(lastPage)
                && firstPage < targetPage && lastPage >= targetPage) {
                let low = firstText
                let high = lastText
                while (low < high) {
                    const middle = Math.floor((low + high) / 2)
                    const middlePage = getCharacterPage(root, scroller, consumed + middle, step)
                    if (!Number.isFinite(middlePage) || middlePage >= targetPage) high = middle
                    else low = middle + 1
                }
                while (low <= lastText && /\s/.test(text[low])) low += 1
                if (getCharacterPage(root, scroller, consumed + low, step) === targetPage) return consumed + low
            }
        }
        consumed += text.length
        node = nextReadableTextNode(walker)
    }
    return null
}

export function findNearestTextOffset(text, exact, preferredOffset = 0) {
    if (!exact) return null
    const source = String(text || '')
    const needle = String(exact)
    let match = source.indexOf(needle)
    if (match < 0) return null
    let nearest = match
    let nearestDistance = Math.abs(match - preferredOffset)
    while (match >= 0) {
        const distance = Math.abs(match - preferredOffset)
        if (distance < nearestDistance) {
            nearest = match
            nearestDistance = distance
        }
        match = source.indexOf(needle, match + 1)
    }
    return nearest
}

export function captureEpubBookmarkAnchor(root, scroller, currentPage, step, selection = null) {
    if (!root || !scroller || !(step > 0)) return null
    const text = getReadableText(root)
    if (!text) return null

    const selectedText = typeof selection?.selectedText === 'string' ? selection.selectedText.trim() : ''
    const selectedOffset = selectedText
        ? findNearestTextOffset(text, selectedText, Number.isFinite(selection?.startOffset) ? selection.startOffset : 0)
        : null
    let textOffset = Number.isFinite(selectedOffset)
        ? selectedOffset
        : findTextOffsetForPage(root, scroller, Math.max(0, currentPage || 0), step)
    if (!Number.isFinite(textOffset)) return null
    textOffset = clamp(textOffset, 0, Math.max(0, text.length - 1))
    while (textOffset < text.length - 1 && /\s/.test(text[textOffset])) textOffset += 1

    const exact = selectedText || text.slice(textOffset, textOffset + QUOTE_LENGTH).trimEnd()
    return {
        textOffset,
        offsetUnit: 'utf16-code-unit-v1',
        quote: {
            exact,
            prefix: text.slice(Math.max(0, textOffset - CONTEXT_LENGTH), textOffset),
            suffix: text.slice(textOffset + exact.length, textOffset + exact.length + CONTEXT_LENGTH),
        },
    }
}

export function resolveEpubBookmarkPage(root, scroller, anchor, step, totalPages = Number.POSITIVE_INFINITY) {
    if (!root || !scroller || !anchor || !(step > 0)) return null
    const text = getReadableText(root)
    const preferredOffset = Number.isFinite(anchor.textOffset) ? anchor.textOffset : 0
    const quoteOffset = findNearestTextOffset(text, anchor.quote?.exact, preferredOffset)
    const textOffset = Number.isFinite(quoteOffset) ? quoteOffset : anchor.textOffset
    if (!Number.isFinite(textOffset)) return null
    const page = getCharacterPage(root, scroller, textOffset, step)
    if (!Number.isFinite(page)) return null
    const maxPage = Number.isFinite(totalPages) ? Math.max(0, totalPages - 1) : page
    return clamp(page, 0, maxPage)
}
