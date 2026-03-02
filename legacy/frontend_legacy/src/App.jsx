import { useEffect, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import TxtReader from './components/TxtReader'
import EpubReader from './components/EpubReader'
import ZipReader from './components/ZipReader'
import TitleBar from './components/TitleBar'
import {
    getInitialAppTheme,
    onTitleBarVisibilityChange,
    setAppThemeVars,
    setTitleBarOffset,
} from './lib/appChrome'

function App() {
    const location = useLocation()
    const isReaderRoute = location.pathname.startsWith('/read/')
    const [titleBarVisible, setTitleBarVisible] = useState(true)

    useEffect(() => {
        if (window.__BOOKREADER_APP_LOGGED__) {
            return
        }
        window.__BOOKREADER_APP_LOGGED__ = true
        console.log('App mounted', {
            href: window.location.href,
            path: location.pathname,
            search: location.search,
            hash: location.hash,
        })
    }, [location.pathname, location.search, location.hash])

    useEffect(() => {
        const theme = getInitialAppTheme()
        setAppThemeVars(theme.bg, theme.fg)
    }, [])

    useEffect(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.__BOOKREADER_MOUNTED__ = true
                window.__APP_RENDERED__ = true
            })
        })
    }, [])

    useEffect(() => onTitleBarVisibilityChange((visible) => setTitleBarVisible(visible)), [])

    useEffect(() => {
        if (!isReaderRoute) {
            setTitleBarVisible(true)
        }
    }, [isReaderRoute])

    useEffect(() => {
        setTitleBarOffset(titleBarVisible)
    }, [titleBarVisible])

    return (
        <div
            className="min-h-screen"
            style={{
                backgroundColor: 'var(--app-bg)',
                color: 'var(--app-fg)',
                paddingTop: 'var(--titlebar-height)',
            }}
        >
            <TitleBar visible={titleBarVisible} />
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/read/txt/:id" element={<TxtReader />} />
                <Route path="/read/epub/:id" element={<EpubReader />} />
                <Route path="/read/zip/:id" element={<ZipReader />} />
            </Routes>
        </div>
    )
}

export default App
