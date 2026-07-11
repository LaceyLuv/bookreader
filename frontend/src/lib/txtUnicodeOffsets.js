export const TXT_OFFSET_UNIT = 'unicode-codepoint-v1'
export const LEGACY_TXT_OFFSET_UNIT = 'legacy-unknown-v0'

export function codePointLength(value) {
    return Array.from(String(value ?? '')).length
}

export function utf16IndexToCodePoint(value, utf16Index) {
    const text = String(value ?? '')
    const safeIndex = Math.max(0, Math.min(text.length, Number(utf16Index) || 0))
    return Array.from(text.slice(0, safeIndex)).length
}

export function codePointIndexToUtf16(value, codePointIndex) {
    const points = Array.from(String(value ?? ''))
    const safeIndex = Math.max(0, Math.min(points.length, Number(codePointIndex) || 0))
    return points.slice(0, safeIndex).join('').length
}

function normalized(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function reanchorLegacyTxtAnnotation(annotation, segments) {
    if (!annotation || annotation.offset_unit === TXT_OFFSET_UNIT) return annotation
    const segment = Array.isArray(segments)
        ? segments.find((item) => (item?.segment_id ?? item?.segmentId) === annotation.segment_id)
        : null
    const text = segment?.text
    const segmentStart = segment?.start_offset ?? segment?.startOffset
    const rawNeedle = String(annotation?.selected_text ?? '')
    const needle = normalized(rawNeedle)
    if (typeof text !== 'string' || !Number.isFinite(segmentStart) || !needle) return annotation

    const points = Array.from(text)
    const expected = Number.isFinite(annotation.start_offset)
        ? Math.max(0, annotation.start_offset - segmentStart)
        : (Number.isFinite(annotation.segment_local_start) ? annotation.segment_local_start : 0)
    const candidates = []
    for (let start = 0; start < points.length; start += 1) {
        for (let end = start + 1; end <= points.length; end += 1) {
            const rawValue = points.slice(start, end).join('')
            const value = normalized(rawValue)
            if (value === needle) candidates.push({ start, end, exact: rawValue === rawNeedle })
            if (value.length > needle.length + 4) break
        }
    }
    if (candidates.length === 0) return annotation
    const exactCandidates = candidates.filter((item) => item.exact)
    const pool = exactCandidates.length > 0 ? exactCandidates : candidates
    const match = pool.reduce((best, item) => (
        Math.abs(item.start - expected) < Math.abs(best.start - expected) ? item : best
    ))
    return { ...annotation, offset_unit: TXT_OFFSET_UNIT,
        start_offset: segmentStart + match.start, end_offset: segmentStart + match.end,
        segment_local_start: match.start, segment_local_end: match.end }
}
