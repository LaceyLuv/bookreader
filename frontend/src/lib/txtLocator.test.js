import { expect, test } from 'vitest'
import { buildTxtQuoteSelector, createTxtLocatorV2, reanchorTxtLocator } from './txtLocator'

function page(pageNumber, segmentId, startOffset, text) {
    return {
        page: pageNumber,
        segments: [{ segmentId, startOffset, endOffset: startOffset + Array.from(text).length, displayText: text }],
    }
}

test('creates a v2 TXT locator with quote context around a code-point offset', () => {
    const pages = [page(0, 3, 100, '앞 문맥에서 읽던 문장과 뒤 문맥을 함께 저장한다.')]
    const locator = createTxtLocatorV2({
        renderPages: pages,
        segmentId: 3,
        sourceOffset: 108,
        page: 0,
        sourceRevision: 'rev-a',
    })

    expect(locator.version).toBe(2)
    expect(locator.kind).toBe('txt')
    expect(locator.quote?.exact).toContain('읽던 문장')
    expect(locator.quote?.position).toBeGreaterThanOrEqual(0)
})

test('reanchors a v2 TXT locator after text inserted before the saved quote', () => {
    const originalPages = [page(0, 0, 0, '서문 다음에 고유한 읽던 문장이 이어진다.')]
    const quote = buildTxtQuoteSelector(originalPages, 0, 8)
    const changedPages = [
        page(0, 0, 0, '새로 추가된 아주 긴 머리말이다.'),
        page(1, 1, 16, '서문 다음에 고유한 읽던 문장이 이어진다.'),
    ]

    const result = reanchorTxtLocator(changedPages, {
        version: 2,
        kind: 'txt',
        segmentId: 0,
        sourceOffset: 8,
        sourceRevision: 'old',
        quote,
    }, 'new')

    expect(result).toMatchObject({ page: 1, segmentId: 1 })
    expect(result.sourceOffset).toBeGreaterThan(16)
})

test('does not reanchor when the source revision is unchanged', () => {
    expect(reanchorTxtLocator([], {
        version: 2,
        sourceRevision: 'same',
        quote: { exact: 'text', prefix: '', suffix: '', position: 0 },
    }, 'same')).toBeNull()
})
