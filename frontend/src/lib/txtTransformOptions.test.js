import { expect, test } from 'vitest'
import { normalizeTxtCompatibilitySegments } from './txtTransformOptions'

test('normalizes display fragments when the compact TXT API omits legacy segments', () => {
    const result = normalizeTxtCompatibilitySegments({
        display_fragments: [
            {
                segment_id: 7,
                display_text: 'visible text',
                source_start_offset: 100,
                source_end_offset: 112,
                display_to_source_runs: [[0, 100, 12]],
            },
        ],
    })

    expect(result).toEqual([
        expect.objectContaining({
            segment_id: 7,
            text: 'visible text',
            displayText: 'visible text',
            start_offset: 100,
            end_offset: 112,
            display_to_source_runs: [[0, 100, 12]],
        }),
    ])
})

test('keeps legacy segments when both response shapes are present without transforms', () => {
    const segments = [{ segment_id: 1, text: 'legacy', start_offset: 0, end_offset: 6 }]
    expect(normalizeTxtCompatibilitySegments({
        segments,
        display_fragments: [{ segment_id: 1, display_text: 'display' }],
    })).toBe(segments)
})

test('keeps v2 continuation chunks separate without inserting synthetic whitespace', () => {
    const result = normalizeTxtCompatibilitySegments({
        contract_version: 2,
        display_fragments: [
            { fragment_index: 0, segment_id: 4, display_text: 'alpha', source_start_offset: 10, source_end_offset: 15 },
            { fragment_index: 0, segment_id: 4, display_text: 'beta', source_start_offset: 15, source_end_offset: 19 },
        ],
    })

    expect(result).toHaveLength(2)
    expect(result.map((segment) => segment.text).join('')).toBe('alphabeta')
    expect(result.map((segment) => [segment.start_offset, segment.end_offset])).toEqual([[10, 15], [15, 19]])
})
