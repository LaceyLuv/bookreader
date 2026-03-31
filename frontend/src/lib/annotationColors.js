const HIGHLIGHT_COLORS = [
    'rgba(255, 212, 59, 0.42)',
    'rgba(255, 146, 43, 0.34)',
    'rgba(148, 216, 45, 0.30)',
    'rgba(244, 162, 97, 0.34)',
]

const NOTE_COLORS = [
    'rgba(76, 201, 240, 0.24)',
    'rgba(116, 192, 252, 0.24)',
    'rgba(151, 117, 250, 0.22)',
    'rgba(99, 230, 190, 0.24)',
]

function normalizeColor(value) {
    return String(value || '').trim().toLowerCase()
}

export function getDefaultAnnotationColor(kind) {
    return kind === 'note' ? NOTE_COLORS[0] : HIGHLIGHT_COLORS[0]
}

export function getNextAnnotationColor(kind, currentColor) {
    const palette = kind === 'note' ? NOTE_COLORS : HIGHLIGHT_COLORS
    const current = normalizeColor(currentColor) || normalizeColor(getDefaultAnnotationColor(kind))
    const index = palette.findIndex((item) => normalizeColor(item) === current)
    if (index < 0) return palette[0]
    return palette[(index + 1) % palette.length]
}
