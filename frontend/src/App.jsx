import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import Dashboard from './pages/Dashboard'
import FontStyleInjector from './components/FontStyleInjector'
import { setTitleBarOffset, getInitialAppTheme, setAppThemeVars } from './lib/appChrome'
import { IS_TAURI_RUNTIME } from './lib/apiBase'
import { useBackendStartup } from './hooks/useBackendStartup'
import { createT } from './i18n'

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

    useEffect(() => {
        setAppThemeVars(getInitialAppTheme())
        setTitleBarOffset(false)
    }, [])

    const backendBlocked = IS_TAURI_RUNTIME && !backendStartup.ready
    const backendMessage = backendStartup.checking
        ? 'Starting local backend...'
        : (backendStartup.message || 'Local backend failed to start.')

    return (
        <BrowserRouter>
            {!backendBlocked && <FontStyleInjector />}
            <div>
                {backendBlocked ? (
                    <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', padding: '24px', color: 'var(--app-fg)' }}>
                        <div style={{ maxWidth: '520px', textAlign: 'center' }}>
                            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
                                {backendStartup.checking ? tt('loading') : 'Backend unavailable'}
                            </div>
                            <div style={{ fontSize: '13px', lineHeight: 1.6, opacity: 0.7 }}>
                                {backendMessage}
                            </div>
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
    )
}

export default App
