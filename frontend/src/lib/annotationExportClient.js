import { API_BOOKS_BASE } from './apiBase'
import { downloadResponseBlob } from './downloadResponseBlob'
import { readErrorDetail } from './readErrorDetail'

const EXPORT_FORMATS = {
    markdown: { extension: 'md' },
    json: { extension: 'json' },
}

export async function exportBookAnnotations(bookId, format) {
    const formatInfo = EXPORT_FORMATS[format]
    if (!formatInfo) throw new Error('Unsupported annotation export format')
    if (!bookId) throw new Error('Book ID is required')

    const response = await fetch(
        `${API_BOOKS_BASE}/${encodeURIComponent(bookId)}/annotations/export?format=${encodeURIComponent(format)}`,
    )
    if (!response.ok) {
        throw new Error(await readErrorDetail(response, 'Annotation export failed'))
    }
    return downloadResponseBlob(response, `Gyeol-annotations.${formatInfo.extension}`)
}
