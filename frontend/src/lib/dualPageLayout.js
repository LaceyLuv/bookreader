export const MAX_SPLIT_MARGIN_PX = 120

export function getDualPageOuterInset(columnGap, maxColumnGap = MAX_SPLIT_MARGIN_PX) {
    const safeGap = Math.max(0, Number(columnGap) || 0)
    const safeMaxGap = Math.max(0, Number(maxColumnGap) || 0)
    return Math.max(0, (safeMaxGap - safeGap) / 2)
}
