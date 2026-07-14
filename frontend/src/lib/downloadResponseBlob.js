function safeDownloadName(value, fallback) {
    const name = String(value || '').replace(/[\u0000-\u001f/\\:*?"<>|]+/g, '-').trim()
    return name || fallback
}

export function responseFilename(response, fallback = 'download') {
    const disposition = response?.headers?.get?.('content-disposition') || ''
    const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    const plain = disposition.match(/filename="?([^";]+)"?/i)
    try {
        return safeDownloadName(decodeURIComponent(utf8?.[1] || plain?.[1] || fallback), fallback)
    } catch {
        return safeDownloadName(fallback, 'download')
    }
}

export async function downloadResponseBlob(response, fallbackFilename) {
    const blob = await response.blob()
    const filename = responseFilename(response, fallbackFilename)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    try {
        anchor.href = url
        anchor.download = filename
        anchor.style.display = 'none'
        document.body.appendChild(anchor)
        anchor.click()
    } finally {
        anchor.remove()
        URL.revokeObjectURL(url)
    }
    return filename
}
