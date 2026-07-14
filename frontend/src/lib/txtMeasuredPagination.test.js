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

test('buildMeasuredPages only fills remaining page space from a paragraph larger than an empty page', () => {
  const pages = buildMeasuredPages(
    [
      {
        segmentId: 1,
        text: 'abcd',
        startOffset: 0,
        endOffset: 4,
      },
      {
        segmentId: 2,
        text: 'efghijkl',
        startOffset: 4,
        endOffset: 12,
      },
    ],
    {
      pageHeight: 6,
      measureSliceHeight: (slice) => slice.text.length,
      measurePageHeight: (pageSlices) => (
        pageSlices.reduce((total, slice) => total + slice.text.length, 0)
        + Math.max(0, pageSlices.length - 1)
      ),
    },
  )

  expect(pages[0].slices.map(({ segmentId, sliceStart, sliceEnd }) => ({ segmentId, sliceStart, sliceEnd }))).toEqual([
    { segmentId: 1, sliceStart: 0, sliceEnd: 4 },
    { segmentId: 2, sliceStart: 0, sliceEnd: 1 },
  ])
  expect(pages[1].slices[0]).toMatchObject({
    segmentId: 2,
    sliceStart: 1,
    sliceEnd: 7,
  })
})

test('buildMeasuredPages avoids leaving a tiny trailing sentence fragment on the next page', () => {
  const pages = buildMeasuredPages(
    [
      {
        segmentId: 1,
        text: 'abcdefghijklmnopqrst',
        startOffset: 0,
        endOffset: 20,
      },
      {
        segmentId: 2,
        text: 'uvwxyzabcd',
        startOffset: 20,
        endOffset: 30,
      },
    ],
    {
      pageHeight: 6,
      minTrailingSliceHeight: 2,
      measureSliceHeight: (slice) => Math.ceil(slice.text.length / 5),
      measurePageHeight: (pageSlices) => (
        pageSlices.reduce((total, slice) => total + Math.ceil(slice.text.length / 5), 0)
        + Math.max(0, pageSlices.length - 1)
      ),
    },
  )

  expect(pages[0].slices.map(({ segmentId, sliceStart, sliceEnd }) => ({ segmentId, sliceStart, sliceEnd }))).toEqual([
    { segmentId: 1, sliceStart: 0, sliceEnd: 20 },
  ])
  expect(pages[1].slices[0]).toMatchObject({
    segmentId: 2,
    sliceStart: 0,
    sliceEnd: 10,
  })
})

test('buildMeasuredPages moves a paragraph that fits on an empty page instead of splitting it', () => {
  const pages = buildMeasuredPages(
    [
      { segmentId: 1, text: '1234', startOffset: 0, endOffset: 4 },
      { segmentId: 2, text: 'abc', startOffset: 4, endOffset: 7 },
    ],
    {
      pageHeight: 5,
      measureSliceHeight: (slice) => slice.text.length,
      measurePageHeight: (pageSlices) => pageSlices.reduce((total, slice) => total + slice.text.length, 0),
    },
  )

  expect(pages).toHaveLength(2)
  expect(pages[0].slices.map((slice) => slice.text)).toEqual(['1234'])
  expect(pages[1].slices.map((slice) => slice.text)).toEqual(['abc'])
})

test('splitOversizedSegmentIntoSlices prefers safe whitespace boundaries', () => {
  const text = 'alpha beta gamma'
  const slices = splitOversizedSegmentIntoSlices(
    { segmentId: 3, text, startOffset: 100, endOffset: 116 },
    {
      maxSliceHeight: 7,
      measureSliceHeight: (slice) => slice.text.length,
    },
  )

  expect(slices.map((slice) => slice.text)).toEqual(['alpha ', 'beta ', 'gamma'])
  expect(slices.map((slice) => [slice.sourceStartOffset, slice.sourceEndOffset])).toEqual([
    [100, 106],
    [106, 111],
    [111, 116],
  ])
  expect(slices.map((slice) => slice.text).join('')).toBe(text)
})

test('splitOversizedSegmentIntoSlices prefers sentence punctuation over whitespace', () => {
  const slices = splitOversizedSegmentIntoSlices(
    { segmentId: 4, text: 'First sentence. Next words', startOffset: 0, endOffset: 26 },
    {
      maxSliceHeight: 19,
      measureSliceHeight: (slice) => slice.text.length,
    },
  )

  expect(slices[0].text).toBe('First sentence. ')
  expect(slices.map((slice) => slice.text).join('')).toBe('First sentence. Next words')
})

test('splitOversizedSegmentIntoSlices falls back to character boundaries and always progresses', () => {
  const text = 'abcdefghijklmnop'
  const slices = splitOversizedSegmentIntoSlices(
    { segmentId: 5, text, startOffset: 20, endOffset: 36 },
    {
      maxSliceHeight: 5,
      measureSliceHeight: (slice) => slice.text.length,
    },
  )

  expect(slices.map((slice) => slice.text)).toEqual(['abcde', 'fghij', 'klmno', 'p'])
  expect(slices.map((slice) => slice.text).join('')).toBe(text)
})

test('split slices preserve mapped source offsets across omitted display characters', () => {
  const slices = splitOversizedSegmentIntoSlices(
    {
      segmentId: 6,
      text: 'alpha beta',
      startOffset: 50,
      endOffset: 62,
      display_to_source_runs: [
        [0, 50, 5],
        [5, 57, 5],
      ],
    },
    {
      maxSliceHeight: 6,
      measureSliceHeight: (slice) => slice.text.length,
    },
  )

  expect(slices.map((slice) => slice.text).join('')).toBe('alpha beta')
  expect(slices.map((slice) => [slice.sourceStartOffset, slice.sourceEndOffset])).toEqual([
    [50, 58],
    [58, 62],
  ])
})
