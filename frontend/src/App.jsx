import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import TxtReader from './components/TxtReader'
import EpubReader from './components/EpubReader'
import ZipReader from './components/ZipReader'
import TitleBar from './components/TitleBar'
import FontStyleInjector from './components/FontStyleInjector'
import { onTitleBarVisibilityChange, setTitleBarOffset, getInitialAppTheme, setAppThemeVars } from './lib/appChrome'
import { IS_TAURI_RUNTIME } from './lib/apiBase'

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
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/read/txt/:id" element={<TxtReader />} />
                    <Route path="/read/epub/:id" element={<EpubReader />} />
                    <Route path="/read/zip/:id" element={<ZipReader />} />
                </Routes>
            </div>
        </BrowserRouter>
    )
}

export default App
