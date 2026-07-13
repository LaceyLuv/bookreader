import { useEffect, useState } from 'react'

import { exportBookAnnotations } from '../lib/annotationExportClient'

export default function AnnotationExportControls({
    bookId,
    annotationCount = 0,
    loading = false,
    tt = (key) => key,
    compact = false,
}) {
    const [busyFormat, setBusyFormat] = useState(null)
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')
    const count = Math.max(0, Number(annotationCount) || 0)

    useEffect(() => {
        setBusyFormat(null)
        setStatus('')
        setError('')
    }, [bookId])

    const handleExport = async (format) => {
        if (busyFormat || loading || count === 0 || !bookId) return
        setBusyFormat(format)
        setStatus('')
        setError('')
        try {
            const filename = await exportBookAnnotations(bookId, format)
            setStatus(`${tt('annotationExportStarted')}: ${filename}`)
        } catch (exportError) {
            setError(exportError?.message || tt('annotationExportFailed'))
        } finally {
            setBusyFormat(null)
        }
    }

    const disabled = Boolean(busyFormat) || loading || count === 0 || !bookId
    const buttonClass = 'h-8 rounded-lg border border-current px-3 text-[11px] font-medium transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-40'

    return (
        <section className={compact ? 'mt-3' : 'mt-5 rounded-xl border border-current p-4'} aria-label={tt('exportAnnotations')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold">
                    {tt('exportAllAnnotations')} <span className="opacity-55">({count})</span>
                </div>
                <div role="group" aria-label={tt('annotationExportFormats')} className="flex items-center gap-2">
                    <button type="button" className={buttonClass} disabled={disabled} onClick={() => handleExport('markdown')}>
                        {busyFormat === 'markdown' ? tt('exportingAnnotations') : tt('exportMarkdown')}
                    </button>
                    <button type="button" className={buttonClass} disabled={disabled} onClick={() => handleExport('json')}>
                        {busyFormat === 'json' ? tt('exportingAnnotations') : tt('exportJson')}
                    </button>
                </div>
            </div>
            {count === 0 && !loading && <p className="mt-2 text-[11px] opacity-55">{tt('noAnnotationsToExport')}</p>}
            {count > 0 && <p className="mt-2 text-[10px] leading-4 opacity-50">{tt('annotationExportPrivacyWarning')}</p>}
            {status && <p role="status" className="mt-2 break-all text-[11px] text-[#2f9e44]">{status}</p>}
            {error && <p role="alert" className="mt-2 text-[11px] text-[#e03131]">{error}</p>}
        </section>
    )
}
