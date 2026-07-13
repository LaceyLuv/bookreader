import { useEffect, useState } from 'react'

/**
 * A short, non-blocking reader notification with an optional undo action.
 */
export default function ResumeToast({
    message,
    actionLabel,
    onAction,
    durationMs = 5000,
}) {
    const [visible, setVisible] = useState(Boolean(message))

    useEffect(() => {
        setVisible(Boolean(message))
        if (!message || durationMs <= 0) return undefined
        const timer = window.setTimeout(() => setVisible(false), durationMs)
        return () => window.clearTimeout(timer)
    }, [durationMs, message])

    if (!message || !visible) return null

    const handleAction = () => {
        setVisible(false)
        onAction?.()
    }

    return (
        <div
            className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl border px-5 py-3 shadow-2xl
                animate-[fadeInUp_0.3s_ease-out]"
            style={{ backgroundColor: '#111827ee', borderColor: '#374151', color: '#f9fafb' }}
            role="status"
        >
            <div className="text-[13px] font-medium">{message}</div>
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={handleAction}
                    className="shrink-0 rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold hover:border-white/40"
                >
                    {actionLabel}
                </button>
            )}
        </div>
    )
}
