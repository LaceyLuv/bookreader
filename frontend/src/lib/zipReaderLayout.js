export function getZipImageLayout(zipImageScale) {
    const scale = Math.max(0.5, Math.min(2.5, Number(zipImageScale) || 1))
    return {
        scale,
        singleMaxWidth: `${90 * scale}%`,
        dualMaxWidth: `${48 * scale}%`,
        imageMaxHeight: `${100 * scale}%`,
    }
}
