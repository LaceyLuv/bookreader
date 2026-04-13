export function createTxtTransformOptions({
    trimSpaces = false,
    removeEmptyLines = false,
    splitParagraphs = false,
} = {}) {
    return {
        trimSpaces: Boolean(trimSpaces),
        removeEmptyLines: Boolean(removeEmptyLines),
        splitParagraphs: Boolean(splitParagraphs),
    }
}

export function toTxtTransformQuery(options = {}) {
    const normalized = createTxtTransformOptions(options)
    const params = new URLSearchParams()
    params.set('trim_spaces', String(normalized.trimSpaces))
    params.set('remove_empty_lines', String(normalized.removeEmptyLines))
    params.set('split_paragraphs', String(normalized.splitParagraphs))
    return params.toString()
}

export function hasActiveTxtTransformOptions(options) {
    return Boolean(options?.trimSpaces || options?.removeEmptyLines || options?.splitParagraphs)
}

export function normalizeTxtCompatibilitySegments(data, transformOptions = {}) {
    const displayFragments = Array.isArray(data?.display_fragments) ? data.display_fragments : []
    if (!hasActiveTxtTransformOptions(transformOptions) || displayFragments.length === 0) {
        return Array.isArray(data?.segments) ? data.segments : []
    }

    const mergedBySegmentId = new Map()
    const orderedSegmentIds = []

    displayFragments.forEach((fragment) => {
        const segmentId = fragment.segment_id
        const displayText = fragment.display_text ?? ''
        if (!mergedBySegmentId.has(segmentId)) {
            mergedBySegmentId.set(segmentId, {
                ...fragment,
                segment_id: segmentId,
                start_offset: fragment.source_start_offset,
                end_offset: fragment.source_end_offset,
                text: displayText,
                displayText,
            })
            orderedSegmentIds.push(segmentId)
            return
        }

        const current = mergedBySegmentId.get(segmentId)
        const nextText = displayText ? `${current.displayText}\n\n${displayText}` : current.displayText
        mergedBySegmentId.set(segmentId, {
            ...current,
            source_start_offset: Math.min(current.source_start_offset ?? fragment.source_start_offset, fragment.source_start_offset ?? current.source_start_offset),
            source_end_offset: Math.max(current.source_end_offset ?? fragment.source_end_offset, fragment.source_end_offset ?? current.source_end_offset),
            start_offset: Math.min(current.start_offset ?? fragment.source_start_offset, fragment.source_start_offset ?? current.start_offset),
            end_offset: Math.max(current.end_offset ?? fragment.source_end_offset, fragment.source_end_offset ?? current.end_offset),
            text: nextText,
            displayText: nextText,
        })
    })

    return orderedSegmentIds.map((segmentId) => mergedBySegmentId.get(segmentId))
}
