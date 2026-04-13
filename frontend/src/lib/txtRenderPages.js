import { clampViewportPage, getPagesPerView } from './txtPagination'

function getRenderPageEntries(page) {
  if (Array.isArray(page?.slices) && page.slices.length > 0) return page.slices
  if (Array.isArray(page?.segments) && page.segments.length > 0) return page.segments
  return []
}

function getEntryStartOffset(entry) {
  if (Number.isFinite(entry?.sourceStartOffset)) return entry.sourceStartOffset
  if (Number.isFinite(entry?.startOffset)) return entry.startOffset
  if (Number.isFinite(entry?.source_start_offset)) return entry.source_start_offset
  return null
}

function getEntryEndOffset(entry) {
  if (Number.isFinite(entry?.sourceEndOffset)) return entry.sourceEndOffset
  if (Number.isFinite(entry?.endOffset)) return entry.endOffset
  if (Number.isFinite(entry?.source_end_offset)) return entry.source_end_offset
  return null
}

function getRenderPageStartLocator(page, pageIndex = null) {
  if (page?.startLocator != null) return page.startLocator

  const firstEntry = getRenderPageEntries(page)[0]
  const segmentId = Number.isFinite(firstEntry?.segmentId) ? firstEntry.segmentId : null
  const startOffset = getEntryStartOffset(firstEntry)

  if (Number.isFinite(segmentId) && Number.isFinite(startOffset)) {
    return `segment:${segmentId}:offset:${startOffset}`
  }

  if (Number.isFinite(segmentId)) return segmentId
  return Number.isFinite(pageIndex) ? pageIndex : null
}

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
  const fragmentKey = segment?.fragmentKey
    ?? segment?.fragment_key
    ?? `${segmentId ?? 'segment'}:${Number.isFinite(startOffset) ? startOffset : 'start'}:${Number.isFinite(endOffset) ? endOffset : 'end'}`

  return {
    ...segment,
    fragmentKey,
    fragmentIndex: Number.isFinite(segment?.fragmentIndex)
      ? segment.fragmentIndex
      : segment?.fragment_index,
    segmentId,
    startOffset: Number.isFinite(startOffset) ? startOffset : null,
    endOffset: Number.isFinite(endOffset) ? endOffset : null,
    text,
    displayText,
  }
}

function getSegmentLength(segment) {
  if (typeof segment.displayText === 'string') {
    return segment.displayText.length
  }
  if (Number.isFinite(segment.startOffset) && Number.isFinite(segment.endOffset) && segment.endOffset >= segment.startOffset) {
    return segment.endOffset - segment.startOffset
  }
  return segment.text.length
}

function flushPage(pages, currentPage) {
  if (!currentPage || currentPage.segments.length === 0) return
  const startSegment = currentPage.segments[0]
  const startLocator = Number.isFinite(startSegment?.segmentId) && Number.isFinite(startSegment?.startOffset)
    ? `segment:${startSegment.segmentId}:offset:${startSegment.startOffset}`
    : (Number.isFinite(startSegment?.segmentId) ? startSegment.segmentId : pages.length)

  pages.push({
    page: pages.length,
    segmentIds: currentPage.segments.map((segment) => segment.segmentId),
    segments: currentPage.segments,
    startFragmentIndex: Number.isFinite(startSegment?.fragmentIndex) ? startSegment.fragmentIndex : null,
    startLocator,
    text: currentPage.segments.map((segment) => segment.displayText).join('\n'),
    startOffset: startSegment.startOffset,
    endOffset: currentPage.segments[currentPage.segments.length - 1].endOffset,
  })
}

export function composeRenderPages(segments, options = {}) {
  const maxCharactersPerPage = Math.max(1, Number(options.maxCharactersPerPage) || 80)
  const pages = []
  let currentPage = null

  for (const rawSegment of Array.isArray(segments) ? segments : []) {
    const segment = normalizeSegment(rawSegment)
    const segmentLength = getSegmentLength(segment)
    const nextLength = currentPage
      ? currentPage.textLength + (currentPage.segments.length > 0 ? 1 : 0) + segmentLength
      : segmentLength

    if (!currentPage || (currentPage.segments.length > 0 && nextLength > maxCharactersPerPage)) {
      flushPage(pages, currentPage)
      currentPage = {
        segments: [],
        textLength: 0,
      }
    }

    if (currentPage.segments.length > 0) {
      currentPage.textLength += 1
    }

    currentPage.segments.push(segment)
    currentPage.textLength += segmentLength
  }

  flushPage(pages, currentPage)
  return pages
}

function parseLocator(locator) {
  if (Number.isFinite(locator)) {
    return { type: 'segment', pageIndex: null, segmentId: locator, offset: null }
  }

  if (typeof locator === 'string') {
    const segmentMatch = locator.match(/^segment:(\d+):offset:(\d+)$/)
    if (segmentMatch) {
      return {
        type: 'segment',
        pageIndex: null,
        segmentId: Number(segmentMatch[1]),
        offset: Number(segmentMatch[2]),
      }
    }

    const pageMatch = locator.match(/^page:(\d+)$/)
    if (pageMatch) {
      return {
        type: 'page',
        pageIndex: Number(pageMatch[1]),
        segmentId: null,
        offset: null,
      }
    }

    return { type: 'unknown', pageIndex: null, segmentId: null, offset: null }
  }

  if (locator && typeof locator === 'object') {
    const segmentId = Number.isFinite(locator.segmentId)
      ? locator.segmentId
      : (Number.isFinite(locator.segment_id) ? locator.segment_id : null)
    const pageIndex = Number.isFinite(locator.page)
      ? locator.page
      : (Number.isFinite(locator.position) ? locator.position : null)
    const offset = Number.isFinite(locator.offset)
      ? locator.offset
      : (Number.isFinite(locator.start_offset)
          ? locator.start_offset
          : locator.segment_local_start)

    if (Number.isFinite(segmentId)) {
      return {
        type: 'segment',
        pageIndex: null,
        segmentId,
        offset: Number.isFinite(offset) ? offset : null,
      }
    }

    if (Number.isFinite(pageIndex)) {
      return {
        type: 'page',
        pageIndex,
        segmentId: null,
        offset: null,
      }
    }

    if (typeof locator.locator === 'string') {
      return parseLocator(locator.locator)
    }

    return {
      type: 'unknown',
      pageIndex: null,
      segmentId: null,
      offset: Number.isFinite(offset) ? offset : null,
    }
  }

  return { type: 'unknown', pageIndex: null, segmentId: null, offset: null }
}

