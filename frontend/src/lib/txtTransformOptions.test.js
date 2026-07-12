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
