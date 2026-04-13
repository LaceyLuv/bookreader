export function clampViewportPage(page, totalPages) {
  const max = Math.max(1, Number(totalPages) || 0) - 1
  return Math.max(0, Math.min(page, max))
}

export function getPagesPerView(layout) {
  return layout === 'dual' ? 2 : 1
}

export function buildViewportPageMap(items) {
  const pages = []
  let page = 0

  for (const item of items) {
    const pageCount = Math.max(1, Number(item.pageCount) || 1)
    for (let segmentPage = 0; segmentPage < pageCount; segmentPage += 1) {
      pages.push({
        page,
        segmentId: item.segmentId,
        segmentPage,
      })
      page += 1
    }
  }

  return {
    totalPages: pages.length,
    pages,
  }
}

export function findViewportPageForSegment(map, segmentId) {
  const pages = Array.isArray(map?.pages) ? map.pages : []
  const hit = pages.find((item) => item.segmentId === segmentId)
  return hit ? hit.page : 0
}
