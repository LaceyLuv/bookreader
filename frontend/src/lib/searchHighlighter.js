function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSearchMarks(root) {
    if (!root) return []
    return Array.from(root.querySelectorAll('mark[data-bookreader-search="true"]'))
}

function createSearchMark(text, { active = false } = {}) {
    const mark = document.createElement('mark')
    mark.dataset.bookreaderSearch = 'true'
    mark.style.color = 'inherit'
    mark.style.padding = '0 0.04em'
    mark.style.borderRadius = '0.2em'
    if (active) {
        mark.style.backgroundColor = 'rgba(255, 212, 59, 0.75)'
        mark.style.outline = '1px solid rgba(240, 140, 0, 0.55)'
    } else {
        mark.style.backgroundColor = 'rgba(92, 124, 250, 0.28)'
        mark.style.outline = 'none'
    }
    mark.textContent = text
    return mark
}

function createSearchWalker(root, trimmedQuery) {
    const lowerQuery = trimmedQuery.toLowerCase()
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const value = node.nodeValue || ''
            if (!value.trim()) return NodeFilter.FILTER_REJECT
            const parent = node.parentElement
            if (!parent) return NodeFilter.FILTER_REJECT
            if (parent.closest('mark[data-bookreader-search="true"]')) return NodeFilter.FILTER_REJECT
            if (["SCRIPT", "STYLE"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT
            return value.toLowerCase().includes(lowerQuery) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        },
    })
}

export function clearSearchHighlights(root) {
    for (const mark of getSearchMarks(root)) {
        const parent = mark.parentNode
        if (!parent) continue
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
        parent.normalize()
    }
}

export function highlightSearchInElement(root, query) {
    clearSearchHighlights(root)
    const trimmedQuery = (query || '').trim()
    if (!root || !trimmedQuery) return []

    const pattern = new RegExp(escapeRegExp(trimmedQuery), 'gi')
    const textNodes = []
    const walker = createSearchWalker(root, trimmedQuery)

    while (walker.nextNode()) {
        textNodes.push(walker.currentNode)
    }

    for (const node of textNodes) {
        const value = node.nodeValue || ''
        pattern.lastIndex = 0
        if (!pattern.test(value)) continue
        pattern.lastIndex = 0

        const fragment = document.createDocumentFragment()
        let lastIndex = 0
        let matchIndex = 0
        for (const match of value.matchAll(pattern)) {
            const start = match.index || 0
            const end = start + match[0].length
            if (start > lastIndex) {
                fragment.appendChild(document.createTextNode(value.slice(lastIndex, start)))
            }
            const mark = createSearchMark(value.slice(start, end))
            mark.dataset.bookreaderSearchLocal = String(matchIndex)
            fragment.appendChild(mark)
            lastIndex = end
            matchIndex += 1
        }
        if (lastIndex < value.length) {
            fragment.appendChild(document.createTextNode(value.slice(lastIndex)))
        }
        node.parentNode?.replaceChild(fragment, node)
    }

    return getSearchMarks(root)
}

export function highlightSearchMatchInElement(root, query, targetMatchIndex = 0) {
    clearSearchHighlights(root)
    const trimmedQuery = (query || '').trim()
    if (!root || !trimmedQuery || !Number.isFinite(targetMatchIndex) || targetMatchIndex < 0) return null

    const lowerQuery = trimmedQuery.toLowerCase()
    const queryLength = lowerQuery.length
    const walker = createSearchWalker(root, trimmedQuery)
    let currentIndex = 0

    while (walker.nextNode()) {
        const node = walker.currentNode
        const value = node.nodeValue || ''
        const lowerValue = value.toLowerCase()
        let searchFrom = 0

        while (searchFrom < lowerValue.length) {
            const start = lowerValue.indexOf(lowerQuery, searchFrom)
            if (start < 0) break
            const end = start + queryLength
            if (currentIndex === targetMatchIndex) {
                const fragment = document.createDocumentFragment()
                if (start > 0) fragment.appendChild(document.createTextNode(value.slice(0, start)))
                fragment.appendChild(createSearchMark(value.slice(start, end), { active: true }))
                if (end < value.length) fragment.appendChild(document.createTextNode(value.slice(end)))
                node.parentNode?.replaceChild(fragment, node)
                return getSearchMarks(root)[0] || null
            }
            currentIndex += 1
            searchFrom = end
        }
    }

    return null
}

export function activateSearchMark(root, index) {
    const marks = getSearchMarks(root)
    for (const mark of marks) {
        mark.style.backgroundColor = 'rgba(92, 124, 250, 0.28)'
        mark.style.outline = 'none'
    }
    if (!marks.length) return null
    const targetIndex = Math.max(0, Math.min(index, marks.length - 1))
    const target = marks[targetIndex]
    target.style.backgroundColor = 'rgba(255, 212, 59, 0.75)'
    target.style.outline = '1px solid rgba(240, 140, 0, 0.55)'
    return target
}

export function scrollSearchMarkIntoView(mark) {
    if (!mark) return
    mark.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}
