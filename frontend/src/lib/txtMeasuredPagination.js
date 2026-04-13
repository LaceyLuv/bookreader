function normalizeSegment(segment) {
  const segmentId = Number.isFinite(segment?.segmentId) ? segment.segmentId : segment?.segment_id
  const startOffset = Number.isFinite(segment?.startOffset)
    ? segment.startOffset
    : (Number.isFinite(segment?.start_offset)
        ? segment.start_offset
        : segment?.source_start_offset)
  const endOffset = Number.isFinite(segment?.endOffset)
    ? segment.endOffset
    : (Number.isFinite(segment?.end_offset)
        ? segment.end_offset
        : segment?.source_end_offset)
  const text = typeof segment?.text === 'string'
    ? segment.text
    : (typeof segment?.display_text === 'string' ? segment.display_text : '')
  const displayText = typeof segment?.displayText === 'string'
    ? segment.displayText
    : (typeof segment?.display_text === 'string' ? segment.display_text : text)

  return {
    ...segment,
    segmentId,
    startOffset: Number.isFinite(startOffset) ? startOffset : null,
    endOffset: Number.isFinite(endOffset) ? endOffset : (Number.isFinite(startOffset) ? startOffset + text.length : null),
    text,
    displayText,
  }
}

function getSliceHeight(measureSliceHeight, slice) {
  const measuredHeight = Number(measureSliceHeight(slice))
  if (Number.isFinite(measuredHeight) && measuredHeight > 0) return measuredHeight
  return 0
}

function getPageHeight(measurePageHeight, pageSlices) {
  const measuredHeight = Number(measurePageHeight(pageSlices))
  if (Number.isFinite(measuredHeight) && measuredHeight > 0) return measuredHeight
  return 0
}

function createSlice(segment, sliceStart, sliceEnd) {
  const text = segment.text.slice(sliceStart, sliceEnd)
  const sourceStartOffset = Number.isFinite(segment.startOffset) ? segment.startOffset + sliceStart : null
  const sourceEndOffset = Number.isFinite(sourceStartOffset) ? sourceStartOffset + text.length : null

  return {
    ...segment,
    text,
    displayText: text,
    sliceStart,
    sliceEnd,
    startOffset: sourceStartOffset,
    endOffset: sourceEndOffset,
    sourceStartOffset,
    sourceEndOffset,
  }
}

