import {
  composeRenderPages,
  findRenderPageForSegmentOffset,
  getRenderPageStartSegment,
  getVisibleRenderPages,
} from './txtRenderPages'

test('composeRenderPages packs multiple short segments into one render page', () => {
  const renderPages = composeRenderPages(
    [
      { segmentId: 1, text: 'alpha' },
      { segmentId: 2, text: 'beta' },
      { segmentId: 3, text: 'this segment is long enough to force a break' },
    ],
    { maxCharactersPerPage: 16 },
  )

  expect(renderPages).toHaveLength(2)
  expect(renderPages[0].segmentIds).toEqual([1, 2])
  expect(renderPages[0].text).toBe('alpha\nbeta')
  expect(renderPages[1].segmentIds).toEqual([3])
})

test('findRenderPageForSegmentOffset returns the page containing a segment locator', () => {
  const renderPages = composeRenderPages(
    [
      { segmentId: 7, text: 'alpha' },
      { segmentId: 8, text: 'beta beta beta' },
    ],
    { maxCharactersPerPage: 5 },
  )

  expect(findRenderPageForSegmentOffset(renderPages, 'segment:7:offset:0')).toBe(0)
  expect(findRenderPageForSegmentOffset(renderPages, 'segment:8:offset:4')).toBe(1)
})

test('findRenderPageForSegmentOffset treats the segment end offset as exclusive', () => {
  const renderPages = [
    {
      page: 0,
      segments: [{ segmentId: 7, startOffset: 0, endOffset: 80 }],
    },
    {
      page: 1,
      segments: [{ segmentId: 7, startOffset: 80, endOffset: 160 }],
    },
  ]

  expect(findRenderPageForSegmentOffset(renderPages, 'segment:7:offset:80')).toBe(1)
})

test('findRenderPageForSegmentOffset resolves a sliced page entry', () => {
  const renderPages = [
    {
      page: 0,
      slices: [
        {
          segmentId: 9,
          sliceStart: 0,
          sliceEnd: 4,
          startOffset: 0,
          endOffset: 4,
        },
      ],
    },
    {
      page: 1,
      slices: [
        {
          segmentId: 9,
          sliceStart: 4,
          sliceEnd: 8,
          startOffset: 4,
          endOffset: 8,
        },
      ],
    },
  ]

  expect(findRenderPageForSegmentOffset(renderPages, 'segment:9:offset:5')).toBe(1)
  expect(getRenderPageStartSegment(renderPages, 'segment:9:offset:5')).toBe('segment:9:offset:4')
})

test('findRenderPageForSegmentOffset resolves the terminal exclusive offset on the last slice', () => {
  const renderPages = [
    {
      page: 0,
      slices: [
        {
          segmentId: 11,
          sliceStart: 0,
          sliceEnd: 3,
          startOffset: 0,
          endOffset: 3,
        },
      ],
    },
    {
      page: 1,
      slices: [
        {
          segmentId: 11,
          sliceStart: 3,
          sliceEnd: 6,
          startOffset: 3,
          endOffset: 6,
        },
      ],
    },
  ]

  expect(findRenderPageForSegmentOffset(renderPages, 'segment:11:offset:6')).toBe(1)
  expect(getRenderPageStartSegment(renderPages, 'segment:11:offset:6')).toBe('segment:11:offset:3')
})

test('getVisibleRenderPages returns one page in single mode and two in dual mode', () => {
  const renderPages = [
    { page: 0, text: 'alpha' },
    { page: 1, text: 'beta' },
    { page: 2, text: 'gamma' },
  ]

  expect(getVisibleRenderPages(renderPages, 'single', 1)).toEqual([renderPages[1]])
  expect(getVisibleRenderPages(renderPages, 'dual', 1)).toEqual([renderPages[1], renderPages[2]])
})
