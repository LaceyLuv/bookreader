import { expect, test } from 'vitest'
import {
    findDisplayRangeForSourceLocator,
    findNearestDisplayFragmentForSourceOffset,
    recoverSourceRangeFromDisplaySelection,
} from './txtDisplayMapper'

test('findDisplayRangeForSourceLocator maps a source offset into transformed display positions', () => {
    const fragments = [
        {
            segment_id: 0,
            display_text: 'Alpha beta',
            source_start_offset: 0,
            source_end_offset: 12,
            display_to_source: [0, 1, 2, 3, 4, 5, 8, 9, 10, 11],
        },
    ]

    expect(findDisplayRangeForSourceLocator(fragments, 0, 8, 11)).toEqual({
        fragmentIndex: 0,
        displayStart: 6,
        displayEnd: 9,
    })
})

test('findDisplayRangeForSourceLocator preserves cross-fragment display ranges for one source segment', () => {
    const fragments = [
        {
            segment_id: 4,
            display_text: 'alpha beta',
            source_start_offset: 100,
            source_end_offset: 110,
            display_to_source: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109],
        },
        {
            segment_id: 4,
            display_text: 'gamma delta',
            source_start_offset: 111,
            source_end_offset: 122,
            display_to_source: [111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121],
        },
    ]

    expect(findDisplayRangeForSourceLocator(fragments, 4, 108, 116)).toEqual({
        startFragmentIndex: 0,
        endFragmentIndex: 1,
        displayStart: 8,
        displayEnd: 5,
    })
})

test('findNearestDisplayFragmentForSourceOffset falls back to the closest fragment when an exact mapping is missing', () => {
    const fragments = [
        { segment_id: 2, source_start_offset: 100, source_end_offset: 140, display_text: 'first' },
        { segment_id: 2, source_start_offset: 141, source_end_offset: 180, display_text: 'second' },
    ]

    expect(findNearestDisplayFragmentForSourceOffset(fragments, 2, 150)).toBe(1)
})

test('recoverSourceRangeFromDisplaySelection restores source offsets from a transformed display selection', () => {
    const fragments = [
        {
            segment_id: 0,
            display_text: 'alpha beta',
            source_start_offset: 0,
            source_end_offset: 13,
            display_to_source: [0, 1, 2, 3, 4, 5, 8, 9, 10, 11],
        },
    ]

    expect(recoverSourceRangeFromDisplaySelection(fragments, 0, 0, 6, 10)).toEqual({
        fragmentIndex: 0,
        sourceStart: 8,
        sourceEnd: 12,
    })
})

test('recoverSourceRangeFromDisplaySelection restores cross-fragment source offsets from normalized boundaries', () => {
    const fragments = [
        {
            segment_id: 0,
            display_text: 'alpha beta',
            source_start_offset: 0,
            source_end_offset: 13,
            display_to_source: [0, 1, 2, 3, 4, 5, 8, 9, 10, 11],
        },
        {
            segment_id: 0,
            display_text: 'gamma delta',
            source_start_offset: 11,
            source_end_offset: 22,
            display_to_source: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        },
    ]

    expect(recoverSourceRangeFromDisplaySelection(fragments, 0, 0, 6, 1, 5)).toEqual({
        startFragmentIndex: 0,
        endFragmentIndex: 1,
        sourceStart: 8,
        sourceEnd: 16,
    })
})
