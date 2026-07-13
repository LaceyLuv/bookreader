import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, lazy, Suspense, useState } from 'react'
import Dashboard from './pages/Dashboard'
import FontStyleInjector from './components/FontStyleInjector'
import { setTitleBarOffset, getInitialAppTheme, setAppThemeVars } from './lib/appChrome'
import { IS_TAURI_RUNTIME } from './lib/apiBase'
import { useBackendStartup } from './hooks/useBackendStartup'
import { createT } from './i18n'
import { restartBookReader } from './lib/backendStartup'
import { WindowDisplayProvider } from './hooks/useWindowDisplay'

const TxtReader = lazy(() => import('./components/TxtReader'))
const EpubReader = lazy(() => import('./components/EpubReader'))
const ZipReader = lazy(() => import('./components/ZipReader'))

function getSavedLang() {
    try {
        const raw = localStorage.getItem('bookreader_settings')
        return raw ? JSON.parse(raw).lang || 'en' : 'en'
    } catch {
        return 'en'
    }
}

function App() {
    const backendStartup = useBackendStartup()
    const tt = createT(getSavedLang())
    const [restartError, setRestartError] = useState('')

    useEffect(() => {
        setAppThemeVars(getInitialAppTheme())
        setTitleBarOffset(false)
    }, [])

    const backendBlocked = IS_TAURI_RUNTIME && !backendStartup.ready
    const backendMessage = backendStartup.checking
        ? tt('backendStarting')
        : (backendStartup.message || tt('backendUnavailable'))
    const backendProblem = backendStartup.problem

    const handleBackendRestart = async () => {
        setRestartError('')
        try {
            await restartBookReader()
        } catch (error) {
            setRestartError(error?.message || tt('backendRestartFailed'))
        }
    }

    return (
        <WindowDisplayProvider>
            <BrowserRouter>
                {!backendBlocked && <FontStyleInjector />}
                <div>
                    {backendBlocked ? (
                    <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', padding: '24px', color: 'var(--app-fg)' }}>
                        <div style={{ maxWidth: '520px', textAlign: 'center' }}>
                            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
                                {backendStartup.checking ? tt('loading') : tt(backendProblem?.titleKey || 'backendUnavailable')}
                            </div>
                            <div style={{ fontSize: '13px', lineHeight: 1.6, opacity: 0.7 }}>
                                {backendMessage}
                            </div>
                            {!backendStartup.checking && backendProblem && (
                                <>
                                    <div style={{ marginTop: '10px', fontSize: '12px', lineHeight: 1.6, opacity: 0.72 }}>
                                        {tt(backendProblem.recoveryKey)}
                                    </div>
                                    <button type="button" onClick={handleBackendRestart} style={{ marginTop: '16px', minHeight: '38px', padding: '0 16px', borderRadius: '10px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
                                        {tt('restartBookReader')}
                                    </button>
                                    <details style={{ marginTop: '14px', fontSize: '11px', opacity: 0.62 }}>
                                        <summary style={{ cursor: 'pointer' }}>{tt('technicalDetails')}</summary>
                                        <div style={{ marginTop: '6px', overflowWrap: 'anywhere' }}>{backendProblem.code}: {backendMessage}</div>
                                    </details>
                                    {restartError && <div role="alert" style={{ marginTop: '10px', color: '#e03131', fontSize: '12px' }}>{restartError}</div>}
                                </>
                            )}
                        </div>
                    </div>
                    ) : (
                    <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--app-fg)', opacity: 0.5 }}>{tt('loading')}</div>}>
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/read/txt/:id" element={<TxtReader />} />
                            <Route path="/read/epub/:id" element={<EpubReader />} />
                            <Route path="/read/zip/:id" element={<ZipReader />} />
                        </Routes>
                    </Suspense>
                    )}
                </div>
            </BrowserRouter>
        </WindowDisplayProvider>
    )
}

export default App
