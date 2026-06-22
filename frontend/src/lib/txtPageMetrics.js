const DEFAULT_FONT_SIZE_PX = 18
const DEFAULT_LINE_HEIGHT = 1.8
const DEFAULT_AVERAGE_CHAR_WIDTH_RATIO = 0.9
const DEFAULT_PAGE_PADDING_PX = 20
const MIN_CHARS_PER_LINE = 8
const MIN_LINES_PER_PAGE = 3

function toFiniteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toTextLength(value) {
  if (typeof value !== 'string' || value.length === 0) return 0
  return Array.from(value).length
}

export function measureAverageCharacterWidth({
  fontFamily,
  fontWeight,
  fontSizePx = DEFAULT_FONT_SIZE_PX,
} = {}) {
  const safeFontSize = Math.max(1, toFiniteNumber(fontSizePx, DEFAULT_FONT_SIZE_PX))

  if (typeof document === 'undefined') {
    return safeFontSize * DEFAULT_AVERAGE_CHAR_WIDTH_RATIO
  }

  if (typeof navigator !== 'undefined' && /\bjsdom\b/i.test(navigator.userAgent || '')) {
    return safeFontSize * DEFAULT_AVERAGE_CHAR_WIDTH_RATIO
  }

  const canvas = document.createElement('canvas')
  let context = null
  try {
    context = canvas.getContext?.('2d')
  } catch {
    context = null
  }
  if (!context) return safeFontSize * DEFAULT_AVERAGE_CHAR_WIDTH_RATIO

  const safeFontWeight = toFiniteNumber(fontWeight, 400)
  const safeFontFamily = typeof fontFamily === 'string' && fontFamily.trim()
    ? fontFamily
    : 'system-ui'
  context.font = `${safeFontWeight} ${safeFontSize}px ${safeFontFamily}`

  const sample = '가나다라마바사아자차카타파하ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const width = context.measureText(sample).width
  if (!Number.isFinite(width) || width <= 0) {
    return safeFontSize * DEFAULT_AVERAGE_CHAR_WIDTH_RATIO
  }
  return width / sample.length
}

export function getTxtViewportMetrics({
  viewportWidth,
  viewportHeight,
  pagesPerView = 1,
  columnGap = 32,
  fontSizePx = DEFAULT_FONT_SIZE_PX,
  lineHeight = DEFAULT_LINE_HEIGHT,
  pagePaddingPx = DEFAULT_PAGE_PADDING_PX,
  pageHorizontalPaddingPx = pagePaddingPx,
  pageVerticalPaddingPx = pagePaddingPx,
  paragraphGapLines = 0,
  linesPerPageAdjustment = 0,
  minLinesPerPage = MIN_LINES_PER_PAGE,
  minTrailingSliceLines = 0,
  averageCharWidthPx,
} = {}) {
  const safeViewportWidth = Math.max(1, toFiniteNumber(viewportWidth, 0))
  const safeViewportHeight = Math.max(1, toFiniteNumber(viewportHeight, 0))
  const safePagesPerView = Math.max(1, Math.floor(toFiniteNumber(pagesPerView, 1)))
  const safeColumnGap = Math.max(0, toFiniteNumber(columnGap, 32))
  const safePagePadding = Math.max(0, toFiniteNumber(pagePaddingPx, DEFAULT_PAGE_PADDING_PX))
  const safePageHorizontalPadding = Math.max(0, toFiniteNumber(pageHorizontalPaddingPx, safePagePadding))
  const safePageVerticalPadding = Math.max(0, toFiniteNumber(pageVerticalPaddingPx, safePagePadding))
  const safeFontSize = Math.max(1, toFiniteNumber(fontSizePx, DEFAULT_FONT_SIZE_PX))
  const safeLineHeight = Math.max(1, toFiniteNumber(lineHeight, DEFAULT_LINE_HEIGHT))
  const safeAverageCharWidth = Math.max(1, toFiniteNumber(averageCharWidthPx, safeFontSize * DEFAULT_AVERAGE_CHAR_WIDTH_RATIO))
  const safeMinLinesPerPage = Math.max(1, Math.floor(toFiniteNumber(minLinesPerPage, MIN_LINES_PER_PAGE)))

  const pageWidth = ((safeViewportWidth - (safeColumnGap * (safePagesPerView - 1))) / safePagesPerView) - (safePageHorizontalPadding * 2)
  const lineHeightPx = safeFontSize * safeLineHeight
  const pageHeight = safeViewportHeight - (safePageVerticalPadding * 2)
  const adjustedLinesPerPage = Math.floor(pageHeight / lineHeightPx) + Math.floor(toFiniteNumber(linesPerPageAdjustment, 0))

  return {
    charsPerLine: Math.max(MIN_CHARS_PER_LINE, Math.floor(pageWidth / safeAverageCharWidth)),
    linesPerPage: Math.max(safeMinLinesPerPage, adjustedLinesPerPage),
    paragraphGapLines: Math.max(0, toFiniteNumber(paragraphGapLines, 0)),
    minTrailingSliceHeight: Math.max(0, toFiniteNumber(minTrailingSliceLines, 0)),
  }
}

export function estimateWrappedLineCount(text, charsPerLine) {
  const safeCharsPerLine = Math.max(1, Math.floor(toFiniteNumber(charsPerLine, MIN_CHARS_PER_LINE)))
  const rawLines = String(text ?? '').split('\n')
  if (rawLines.length === 0) return 1

  return rawLines.reduce((total, line) => {
    const lineLength = Math.max(1, toTextLength(line))
    return total + Math.max(1, Math.ceil(lineLength / safeCharsPerLine))
  }, 0)
}

export function createTxtMeasuredPaginationOptions(metrics) {
  if (!metrics) return null

  const safeCharsPerLine = Math.max(1, Math.floor(toFiniteNumber(metrics.charsPerLine, MIN_CHARS_PER_LINE)))
  const safeLinesPerPage = Math.max(1, Math.floor(toFiniteNumber(metrics.linesPerPage, MIN_LINES_PER_PAGE)))
  const safeParagraphGapLines = Math.max(0, toFiniteNumber(metrics.paragraphGapLines, 0))
  const measureSliceHeight = (slice) => estimateWrappedLineCount(
    slice?.displayText ?? slice?.display_text ?? slice?.text ?? '',
    safeCharsPerLine,
  )
  const isContinuationSlice = (previous, next) => (
    previous
    && next
    && previous.segmentId === next.segmentId
    && Number.isFinite(previous.sliceEnd)
    && Number.isFinite(next.sliceStart)
    && previous.sliceEnd === next.sliceStart
  )

  return {
    pageHeight: safeLinesPerPage,
    minTrailingSliceHeight: Math.max(0, toFiniteNumber(metrics.minTrailingSliceHeight, 0)),
    measureSliceHeight,
    measurePageHeight: (pageSlices) => pageSlices.reduce((total, slice, index) => {
      const gap = index > 0 && !isContinuationSlice(pageSlices[index - 1], slice)
        ? safeParagraphGapLines
        : 0
      return total + gap + measureSliceHeight(slice)
    }, 0),
  }
}
