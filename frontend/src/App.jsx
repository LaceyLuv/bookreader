import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import Dashboard from './pages/Dashboard'
import TitleBar from './components/TitleBar'
import FontStyleInjector from './components/FontStyleInjector'
import { onTitleBarVisibilityChange, setTitleBarOffset, getInitialAppTheme, setAppThemeVars } from './lib/appChrome'
import { IS_TAURI_RUNTIME } from './lib/apiBase'

const TxtReader = lazy(() => import('./components/TxtReader'))
const EpubReader = lazy(() => import('./components/EpubReader'))
const ZipReader = lazy(() => import('./components/ZipReader'))

function App() {
    const [showTitleBar, setShowTitleBar] = useState(IS_TAURI_RUNTIME)

    useEffect(() => {
        setAppThemeVars(getInitialAppTheme())
    }, [])

    useEffect(() => {
        setTitleBarOffset(showTitleBar)
    }, [showTitleBar])

    useEffect(() => {
        return onTitleBarVisibilityChange((visible) => setShowTitleBar(visible))
    }, [])

    return (
        <BrowserRouter>
            <FontStyleInjector />
            {showTitleBar && <TitleBar visible={showTitleBar} />}
            <div style={{ paddingTop: showTitleBar ? 'var(--titlebar-height, 0px)' : '0px' }}>
                <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--app-fg)', opacity: 0.5 }}>Loading…</div>}>
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/read/txt/:id" element={<TxtReader />} />
                        <Route path="/read/epub/:id" element={<EpubReader />} />
                        <Route path="/read/zip/:id" element={<ZipReader />} />
                    </Routes>
                </Suspense>
            </div>
        </BrowserRouter>
    )
}

export default App
