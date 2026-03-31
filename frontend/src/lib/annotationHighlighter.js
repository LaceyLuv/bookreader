const DEFAULT_COLORS = {
    highlight: 'rgba(255, 212, 59, 0.42)',
    note: 'rgba(76, 201, 240, 0.24)',
}

function getAnnotationNodes(root) {
    if (!root) return []
    return Array.from(root.querySelectorAll('span[data-bookreader-annotation="true"]'))
}

function clearNode(node) {
    const parent = node.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(node.textContent || ''), node)
    parent.normalize()
}

function getTextNodes(root) {
    const nodes = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const value = node.nodeValue || ''
            if (!value) return NodeFilter.FILTER_REJECT
            const parent = node.parentElement
            if (!parent) return NodeFilter.FILTER_REJECT
            if (["SCRIPT", "STYLE"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT
            return NodeFilter.FILTER_ACCEPT
        },
    })

    let offset = 0
    while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.nodeValue || ''
        const nextOffset = offset + text.length
        nodes.push({ node, start: offset, end: nextOffset })
        offset = nextOffset
    }
    return nodes
}

function wrapTextSlice(textNode, startOffset, endOffset, annotation) {
    const value = textNode.nodeValue || ''
    const fragment = document.createDocumentFragment()
    const before = value.slice(0, startOffset)
    const middle = value.slice(startOffset, endOffset)
    const after = value.slice(endOffset)

    if (before) fragment.appendChild(document.createTextNode(before))

    const span = document.createElement('span')
    span.dataset.bookreaderAnnotation = 'true'
    span.dataset.bookreaderAnnotationId = annotation.id
    span.dataset.bookreaderAnnotationKind = annotation.kind || 'highlight'
    span.style.backgroundColor = annotation.color || DEFAULT_COLORS[annotation.kind] || DEFAULT_COLORS.highlight
    span.style.borderRadius = '0.22em'
    span.style.padding = '0 0.04em'
    span.style.boxShadow = annotation.kind === 'note' ? 'inset 0 -1px 0 rgba(6, 24, 24, 0.18)' : 'none'
    span.textContent = middle
    fragment.appendChild(span)

    if (after) fragment.appendChild(document.createTextNode(after))
    textNode.parentNode?.replaceChild(fragment, textNode)
    return span
}

function prepareAnnotations(annotations) {
    const ordered = []
    let lastEnd = -1
    for (const annotation of [...annotations]
        .filter((item) => Number.isFinite(item?.start_offset) && Number.isFinite(item?.end_offset) && item.end_offset > item.start_offset)
        .sort((a, b) => (a.start_offset - b.start_offset) || (a.end_offset - b.end_offset))) {
        if (annotation.start_offset < lastEnd) continue
        ordered.push(annotation)
        lastEnd = annotation.end_offset
    }
    return ordered.reverse()
}

export function clearAnnotationHighlights(root) {
    for (const node of getAnnotationNodes(root)) {
        clearNode(node)
    }
}

export function highlightAnnotationsInElement(root, annotations) {
    clearAnnotationHighlights(root)
    if (!root || !Array.isArray(annotations) || annotations.length === 0) return []

    for (const annotation of prepareAnnotations(annotations)) {
        const textNodes = getTextNodes(root)
        const relevantNodes = textNodes.filter(({ end, start }) => end > annotation.start_offset && start < annotation.end_offset)
        for (const { node, start, end } of [...relevantNodes].reverse()) {
            const sliceStart = Math.max(0, annotation.start_offset - start)
            const sliceEnd = Math.min(end - start, annotation.end_offset - start)
            if (sliceEnd <= sliceStart) continue
            wrapTextSlice(node, sliceStart, sliceEnd, annotation)
        }
    }

    return getAnnotationNodes(root)
}

export function activateAnnotationHighlight(root, annotationId) {
    const nodes = getAnnotationNodes(root)
    for (const node of nodes) {
        node.style.outline = 'none'
        node.style.boxShadow = node.dataset.bookreaderAnnotationKind === 'note'
            ? 'inset 0 -1px 0 rgba(6, 24, 24, 0.18)'
            : 'none'
    }
    if (!annotationId) return null

    const matching = nodes.filter((node) => node.dataset.bookreaderAnnotationId === annotationId)
    if (matching.length === 0) return null
    for (const node of matching) {
        node.style.outline = '1px solid rgba(224, 49, 49, 0.38)'
        node.style.boxShadow = '0 0 0 2px rgba(255, 146, 43, 0.18)'
    }
    return matching[0]
}

export function scrollAnnotationIntoView(node) {
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}
