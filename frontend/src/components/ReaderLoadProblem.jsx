import { useEffect, useRef } from 'react'

function ReaderLoadProblem({
    problem,
    title,
    themeStyle,
    tt,
    onRetry,
    onBack,
    retrying = false,
    forceRetry = false,
}) {
    const alertRef = useRef(null)

    useEffect(() => {
        alertRef.current?.focus()
    }, [problem])

    if (!problem) return null

    const canRetry = Boolean(onRetry) && (forceRetry || problem.retryable !== false)
    const recoveryHint = problem.recovery === 'choose_another_file'
        ? tt('chooseAnotherFileHint')
        : problem.recovery === 'reexport_file'
            ? tt('reexportFileHint')
            : null

    return (
        <section
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            data-testid="reader-load-problem"
            className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border px-6 py-5 text-center outline-none"
            style={{
                borderColor: themeStyle?.border,
                color: themeStyle?.text,
                backgroundColor: themeStyle?.card,
            }}
        >
            <h2 className="text-base font-semibold">{title || tt('bookLoadFailed')}</h2>
            <p className="text-sm opacity-75">{problem.message || tt('bookLoadFailed')}</p>
            {recoveryHint && <p className="text-xs opacity-60">{recoveryHint}</p>}
            {problem.code && problem.code !== 'request_failed' && (
                <details className="text-xs opacity-60">
                    <summary className="cursor-pointer">{tt('technicalDetails')}</summary>
                    <code className="mt-1 block break-all">{problem.code}</code>
                </details>
            )}
            <div className="mt-1 flex flex-wrap justify-center gap-2">
                {canRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        disabled={retrying}
                        className="rounded-lg border px-3 py-1.5 text-sm disabled:cursor-wait disabled:opacity-50"
                        style={{ borderColor: themeStyle?.border }}
                    >
                        {retrying ? tt('retrying') : tt('retry')}
                    </button>
                )}
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded-lg border px-3 py-1.5 text-sm"
                        style={{ borderColor: themeStyle?.border }}
                    >
                        {tt('backToLibrary')}
                    </button>
                )}
            </div>
        </section>
    )
}

export default ReaderLoadProblem