function findSliceEnd(segment, sliceStart, sliceEnd, maxSliceHeight, measureSliceHeight) {
  const cappedMaxHeight = Math.max(1, Number(maxSliceHeight) || 0)
  let low = sliceStart + 1
  let high = Math.max(low, sliceEnd)
  let bestEnd = low

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = createSlice(segment, sliceStart, mid)
    const height = getSliceHeight(measureSliceHeight, candidate)

    if (height <= cappedMaxHeight) {
      bestEnd = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return Math.max(bestEnd, sliceStart + 1)
}

function findSliceEndForPage(segment, sliceStart, sliceEnd, pageHeight, measurePageHeight) {
  const cappedPageHeight = Math.max(1, Number(pageHeight) || 0)
  let low = sliceStart + 1
  let high = Math.max(low, sliceEnd)
  let bestEnd = null

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = createSlice(segment, sliceStart, mid)
    const height = getPageHeight(measurePageHeight, [candidate])

    if (height <= cappedPageHeight) {
      bestEnd = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return bestEnd ?? Math.max(sliceStart + 1, Math.min(sliceEnd, sliceStart + 1))
}

function buildPage(pageIndex, pageSlices) {
  const firstSlice = pageSlices[0]
  const lastSlice = pageSlices[pageSlices.length - 1]
  const firstSegmentId = Number.isFinite(firstSlice?.segmentId) ? firstSlice.segmentId : null
  const lastSegmentId = Number.isFinite(lastSlice?.segmentId) ? lastSlice.segmentId : null
  const firstSourceOffset = Number.isFinite(firstSlice?.sourceStartOffset)
    ? firstSlice.sourceStartOffset
    : (Number.isFinite(firstSlice?.startOffset) ? firstSlice.startOffset : null)
  const lastSourceOffset = Number.isFinite(lastSlice?.sourceEndOffset)
    ? lastSlice.sourceEndOffset
    : (Number.isFinite(lastSlice?.endOffset) ? lastSlice.endOffset : null)

  return {
    page: pageIndex,
    slices: pageSlices,
    segments: pageSlices,
    segmentIds: pageSlices
      .map((slice) => slice.segmentId)
      .filter((segmentId, index, values) => Number.isFinite(segmentId) && values.indexOf(segmentId) === index),
    firstSegmentId,
    firstSourceOffset,
    lastSegmentId,
    lastSourceOffset,
    text: pageSlices.map((slice) => slice.displayText ?? slice.text ?? '').join('\n'),
    startLocator: Number.isFinite(firstSegmentId) && Number.isFinite(firstSourceOffset)
      ? `segment:${firstSegmentId}:offset:${firstSourceOffset}`
      : null,
  }
}

export function splitOversizedSegmentIntoSlices(segment, options = {}) {
  const normalizedSegment = normalizeSegment(segment)
  const measureSliceHeight = typeof options.measureSliceHeight === 'function'
    ? options.measureSliceHeight
    : (slice) => slice.text.length
  const maxSliceHeight = Math.max(1, Number(options.maxSliceHeight) || 0)
  const sliceStart = Math.max(0, Number(options.sliceStart) || 0)
  const sliceEnd = Math.min(
    normalizedSegment.text.length,
    Number.isFinite(options.sliceEnd) ? options.sliceEnd : normalizedSegment.text.length,
  )

  if (sliceEnd <= sliceStart) return []

  const slices = []
  let currentStart = sliceStart

  while (currentStart < sliceEnd) {
    const currentEnd = findSliceEnd(
      normalizedSegment,
      currentStart,
      sliceEnd,
      maxSliceHeight,
      measureSliceHeight,
    )
    const slice = createSlice(normalizedSegment, currentStart, currentEnd)
    slices.push(slice)
    currentStart = currentEnd
  }

  return slices
}

export function buildMeasuredPages(segments, options = {}) {
  const normalizedSegments = Array.isArray(segments) ? segments.map(normalizeSegment) : []
  const pageHeight = Math.max(1, Number(options.pageHeight) || 0)
  const measureSliceHeight = typeof options.measureSliceHeight === 'function'
    ? options.measureSliceHeight
    : (slice) => slice.text.length
  const measurePageHeight = typeof options.measurePageHeight === 'function'
    ? options.measurePageHeight
    : (pageSlices) => pageSlices.reduce((total, slice) => total + getSliceHeight(measureSliceHeight, slice), 0)

  const pages = []
  let pageSlices = []
  let pageIndex = 0

  function flushPage() {
    if (pageSlices.length === 0) return
    pages.push(buildPage(pageIndex, pageSlices))
    pageIndex += 1
    pageSlices = []
  }

  for (const segment of normalizedSegments) {
    let sliceStart = 0
    while (sliceStart < segment.text.length) {
      const currentPageHeight = getPageHeight(measurePageHeight, pageSlices)

      if (pageSlices.length > 0 && currentPageHeight >= pageHeight) {
        flushPage()
        continue
      }

      const availableHeight = Math.max(1, pageHeight - currentPageHeight)
      const sliceEnd = findSliceEnd(
        segment,
        sliceStart,
        segment.text.length,
        availableHeight,
        measureSliceHeight,
      )
      let nextSlice = createSlice(segment, sliceStart, sliceEnd)
      let nextPageHeight = getPageHeight(measurePageHeight, [...pageSlices, nextSlice])

      if (pageSlices.length > 0 && nextPageHeight > pageHeight) {
        flushPage()
        continue
      }

      if (pageSlices.length === 0 && nextPageHeight > pageHeight) {
        const minimalSlice = createSlice(segment, sliceStart, sliceStart + 1)
        if (getPageHeight(measurePageHeight, [minimalSlice]) > pageHeight) {
          throw new Error(
            `Measured pagination impossible fit for segment ${segment.segmentId ?? 'unknown'} at offset ${sliceStart}`,
          )
        }

        const fittedEnd = findSliceEndForPage(
          segment,
          sliceStart,
          segment.text.length,
          pageHeight,
          measurePageHeight,
        )
        nextSlice = createSlice(segment, sliceStart, fittedEnd)
        nextPageHeight = getPageHeight(measurePageHeight, [nextSlice])
      }

      pageSlices.push(nextSlice)
      sliceStart = nextSlice.sliceEnd

      const measuredPageHeight = getPageHeight(measurePageHeight, pageSlices)
      if (measuredPageHeight >= pageHeight) {
        flushPage()
      }
    }
  }

  flushPage()
  return pages
}
