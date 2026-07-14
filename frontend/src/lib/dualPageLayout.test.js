import { describe, expect, test } from 'vitest'
import { getDualPageOuterInset, MAX_SPLIT_MARGIN_PX } from './dualPageLayout'

describe('dual page layout', () => {
    test('balances split-margin movement across the two page origins', () => {
        const defaultInset = getDualPageOuterInset(64)
        const widerGapInset = getDualPageOuterInset(100)
        const rightPageMovement = (100 - 64) / 2

        expect(MAX_SPLIT_MARGIN_PX).toBe(120)
        expect(defaultInset - widerGapInset).toBe(rightPageMovement)
        expect(getDualPageOuterInset(MAX_SPLIT_MARGIN_PX)).toBe(0)
    })
})
