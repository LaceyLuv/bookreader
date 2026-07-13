import { READER_LOCATOR_VERSION } from './readerLocator'

const QUOTE_EXACT_CODEPOINTS = 48
const QUOTE_CONTEXT_CODEPOINTS = 24

function getEntries(page) {
    if (Array.isArray(page?.slices) && page.slices.length > 0) return page.slices
    if (Array.isArray(page?.segments)) return page.segments
    return []
}

function getText(entry) {
    if (typeof entry?.displayText === 'string') return entry.displayText
    if (typeof entry?.display_text === 'string') return entry.display_text
    if (typeof entry?.text === 'string') return entry.text
    return ''
}

function getSegmentId(entry) {
    if (Number.isFinite(entry?.segmentId)) return entry.segmentId
    return Number.isFinite(entry?.segment_id) ? entry.segment_id : null
}

function getStartOffset(entry) {
    if (Number.isFinite(entry?.sourceStartOffset)) return entry.sourceStartOffset
    if (Number.isFinite(entry?.source_start_offset)) return entry.source_start_offset
    if (Number.isFinite(entry?.startOffset)) return entry.startOffset
    return Number.isFinite(entry?.start_offset) ? entry.start_offset : null
}

function getEndOffset(entry) {
    if (Number.isFinite(entry?.sourceEndOffset)) return entry.sourceEndOffset
    if (Number.isFinite(entry?.source_end_offset)) return entry.source_end_offset
    if (Number.isFinite(entry?.endOffset)) return entry.endOffset
    return Number.isFinite(entry?.end_offset) ? entry.end_offset : null
}

function getMappingRuns(entry) {
    if (Array.isArray(entry?.displayToSourceRuns)) return entry.displayToSourceRuns
    if (Array.isArray(entry?.display_to_source_runs)) return entry.display_to_source_runs
    return []
}

function displayIndexForSourceOffset(entry, sourceOffset) {
    for (const run of getMappingRuns(entry)) {
        if (!Array.isArray(run) || run.length !== 3) continue
        const [displayStart, sourceStart, length] = run
        if (sourceOffset >= sourceStart && sourceOffset < sourceStart + length) {
            return displayStart + sourceOffset - sourceStart
        }
    }
    const start = getStartOffset(entry)
    return Number.isFinite(start) ? Math.max(0, sourceOffset - start) : 0
}

function sourceOffsetForDisplayIndex(entry, displayIndex) {
    for (const run of getMappingRuns(entry)) {
        if (!Array.isArray(run) || run.length !== 3) continue
        const [displayStart, sourceStart, length] = run
        if (displayIndex >= displayStart && displayIndex < displayStart + length) {
            return sourceStart + displayIndex - displayStart
        }
    }
    const start = getStartOffset(entry)
    return Number.isFinite(start) ? start + displayIndex : null
}

function findEntry(renderPages, segmentId, sourceOffset) {
    for (const page of Array.isArray(renderPages) ? renderPages : []) {
        for (const entry of getEntries(page)) {
            const start = getStartOffset(entry)
            const end = getEndOffset(entry)
            if (Number.isFinite(segmentId) && getSegmentId(entry) !== segmentId) continue
            if (Number.isFinite(sourceOffset) && Number.isFinite(start) && Number.isFinite(end)
                && sourceOffset >= start && sourceOffset <= end) {
                return { page, entry }
            }
        }
    }
    return null
}

export function buildTxtQuoteSelector(renderPages, segmentId, sourceOffset) {
    if (!Number.isFinite(sourceOffset)) return null
    const match = findEntry(renderPages, segmentId, sourceOffset)
    if (!match) return null
    const points = Array.from(getText(match.entry))
    if (points.length === 0) return null
    const anchorIndex = Math.max(0, Math.min(points.length - 1, displayIndexForSourceOffset(match.entry, sourceOffset)))
    const exactStart = Math.max(0, Math.min(anchorIndex - 8, points.length - QUOTE_EXACT_CODEPOINTS))
    const exactEnd = Math.min(points.length, exactStart + QUOTE_EXACT_CODEPOINTS)
    const exact = points.slice(exactStart, exactEnd).join('')
    if (!exact) return null
    return {
        exact,
        prefix: points.slice(Math.max(0, exactStart - QUOTE_CONTEXT_CODEPOINTS), exactStart).join(''),
        suffix: points.slice(exactEnd, exactEnd + QUOTE_CONTEXT_CODEPOINTS).join(''),
        position: anchorIndex - exactStart,
    }
}

export function createTxtLocatorV2({ renderPages, segmentId, sourceOffset, page, sourceRevision }) {
    return {
        version: READER_LOCATOR_VERSION,
        kind: 'txt',
        segmentId: Number.isFinite(segmentId) ? segmentId : null,
        sourceOffset: Number.isFinite(sourceOffset) ? sourceOffset : null,
        page: Number.isFinite(page) ? page : 0,
        sourceRevision: sourceRevision || null,
        quote: buildTxtQuoteSelector(renderPages, segmentId, sourceOffset),
    }
}

function findExactMatches(points, needle) {
    const matches = []
    if (needle.length === 0 || needle.length > points.length) return matches
    outer: for (let start = 0; start <= points.length - needle.length; start += 1) {
        for (let offset = 0; offset < needle.length; offset += 1) {
            if (points[start + offset] !== needle[offset]) continue outer
        }
        matches.push(start)
    }
    return matches
}

function suffixMatches(points, end, suffix) {
    if (suffix.length === 0) return true
    return points.slice(end, end + suffix.length).join('') === suffix.join('')
}

function prefixMatches(points, start, prefix) {
    if (prefix.length === 0) return true
    return points.slice(Math.max(0, start - prefix.length), start).join('') === prefix.join('')
}

export function reanchorTxtLocator(renderPages, locator, currentSourceRevision) {
    const quote = locator?.quote
    if (locator?.version !== READER_LOCATOR_VERSION || !quote?.exact) return null
    if (locator.sourceRevision && currentSourceRevision && locator.sourceRevision === currentSourceRevision) return null

    const exact = Array.from(quote.exact)
    const prefix = Array.from(quote.prefix || '')
    const suffix = Array.from(quote.suffix || '')
    const position = Number.isFinite(quote.position) ? quote.position : 0
    const candidates = []

    for (const page of Array.isArray(renderPages) ? renderPages : []) {
        for (const entry of getEntries(page)) {
            const points = Array.from(getText(entry))
            for (const start of findExactMatches(points, exact)) {
                const anchorIndex = Math.max(start, Math.min(start + exact.length - 1, start + position))
                const sourceOffset = sourceOffsetForDisplayIndex(entry, anchorIndex)
                if (!Number.isFinite(sourceOffset)) continue
                const contextScore = Number(prefixMatches(points, start, prefix)) + Number(suffixMatches(points, start + exact.length, suffix))
                const distance = Number.isFinite(locator.sourceOffset) ? Math.abs(sourceOffset - locator.sourceOffset) : 0
                candidates.push({
                    page: page.page,
                    segmentId: getSegmentId(entry),
                    sourceOffset,
                    contextScore,
                    distance,
                })
            }
        }
    }

    candidates.sort((left, right) => right.contextScore - left.contextScore || left.distance - right.distance)
    return candidates[0] ?? null
}
