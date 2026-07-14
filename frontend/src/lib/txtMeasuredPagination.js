import { utf16IndexToCodePoint } from './txtUnicodeOffsets'

const SENTENCE_BREAK_RE = /[.!?。！？…]/u
const SENTENCE_CLOSER_RE = /["'’”〉》」』】〕〗〙）]/u

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

function getMappedSourceOffset(segment, displayIndex) {
  const mapping = Array.isArray(segment?.display_to_source) ? segment.display_to_source : null
  if (mapping?.length) return mapping[displayIndex] ?? null

  const runs = Array.isArray(segment?.display_to_source_runs) ? segment.display_to_source_runs : null
  if (!runs?.length) return null

  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 3) continue
    const [displayStart, sourceStart, length] = run
    if (displayIndex >= displayStart && displayIndex < displayStart + length) {
      return sourceStart + displayIndex - displayStart
    }
  }

  return null
}

function getSliceSourceRange(segment, sliceStart, sliceEnd) {
  const displayStart = utf16IndexToCodePoint(segment.text, sliceStart)
  const displayEnd = utf16IndexToCodePoint(segment.text, sliceEnd)
  const mappedStart = getMappedSourceOffset(segment, displayStart)
  const mappedEndCharacter = getMappedSourceOffset(segment, displayEnd - 1)
  const fallbackStart = Number.isFinite(segment.startOffset) ? segment.startOffset + displayStart : null
  const fallbackEnd = Number.isFinite(segment.startOffset) ? segment.startOffset + displayEnd : null

  return {
    sourceStartOffset: Number.isFinite(mappedStart) ? mappedStart : fallbackStart,
    sourceEndOffset: Number.isFinite(mappedEndCharacter) ? mappedEndCharacter + 1 : fallbackEnd,
  }
}

function clampToCodePointBoundary(text, sliceStart, sliceEnd) {
  if (sliceEnd <= sliceStart || sliceEnd >= text.length) return sliceEnd
  const previousCodeUnit = text.charCodeAt(sliceEnd - 1)
  const nextCodeUnit = text.charCodeAt(sliceEnd)
  const splitsSurrogatePair = previousCodeUnit >= 0xD800 && previousCodeUnit <= 0xDBFF
    && nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF
  if (!splitsSurrogatePair) return sliceEnd
  return sliceEnd - 1 > sliceStart ? sliceEnd - 1 : Math.min(text.length, sliceEnd + 1)
}

function findLastBreak(text, sliceStart, sliceEnd, predicate) {
  for (let index = sliceEnd - 1; index >= sliceStart; index -= 1) {
    if (predicate(text[index])) return index
  }
  return -1
}

function findPreferredSliceEnd(segment, sliceStart, measuredEnd, hardEnd) {
  if (measuredEnd >= hardEnd) return hardEnd

  const text = segment.text
  const newlineIndex = findLastBreak(text, sliceStart, measuredEnd, (character) => character === '\n')
  if (newlineIndex >= sliceStart) return newlineIndex + 1

  const sentenceIndex = findLastBreak(text, sliceStart, measuredEnd, (character) => SENTENCE_BREAK_RE.test(character))
  if (sentenceIndex >= sliceStart) {
    let preferredEnd = sentenceIndex + 1
    while (preferredEnd < measuredEnd && SENTENCE_CLOSER_RE.test(text[preferredEnd])) preferredEnd += 1
    while (preferredEnd < measuredEnd && /[ \t]/u.test(text[preferredEnd])) preferredEnd += 1
    return preferredEnd
  }

  const whitespaceIndex = findLastBreak(text, sliceStart, measuredEnd, (character) => /[ \t]/u.test(character))
  if (whitespaceIndex >= sliceStart) return whitespaceIndex + 1

  return clampToCodePointBoundary(text, sliceStart, measuredEnd)
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
  const { sourceStartOffset, sourceEndOffset } = getSliceSourceRange(segment, sliceStart, sliceEnd)

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
    const measuredEnd = findSliceEnd(
      normalizedSegment,
      currentStart,
      sliceEnd,
      maxSliceHeight,
      measureSliceHeight,
    )
    const currentEnd = findPreferredSliceEnd(normalizedSegment, currentStart, measuredEnd, sliceEnd)
    const slice = createSlice(normalizedSegment, currentStart, currentEnd)
    slices.push(slice)
    currentStart = currentEnd
  }

  return slices
}

export function buildMeasuredPages(segments, options = {}) {
  const normalizedSegments = Array.isArray(segments) ? segments.map(normalizeSegment) : []
  const pageHeight = Math.max(1, Number(options.pageHeight) || 0)
  const minTrailingSliceHeight = Math.max(0, Number(options.minTrailingSliceHeight) || 0)
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

      if (sliceStart === 0 && pageSlices.length > 0) {
        const fullSegmentSlice = createSlice(segment, 0, segment.text.length)
        const fullSegmentHeight = getPageHeight(measurePageHeight, [fullSegmentSlice])
        const pageWithFullSegmentHeight = getPageHeight(measurePageHeight, [...pageSlices, fullSegmentSlice])
        if (fullSegmentHeight <= pageHeight && pageWithFullSegmentHeight > pageHeight) {
          flushPage()
          continue
        }
      }

      const availableHeight = Math.max(1, pageHeight - currentPageHeight)
      const measuredSliceEnd = findSliceEnd(
        segment,
        sliceStart,
        segment.text.length,
        availableHeight,
        measureSliceHeight,
      )
      const sliceEnd = findPreferredSliceEnd(segment, sliceStart, measuredSliceEnd, segment.text.length)
      let nextSlice = createSlice(segment, sliceStart, sliceEnd)
      let nextPageHeight = getPageHeight(measurePageHeight, [...pageSlices, nextSlice])

      if (pageSlices.length > 0 && nextPageHeight > pageHeight) {
        const measuredFittedEnd = findSliceEndForPage(
          segment,
          sliceStart,
          sliceEnd,
          pageHeight,
          (candidateSlices) => measurePageHeight([...pageSlices, ...candidateSlices]),
        )
        const fittedEnd = findPreferredSliceEnd(segment, sliceStart, measuredFittedEnd, segment.text.length)
        if (fittedEnd > sliceStart) {
          const leavesTrailingSlice = fittedEnd < segment.text.length
          if (leavesTrailingSlice && minTrailingSliceHeight > 0) {
            const trailingSlice = createSlice(segment, fittedEnd, segment.text.length)
            const trailingHeight = getSliceHeight(measureSliceHeight, trailingSlice)
            if (trailingHeight <= minTrailingSliceHeight) {
              flushPage()
              continue
            }
          }
          nextSlice = createSlice(segment, sliceStart, fittedEnd)
          nextPageHeight = getPageHeight(measurePageHeight, [...pageSlices, nextSlice])
          if (nextPageHeight <= pageHeight) {
            pageSlices.push(nextSlice)
            sliceStart = nextSlice.sliceEnd
            flushPage()
            continue
          }
        }
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

        const measuredFittedEnd = findSliceEndForPage(
          segment,
          sliceStart,
          segment.text.length,
          pageHeight,
          measurePageHeight,
        )
        const fittedEnd = findPreferredSliceEnd(segment, sliceStart, measuredFittedEnd, segment.text.length)
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
