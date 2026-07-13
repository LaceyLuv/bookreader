import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { readErrorDetail } from '../lib/readErrorDetail'

const AUTO_ENCODING = 'auto'
const ALLOWED_ENCODINGS = new Set([
    'utf-8',
    'utf-8-sig',
    'utf-16',
    'utf-16-le',
    'utf-16-be',
    'cp949',
    'euc-kr',
    'latin-1',
])

function normalizeEncoding(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return ALLOWED_ENCODINGS.has(normalized) ? normalized : null
}

function normalizePreviewData(value) {
    const candidates = Array.isArray(value?.encoding_candidates)
        ? value.encoding_candidates
            .map((candidate) => ({
                encoding: normalizeEncoding(candidate?.encoding),
                label: typeof candidate?.label === 'string' && candidate.label.trim()
                    ? candidate.label.trim()
                    : candidate?.encoding,
                valid: candidate?.valid !== false,
                preview: typeof candidate?.preview === 'string' ? candidate.preview : '',
                confidence: Number.isFinite(candidate?.confidence) ? candidate.confidence : null,
            }))
            .filter((candidate) => candidate.encoding)
        : []
    return {
        detected_encoding: normalizeEncoding(value?.detected_encoding) || value?.detected_encoding || null,
        encoding_confidence: Number.isFinite(value?.encoding_confidence) ? value.encoding_confidence : null,
        encoding_override: normalizeEncoding(value?.encoding_override),
        encoding_source: value?.encoding_source === 'override' ? 'override' : 'auto',
        encoding_candidates: candidates,
    }
}

