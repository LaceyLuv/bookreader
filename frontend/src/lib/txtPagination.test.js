import {
  buildViewportPageMap,
  clampViewportPage,
  findViewportPageForSegment,
} from './txtPagination'

test('buildViewportPageMap expands per-page ownership from measured segment page counts', () => {
  const map = buildViewportPageMap([
    { segmentId: 10, pageCount: 2 },
    { segmentId: 11, pageCount: 1 },
    { segmentId: 12, pageCount: 3 },
  ])

  expect(map.totalPages).toBe(6)
  expect(map.pages[0]).toEqual({ page: 0, segmentId: 10, segmentPage: 0 })
  expect(map.pages[1]).toEqual({ page: 1, segmentId: 10, segmentPage: 1 })
  expect(map.pages[2]).toEqual({ page: 2, segmentId: 11, segmentPage: 0 })
  expect(map.pages[5]).toEqual({ page: 5, segmentId: 12, segmentPage: 2 })
})

test('findViewportPageForSegment returns the first viewport page that owns the segment', () => {
  const map = buildViewportPageMap([
    { segmentId: 7, pageCount: 1 },
    { segmentId: 8, pageCount: 2 },
  ])

  expect(findViewportPageForSegment(map, 7)).toBe(0)
  expect(findViewportPageForSegment(map, 8)).toBe(1)
})

test('clampViewportPage keeps viewport navigation inside the measured page range', () => {
  expect(clampViewportPage(-4, 9)).toBe(0)
  expect(clampViewportPage(3, 9)).toBe(3)
  expect(clampViewportPage(99, 9)).toBe(8)
})
