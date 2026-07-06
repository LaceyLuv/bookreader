import { describe, expect, test } from 'vitest'

import { getZipImageLayout } from './zipReaderLayout'

describe('zipReaderLayout', () => {
    test('clamps invalid scale to default image bounds', () => {
        expect(getZipImageLayout('not-a-number')).toEqual({
            scale: 1,
            singleMaxWidth: '90%',
            dualMaxWidth: '48%',
            imageMaxHeight: '100%',
        })
    })

    test('clamps very small and very large scale values', () => {
        expect(getZipImageLayout(0.1).scale).toBe(0.5)
        expect(getZipImageLayout(10).scale).toBe(2.5)
    })

    test('returns CSS percentage strings for scaled layouts', () => {
        expect(getZipImageLayout(1.5)).toEqual({
            scale: 1.5,
            singleMaxWidth: '135%',
            dualMaxWidth: '72%',
            imageMaxHeight: '150%',
        })
    })
})