export function getPageIndexForLocator(locator, fallbackPageIndex = null) {
  const { type, pageIndex } = parseLocator(locator)
  if (type === 'page' && Number.isFinite(pageIndex)) return pageIndex
  return Number.isFinite(fallbackPageIndex) ? fallbackPageIndex : null
}

export function getSegmentIdForLocator(locator, fallbackSegmentId = null) {
  const { type, segmentId } = parseLocator(locator)
  if (type === 'segment' && Number.isFinite(segmentId)) return segmentId
  return Number.isFinite(fallbackSegmentId) ? fallbackSegmentId : null
}

export function findRenderPageForLocator(renderPages, locator) {
  const pages = Array.isArray(renderPages) ? renderPages : []
  const { type, pageIndex, segmentId, offset } = parseLocator(locator)
  const segmentStartOffsets = new Map()
  const segmentBounds = new Map()

  if (type === 'page' && Number.isFinite(pageIndex)) {
    return clampViewportPage(pageIndex, pages.length || pageIndex + 1)
  }

  for (const page of pages) {
    for (const segment of getRenderPageEntries(page)) {
      const startOffset = getEntryStartOffset(segment)
      const endOffset = getEntryEndOffset(segment)
      if (!Number.isFinite(segment?.segmentId) || !Number.isFinite(startOffset)) continue
      const currentStart = segmentStartOffsets.get(segment.segmentId)
      if (!Number.isFinite(currentStart) || startOffset < currentStart) {
        segmentStartOffsets.set(segment.segmentId, startOffset)
      }

      if (!Number.isFinite(endOffset)) continue
      const currentBounds = segmentBounds.get(segment.segmentId) ?? {
        minStart: startOffset,
        maxEnd: endOffset,
        lastPage: page.page,
      }
      if (startOffset < currentBounds.minStart) currentBounds.minStart = startOffset
      if (endOffset > currentBounds.maxEnd || (endOffset === currentBounds.maxEnd && page.page >= currentBounds.lastPage)) {
        currentBounds.maxEnd = endOffset
        currentBounds.lastPage = page.page
      }
      segmentBounds.set(segment.segmentId, currentBounds)
    }
  }

  for (const page of pages) {
    const hit = getRenderPageEntries(page).find((segment) => {
      if (segment.segmentId !== segmentId) return false
      if (!Number.isFinite(offset)) return true
      const startOffset = getEntryStartOffset(segment)
      const endOffset = getEntryEndOffset(segment)
      if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return true
      const segmentStartOffset = segmentStartOffsets.get(segment.segmentId)
      if (offset >= startOffset && offset < endOffset) return true
      if (!Number.isFinite(segmentStartOffset)) return false
      const localStartOffset = startOffset - segmentStartOffset
      const localEndOffset = endOffset - segmentStartOffset
      return offset >= localStartOffset && offset < localEndOffset
    })

    if (hit) return page.page
  }

  if (Number.isFinite(segmentId) && Number.isFinite(offset)) {
    const bounds = segmentBounds.get(segmentId)
    if (bounds) {
      const localTerminalOffset = bounds.maxEnd - bounds.minStart
      if (offset === bounds.maxEnd || offset === localTerminalOffset) {
        return bounds.lastPage
      }
    }
  }

  return 0
}

export function findRenderPageForSegmentOffset(renderPages, locator) {
  return findRenderPageForLocator(renderPages, locator)
}

export function getRenderPageStartSegment(renderPages, locator, fallbackSegmentId = 0) {
  const pages = Array.isArray(renderPages) ? renderPages : []
  const explicitPageIndex = getPageIndexForLocator(locator)
  const pageIndex = Number.isFinite(explicitPageIndex)
    ? clampViewportPage(explicitPageIndex, pages.length || explicitPageIndex + 1)
    : findRenderPageForLocator(pages, locator)
  const page = pages[pageIndex]
  if (page?.startLocator != null) return page.startLocator

  const startEntry = getRenderPageEntries(page)[0]
  const startSegmentId = startEntry?.segmentId
  const startOffset = getEntryStartOffset(startEntry)
  if (Number.isFinite(startSegmentId) && Number.isFinite(startOffset)) {
    return `segment:${startSegmentId}:offset:${startOffset}`
  }
  if (Number.isFinite(startSegmentId)) return startSegmentId

  return getSegmentIdForLocator(locator, fallbackSegmentId) ?? 0
}

export function getRenderPageStartSegments(renderPages) {
  return (Array.isArray(renderPages) ? renderPages : [])
    .map((page, pageIndex) => getRenderPageStartLocator(page, pageIndex))
    .filter((locator) => typeof locator === 'string' || Number.isFinite(locator))
}

export function getVisibleRenderPages(renderPages, layout, currentPage = 0) {
  const pages = Array.isArray(renderPages) ? renderPages : []
  const pagesPerView = getPagesPerView(layout)
  const startPage = clampViewportPage(currentPage, pages.length)
  return pages.slice(startPage, startPage + pagesPerView)
}
