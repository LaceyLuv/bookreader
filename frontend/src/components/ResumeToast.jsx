/**
 * ResumeToast — localized prompt for resuming reading.
 */
export default function ResumeToast({ resumePrompt, onResume, onDismiss, tt, message }) {
    if (message) {
        return (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl border
                animate-[fadeInUp_0.3s_ease-out]"
                style={{ backgroundColor: '#111827ee', borderColor: '#374151', color: '#f9fafb' }}>
                <div className="text-[13px] font-medium">{message}</div>
            </div>
        )
    }

    if (!resumePrompt) return null

    const t = tt || ((k) => {
        const map = {
            resumeReading: 'Resume reading?', youWereAt: 'You were at',
            resume: 'Resume', startOver: 'Start Over', page: 'Page', chapter: 'Ch'
        }
        return map[k] || k
    })

    const label = resumePrompt.type === 'epub'
        ? `${t('chapter')} ${resumePrompt.position + 1}`
        : `${t('page')} ${resumePrompt.position + 1}`

    return (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-gray-900/95 text-white px-6 py-4 rounded-2xl shadow-2xl border border-white/10
                backdrop-blur-xl animate-[fadeInUp_0.4s_ease-out]">
                <p className="text-sm font-semibold mb-1">{t('resumeReading')}</p>
                <p className="text-xs opacity-60 mb-3">{t('youWereAt')} {label}</p>
                <div className="flex gap-2">
                    <button onClick={onResume}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[#5c7cfa] hover:bg-[#4c6ef5] transition-colors">
                        {t('resume')}
                    </button>
                    <button onClick={onDismiss}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold border border-white/20 hover:border-white/40 transition-colors">
                        {t('startOver')}
                    </button>
                </div>
            </div>
        </div>
    )
}