function confidenceLabel(value, tt) {
    if (!Number.isFinite(value)) return tt('encodingConfidenceUnknown')
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export default function TxtEncodingDialog({ open, bookId, initialData = null, onClose, onApplied, tt }) {
    const [previewData, setPreviewData] = useState(() => normalizePreviewData(initialData))
    const [draft, setDraft] = useState(AUTO_ENCODING)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const dialogRef = useRef(null)
    const previousFocusRef = useRef(null)

    useEffect(() => {
        if (!open) return undefined
        previousFocusRef.current = document.activeElement
        const initial = normalizePreviewData(initialData)
        setPreviewData(initial)
        setDraft(initial.encoding_override || AUTO_ENCODING)
        setError('')
        setSaving(false)
        setLoading(true)
        const controller = new AbortController()

        ;(async () => {
            try {
                const response = await fetch(
                    `${API_BOOKS_BASE}/${encodeURIComponent(bookId)}/txt-encoding-preview`,
                    { signal: controller.signal },
                )
                if (!response.ok) throw new Error(await readErrorDetail(response, tt('encodingPreviewFailed')))
                const data = normalizePreviewData(await response.json())
                setPreviewData(data)
                setDraft(data.encoding_override || AUTO_ENCODING)
            } catch (reason) {
                if (reason?.name !== 'AbortError') {
                    setError(reason?.message || tt('encodingPreviewFailed'))
                }
            } finally {
                if (!controller.signal.aborted) setLoading(false)
            }
        })()

        requestAnimationFrame(() => dialogRef.current?.focus())
        return () => {
            controller.abort()
            previousFocusRef.current?.focus?.()
        }
    }, [bookId, open])

    const selectedCandidate = useMemo(
        () => previewData.encoding_candidates.find((candidate) => candidate.encoding === draft) || null,
        [draft, previewData.encoding_candidates],
    )
    const unchanged = draft === (previewData.encoding_override || AUTO_ENCODING)

    if (!open) return null

    const handleKeyDown = (event) => {
        if (event.key === 'Escape' && !saving) {
            event.stopPropagation()
            onClose()
            return
        }
        if (event.key !== 'Tab') return
        const focusable = [...(dialogRef.current?.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [])]
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
        }
    }

    const applyEncoding = async () => {
        const nextOverride = draft === AUTO_ENCODING ? null : normalizeEncoding(draft)
        if (draft !== AUTO_ENCODING && !nextOverride) return
        setSaving(true)
        setError('')
        try {
            const response = await fetch(`${API_BOOKS_BASE}/${encodeURIComponent(bookId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txt_encoding_override: nextOverride }),
            })
            if (!response.ok) throw new Error(await readErrorDetail(response, tt('encodingApplyFailed')))
            const book = await response.json()
            await onApplied?.({ book, encodingOverride: nextOverride })
            onClose()
        } catch (reason) {
            setError(reason?.message || tt('encodingApplyFailed'))
            setSaving(false)
        }
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[#211c16]/55 p-4"
            onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
        >
            <section
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="txt-encoding-title"
                onKeyDown={handleKeyDown}
                className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#d8cdbd] bg-[#faf7f1] text-[#3f392f] shadow-2xl outline-none"
            >
                <header className="flex items-start justify-between border-b border-[#e5dccd] px-5 py-4">
                    <div>
                        <h2 id="txt-encoding-title" className="text-lg font-semibold">{tt('changeEncoding')}</h2>
                        <p className="mt-1 text-[11px] text-[#766854]">{tt('encodingPreviewHint')}</p>
                    </div>
                    <button
                        type="button"
                        aria-label={tt('closeEncodingDialog')}
                        disabled={saving}
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#ded4c5] text-xl disabled:opacity-40"
                    >
                        ×
                    </button>
                </header>

                <div className="overflow-y-auto px-5 py-4">
                    <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-[#766854]">
                        <span className="rounded-full bg-[#eee6da] px-2.5 py-1">
                            {tt('detectedEncoding')}: {previewData.detected_encoding || tt('unknown')}
                        </span>
                        <span className="rounded-full bg-[#eee6da] px-2.5 py-1">
                            {tt('encodingConfidence')}: {confidenceLabel(previewData.encoding_confidence, tt)}
                        </span>
                    </div>

                    <fieldset disabled={loading || saving} className="space-y-2">
                        <legend className="sr-only">{tt('changeEncoding')}</legend>
                        <label className={`block cursor-pointer rounded-xl border p-3 ${draft === AUTO_ENCODING ? 'border-[#b7864b] bg-[#f5eadc]' : 'border-[#ded4c5] bg-white/70'}`}>
                            <span className="flex items-center gap-2 text-[12px] font-semibold">
                                <input
                                    type="radio"
                                    name="txt-encoding"
                                    value={AUTO_ENCODING}
                                    checked={draft === AUTO_ENCODING}
                                    onChange={() => setDraft(AUTO_ENCODING)}
                                    className="accent-[#b7864b]"
                                />
                                {tt('automaticEncoding')}
                            </span>
                            <span className="mt-1 block pl-6 text-[10px] text-[#766854]">{tt('automaticEncodingHint')}</span>
                        </label>

                        {previewData.encoding_candidates.map((candidate) => (
                            <label
                                key={candidate.encoding}
                                className={`block rounded-xl border p-3 ${candidate.valid ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'} ${draft === candidate.encoding ? 'border-[#b7864b] bg-[#f5eadc]' : 'border-[#ded4c5] bg-white/70'}`}
                            >
                                <span className="flex items-center justify-between gap-3">
                                    <span className="flex items-center gap-2 text-[12px] font-semibold">
                                        <input
                                            type="radio"
                                            name="txt-encoding"
                                            value={candidate.encoding}
                                            checked={draft === candidate.encoding}
                                            disabled={!candidate.valid}
                                            onChange={() => setDraft(candidate.encoding)}
                                            className="accent-[#b7864b]"
                                        />
                                        {candidate.label || candidate.encoding}
                                    </span>
                                    {!candidate.valid && <span className="text-[10px] text-red-600">{tt('invalidEncodingPreview')}</span>}
                                </span>
                                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#f4eee5] px-3 py-2 font-sans text-[11px] leading-relaxed text-[#51483d]">
                                    {candidate.preview || tt('noEncodingPreview')}
                                </pre>
                            </label>
                        ))}
                    </fieldset>

                    {loading && <p role="status" className="mt-3 text-[11px] text-[#766854]">{tt('loadingEncodingPreview')}</p>}
                    {selectedCandidate && !selectedCandidate.valid && <p className="mt-3 text-[11px] text-red-600">{tt('invalidEncodingPreview')}</p>}
                    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p>}
                </div>

                <footer className="flex justify-end gap-2 border-t border-[#e5dccd] bg-[#faf7f1] px-5 py-4">
                    <button type="button" disabled={saving} onClick={onClose} className="rounded-xl px-4 py-2.5 text-[11px] font-semibold text-[#766854] disabled:opacity-40">
                        {tt('cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={loading || saving || unchanged || (draft !== AUTO_ENCODING && selectedCandidate?.valid !== true)}
                        onClick={applyEncoding}
                        className="rounded-xl bg-[#b7864b] px-4 py-2.5 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {saving ? tt('applyingEncoding') : tt('applyEncoding')}
                    </button>
                </footer>
            </section>
        </div>
    )
}
