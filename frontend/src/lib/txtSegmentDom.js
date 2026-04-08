export function clearSegmentMarks(root) {
    if (!root) return
    const marks = Array.from(root.querySelectorAll('mark[data-bookreader-search="true"]'))
    for (const mark of marks) {
        const parent = mark.parentNode
        if (!parent) continue
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
        parent.normalize()
    }
}

export function findSegmentElement(root, segmentId) {
    if (!root) return null
    return root.querySelector(`[data-segment-id="${segmentId}"]`)
}

export function highlightSegmentMatch(segmentEl, start, end) {
    if (!segmentEl) return null
    const text = segmentEl.textContent || ''
    const before = text.slice(0, start)
    const match = text.slice(start, end)
    const after = text.slice(end)

    segmentEl.replaceChildren()
    if (before) segmentEl.appendChild(document.createTextNode(before))

    const mark = document.createElement('mark')
    mark.dataset.bookreaderSearch = 'true'
    mark.dataset.activeSearchMark = 'true'
    mark.style.backgroundColor = 'rgba(255, 212, 59, 0.75)'
    mark.style.outline = '1px solid rgba(240, 140, 0, 0.55)'
    mark.textContent = match
    segmentEl.appendChild(mark)

    if (after) segmentEl.appendChild(document.createTextNode(after))
    return mark
}
