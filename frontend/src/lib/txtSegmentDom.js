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

function getSegmentElements(root, segmentId) {
    if (!root) return []
    return Array.from(root.querySelectorAll(`[data-segment-id="${segmentId}"]`))
}

function getElementRange(element) {
    const start = Number(element.dataset.segmentStart)
    const end = Number(element.dataset.segmentEnd)
    return {
        start: Number.isFinite(start) ? start : null,
        end: Number.isFinite(end) ? end : null,
    }
}

export function resolveSegmentTarget(root, {
    segmentId,
    sourceStart,
    sourceEnd,
    segmentLocalStart,
    segmentLocalEnd,
} = {}) {
    if (!Number.isFinite(segmentId)) return null

    const segmentElements = getSegmentElements(root, segmentId)
    if (segmentElements.length === 0) return null

    const ranges = segmentElements
        .map((element) => ({ element, ...getElementRange(element) }))
        .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end))

    const baseSegmentStart = ranges.reduce((lowestStart, { start }) => (
        lowestStart == null || start < lowestStart ? start : lowestStart
    ), null)

    const absoluteStart = Number.isFinite(sourceStart)
        ? sourceStart
        : (Number.isFinite(segmentLocalStart) && Number.isFinite(baseSegmentStart)
            ? baseSegmentStart + segmentLocalStart
            : null)
    const absoluteEnd = Number.isFinite(sourceEnd)
        ? sourceEnd
        : (Number.isFinite(segmentLocalEnd) && Number.isFinite(baseSegmentStart)
            ? baseSegmentStart + segmentLocalEnd
            : null)

    const resolvedEntry = ranges.find(({ start, end }) => {
        if (!Number.isFinite(absoluteStart)) return false
        const effectiveEnd = Number.isFinite(absoluteEnd) ? absoluteEnd : absoluteStart + 1
        return absoluteStart < end && effectiveEnd > start
    }) ?? ranges[0] ?? { element: segmentElements[0], start: null, end: null }

    const textLength = resolvedEntry.element.textContent?.length ?? 0
    const localStart = Number.isFinite(absoluteStart) && Number.isFinite(resolvedEntry.start)
        ? Math.max(0, Math.min(textLength, absoluteStart - resolvedEntry.start))
        : (Number.isFinite(segmentLocalStart) ? Math.max(0, Math.min(textLength, segmentLocalStart)) : 0)
    const localEnd = Number.isFinite(absoluteEnd) && Number.isFinite(resolvedEntry.start)
        ? Math.max(localStart, Math.min(textLength, absoluteEnd - resolvedEntry.start))
        : (Number.isFinite(segmentLocalEnd) ? Math.max(localStart, Math.min(textLength, segmentLocalEnd)) : localStart)

    return {
        element: resolvedEntry.element,
        localStart,
        localEnd,
        sourceStart: absoluteStart,
        sourceEnd: absoluteEnd,
    }
}

export function findSegmentElement(root, segmentId) {
    return getSegmentElements(root, segmentId)[0] ?? null
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
