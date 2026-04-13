function getSegmentId(fragment) {
    return fragment?.segment_id ?? fragment?.segmentId ?? null
}

function getSourceStart(fragment) {
    return fragment?.source_start_offset ?? fragment?.start_offset ?? fragment?.startOffset ?? null
}

function getSourceEnd(fragment) {
    return fragment?.source_end_offset ?? fragment?.end_offset ?? fragment?.endOffset ?? null
}

function getDisplayTextLength(fragment) {
    if (typeof fragment?.display_text === 'string') return fragment.display_text.length
    if (typeof fragment?.displayText === 'string') return fragment.displayText.length
    if (typeof fragment?.text === 'string') return fragment.text.length
    return 0
}

function findDisplayIndexForSourceOffset(fragment, sourceOffset) {
    const mapping = Array.isArray(fragment?.display_to_source) ? fragment.display_to_source : null
    if (mapping?.length) return mapping.indexOf(sourceOffset)

    const start = getSourceStart(fragment)
    const end = getSourceEnd(fragment)
    if (!Number.isFinite(start) || !Number.isFinite(end) || sourceOffset < start || sourceOffset >= end) {
        return -1
    }

    return Math.max(0, Math.min(getDisplayTextLength(fragment) - 1, sourceOffset - start))
}

function getSourceOffsetForDisplayIndex(fragment, displayIndex) {
    if (!Number.isFinite(displayIndex) || displayIndex < 0) return null

    const mapping = Array.isArray(fragment?.display_to_source) ? fragment.display_to_source : null
    if (mapping?.length) {
        return mapping[displayIndex] ?? null
    }

    const start = getSourceStart(fragment)
    if (!Number.isFinite(start)) return null
    return start + displayIndex
}

export function findDisplayRangeForSourceLocator(fragments, segmentId, sourceStart, sourceEnd) {
    if (!Array.isArray(fragments) || !Number.isFinite(segmentId)) return null

    let startMatch = null
    let endMatch = null

    for (let index = 0; index < fragments.length; index += 1) {
        const fragment = fragments[index]
        if (getSegmentId(fragment) !== segmentId) continue

        if (!startMatch) {
            const displayStart = findDisplayIndexForSourceOffset(fragment, sourceStart)
            if (displayStart >= 0) {
                startMatch = {
                    fragmentIndex: index,
                    displayStart,
                }
            }
        }

        if (Number.isFinite(sourceEnd) && !endMatch) {
            const displayEnd = findDisplayIndexForSourceOffset(fragment, sourceEnd)
            if (displayEnd >= 0) {
                endMatch = {
                    fragmentIndex: index,
                    displayEnd,
                }
            }
        }

        if (startMatch && (!Number.isFinite(sourceEnd) || endMatch)) break
    }

    if (!startMatch) return null
    if (!Number.isFinite(sourceEnd) || !endMatch || endMatch.fragmentIndex === startMatch.fragmentIndex) {
        return {
            fragmentIndex: startMatch.fragmentIndex,
            displayStart: startMatch.displayStart,
            displayEnd: endMatch?.displayEnd ?? startMatch.displayStart,
        }
    }

    return {
        startFragmentIndex: startMatch.fragmentIndex,
        endFragmentIndex: endMatch.fragmentIndex,
        displayStart: startMatch.displayStart,
        displayEnd: endMatch.displayEnd,
    }
}

export function findNearestDisplayFragmentForSourceOffset(fragments, segmentId, sourceOffset) {
    if (!Array.isArray(fragments) || !Number.isFinite(segmentId) || !Number.isFinite(sourceOffset)) return null

    let bestIndex = null
    let bestDistance = Number.POSITIVE_INFINITY

    fragments.forEach((fragment, index) => {
        if (getSegmentId(fragment) !== segmentId) return

        const start = getSourceStart(fragment)
        const end = getSourceEnd(fragment)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return

        const distance = sourceOffset < start
            ? start - sourceOffset
            : (sourceOffset >= end ? sourceOffset - end : 0)

        if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = index
        }
    })

    return bestIndex
}

export function recoverSourceRangeFromDisplaySelection(fragments, segmentId, fragmentIndex, displayStart, displayEnd) {
    if (!Array.isArray(fragments) || !Number.isFinite(segmentId) || !Number.isFinite(fragmentIndex)) return null
    if (!Number.isFinite(displayStart) || !Number.isFinite(displayEnd)) return null

    const startFragmentIndex = fragmentIndex
    const endFragmentIndex = arguments.length >= 6 && Number.isFinite(arguments[4]) && Number.isFinite(arguments[5])
        ? arguments[4]
        : fragmentIndex
    const endDisplayOffset = arguments.length >= 6 && Number.isFinite(arguments[4]) && Number.isFinite(arguments[5])
        ? arguments[5]
        : displayEnd

    const startFragment = fragments[startFragmentIndex]
    const endFragment = fragments[endFragmentIndex]
    if (!startFragment || !endFragment) return null
    if (getSegmentId(startFragment) !== segmentId || getSegmentId(endFragment) !== segmentId) return null

    if (endFragmentIndex < startFragmentIndex) return null
    if (endFragmentIndex === startFragmentIndex && endDisplayOffset <= displayStart) return null

    const sourceStart = getSourceOffsetForDisplayIndex(startFragment, displayStart)
    const sourceEndChar = getSourceOffsetForDisplayIndex(endFragment, endDisplayOffset - 1)
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEndChar)) return null

    const result = {
        sourceStart,
        sourceEnd: sourceEndChar + 1,
    }

    if (startFragmentIndex === endFragmentIndex) {
        result.fragmentIndex = startFragmentIndex
        return result
    }

    result.startFragmentIndex = startFragmentIndex
    result.endFragmentIndex = endFragmentIndex
    return result
}
