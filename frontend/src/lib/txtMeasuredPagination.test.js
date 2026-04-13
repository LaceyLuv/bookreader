import {
  buildMeasuredPages,
  splitOversizedSegmentIntoSlices,
} from './txtMeasuredPagination'

test('splitOversizedSegmentIntoSlices splits a long segment using deterministic measurements', () => {
  const slices = splitOversizedSegmentIntoSlices(
    {
      segmentId: 42,
      text: 'abcdefghij',
      startOffset: 100,
      endOffset: 110,
    },
    {
      maxSliceHeight: 4,
      measureSliceHeight: (slice) => slice.text.length,
    },
  )

  expect(slices).toEqual([
    {
      segmentId: 42,
      sliceStart: 0,
      sliceEnd: 4,
      text: 'abcd',
      displayText: 'abcd',
      startOffset: 100,
      endOffset: 104,
      sourceStartOffset: 100,
      sourceEndOffset: 104,
    },
    {
      segmentId: 42,
      sliceStart: 4,
      sliceEnd: 8,
      text: 'efgh',
      displayText: 'efgh',
      startOffset: 104,
      endOffset: 108,
      sourceStartOffset: 104,
      sourceEndOffset: 108,
    },
    {
      segmentId: 42,
      sliceStart: 8,
      sliceEnd: 10,
      text: 'ij',
      displayText: 'ij',
      startOffset: 108,
      endOffset: 110,
      sourceStartOffset: 108,
      sourceEndOffset: 110,
    },
  ])
})

test('buildMeasuredPages groups normalized segments into measured pages and preserves slices', () => {
  const pages = buildMeasuredPages(
    [
      {
        segmentId: 1,
        text: 'abc',
        startOffset: 0,
        endOffset: 3,
      },
      {
        segmentId: 2,
        text: 'defghij',
        startOffset: 3,
        endOffset: 10,
      },
      {
        segmentId: 3,
        text: 'klm',
        startOffset: 10,
        endOffset: 13,
      },
    ],
    {
      pageHeight: 5,
      measureSliceHeight: (slice) => slice.text.length,
      measurePageHeight: (pageSlices) => pageSlices.reduce((total, slice) => total + slice.text.length, 0),
    },
  )

  expect(pages).toHaveLength(3)
  expect(pages[0].page).toBe(0)
  expect(pages[0].firstSegmentId).toBe(1)
  expect(pages[0].lastSegmentId).toBe(2)
  expect(pages[0].slices.map(({ segmentId, sliceStart, sliceEnd }) => ({ segmentId, sliceStart, sliceEnd }))).toEqual([
    { segmentId: 1, sliceStart: 0, sliceEnd: 3 },
    { segmentId: 2, sliceStart: 0, sliceEnd: 2 },
  ])

  expect(pages[1].page).toBe(1)
  expect(pages[1].firstSegmentId).toBe(2)
  expect(pages[1].lastSegmentId).toBe(2)
  expect(pages[1].slices).toHaveLength(1)
  expect(pages[1].slices[0]).toMatchObject({
    segmentId: 2,
    sliceStart: 2,
    sliceEnd: 7,
    sourceStartOffset: 5,
    sourceEndOffset: 10,
  })

  expect(pages[2].page).toBe(2)
  expect(pages[2].slices).toHaveLength(1)
  expect(pages[2].slices[0]).toMatchObject({
    segmentId: 3,
    sliceStart: 0,
    sliceEnd: 3,
    sourceStartOffset: 10,
    sourceEndOffset: 13,
  })
})

test('buildMeasuredPages throws when even a one-character slice cannot fit a page', () => {
  const measurePageHeight = (pageSlices) => pageSlices.reduce((total, slice) => total + slice.text.length, 0) + (pageSlices.length > 0 ? 1 : 0)
  expect(() => buildMeasuredPages(
    [
      {
        segmentId: 9,
        text: 'abcde',
        startOffset: 0,
        endOffset: 5,
      },
    ],
    {
      pageHeight: 0,
      measureSliceHeight: (slice) => slice.text.length,
      measurePageHeight,
    },
  )).toThrow(/impossible fit/i)
})
