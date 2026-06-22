import { expect, test } from 'vitest'

import {
  createTxtMeasuredPaginationOptions,
  estimateWrappedLineCount,
  getTxtViewportMetrics,
} from './txtPageMetrics'
import { buildMeasuredPages } from './txtMeasuredPagination'

test('getTxtViewportMetrics derives realistic line and character capacity from desktop viewport settings', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1200,
    viewportHeight: 700,
    pagesPerView: 1,
    columnGap: 32,
    fontSizePx: 18,
    lineHeight: 1.8,
    averageCharWidthPx: 16,
  })

  expect(metrics.charsPerLine).toBeGreaterThan(40)
  expect(metrics.linesPerPage).toBeGreaterThan(10)
})

test('getTxtViewportMetrics uses the full padded page height without adding bottom safety whitespace', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1200,
    viewportHeight: 700,
    pagesPerView: 1,
    columnGap: 32,
    fontSizePx: 20,
    lineHeight: 2,
    averageCharWidthPx: 16,
  })

  expect(metrics.linesPerPage).toBe(16)
})

test('getTxtViewportMetrics can reserve a small vertical-only safety padding', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1200,
    viewportHeight: 83,
    pagesPerView: 1,
    columnGap: 32,
    fontSizePx: 10,
    lineHeight: 1,
    pageHorizontalPaddingPx: 20,
    pageVerticalPaddingPx: 22,
    averageCharWidthPx: 16,
  })

  expect(metrics.linesPerPage).toBe(3)
  expect(metrics.charsPerLine).toBe(72)
})

test('getTxtViewportMetrics can reclaim lines from excessive bottom whitespace', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1200,
    viewportHeight: 700,
    pagesPerView: 1,
    columnGap: 32,
    fontSizePx: 20,
    lineHeight: 2,
    linesPerPageAdjustment: 4,
    averageCharWidthPx: 16,
  })

  expect(metrics.linesPerPage).toBe(20)
})

test('getTxtViewportMetrics exposes minimum trailing slice height', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1200,
    viewportHeight: 700,
    minTrailingSliceLines: 2,
  })

  expect(metrics.minTrailingSliceHeight).toBe(2)
  expect(createTxtMeasuredPaginationOptions(metrics).minTrailingSliceHeight).toBe(2)
})

test('getTxtViewportMetrics honors measured character width in dual-page mode', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1024,
    viewportHeight: 700,
    pagesPerView: 2,
    columnGap: 32,
    fontSizePx: 28,
    lineHeight: 1.8,
    averageCharWidthPx: 18,
  })

  expect(metrics.charsPerLine).toBe(25)
})

test('viewport-based pagination keeps two short fragments on the same page', () => {
  const metrics = getTxtViewportMetrics({
    viewportWidth: 1200,
    viewportHeight: 700,
    pagesPerView: 1,
    columnGap: 32,
    fontSizePx: 18,
    lineHeight: 1.8,
    averageCharWidthPx: 16,
  })

  const pages = buildMeasuredPages([
    {
      fragmentIndex: 0,
      segment_id: 0,
      display_text: '서장 무적비비탄 - [1]',
      source_start_offset: 0,
      source_end_offset: 15,
    },
    {
      fragmentIndex: 1,
      segment_id: 1,
      display_text: '백이십 년을 살았다.',
      source_start_offset: 15,
      source_end_offset: 26,
    },
  ], createTxtMeasuredPaginationOptions(metrics))

  expect(pages).toHaveLength(1)
  expect(pages[0].segments).toHaveLength(2)
})

test('estimateWrappedLineCount respects explicit newline breaks', () => {
  expect(estimateWrappedLineCount('alpha\nbeta', 20)).toBe(2)
})

test('createTxtMeasuredPaginationOptions accounts for paragraph spacing between separate slices', () => {
  const options = createTxtMeasuredPaginationOptions({
    charsPerLine: 20,
    linesPerPage: 10,
    paragraphGapLines: 1,
  })

  expect(options.measureSliceHeight({ displayText: 'alpha' })).toBe(1)
  expect(options.measurePageHeight([
    { segmentId: 1, sliceStart: 0, sliceEnd: 5, displayText: 'alpha' },
    { segmentId: 2, sliceStart: 0, sliceEnd: 4, displayText: 'beta' },
  ])).toBe(3)
  expect(options.measurePageHeight([
    { segmentId: 1, sliceStart: 0, sliceEnd: 5, displayText: 'alpha' },
    { segmentId: 1, sliceStart: 5, sliceEnd: 9, displayText: 'beta' },
  ])).toBe(2)
})
