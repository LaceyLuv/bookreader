import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { API_BOOKS_BASE } from './lib/apiBase'
import './index.css'

if (!window.__BOOKREADER_MAIN_LOGGED__) {
    window.__BOOKREADER_MAIN_LOGGED__ = true
    console.log('[main] bootstrap', {
        href: window.location.href,
        path: window.location.pathname,
    })
}

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { error: null, info: null }
    }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error, info) {
        this.setState({ info })
        console.error('[react-error-boundary]', error, info)
    }

    render() {
        if (this.state.error) {
            return (
                <div style={{
                    minHeight: '100vh',
                    background: '#1b1b1b',
                    color: '#ffd7d7',
                    padding: 16,
                    fontFamily: 'Consolas, monospace',
                }}
                >
                    <h1 style={{ margin: '0 0 12px', color: '#ff6b6b' }}>React Render Error</h1>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>
                        {String(this.state.error?.stack || this.state.error)}
                    </pre>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                        {String(this.state.info?.componentStack || '')}
                    </pre>
                </div>
            )
        }
        return this.props.children
    }
}

function GlobalErrorOverlay() {
    const [items, setItems] = React.useState([])
    React.useEffect(() => {
        const onError = (event) => {
            setItems((prev) => [{
                kind: 'error',
                message: event.message || String(event.error || 'Unknown error'),
                file: event.filename || '(unknown file)',
                line: event.lineno ?? '-',
                col: event.colno ?? '-',
            }, ...prev].slice(0, 4))
        }
        const onUnhandled = (event) => {
            const reason = event.reason
            setItems((prev) => [{
                kind: 'unhandledrejection',
                message: String(reason?.stack || reason?.message || reason || 'Unhandled promise rejection'),
                file: '(promise)',
                line: '-',
                col: '-',
            }, ...prev].slice(0, 4))
        }
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onUnhandled)
        return () => {
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onUnhandled)
        }
    }, [])

    if (items.length === 0) {
        return null
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 2147483647,
            background: 'rgba(170, 0, 0, 0.95)',
            color: '#fff',
            fontFamily: 'Consolas, monospace',
            fontSize: 12,
            padding: '8px 10px',
            borderBottom: '1px solid #ff8a8a',
        }}
        >
            {items.map((item, index) => (
                <div key={`${item.kind}-${index}`} style={{ marginBottom: index === items.length - 1 ? 0 : 6 }}>
                    <strong>{item.kind}</strong>: {item.message} ({item.file}:{item.line}:{item.col})
                </div>
            ))}
            <div style={{ marginTop: 4, opacity: 0.9 }}>
                Debug tip: press Ctrl+Shift+I to open DevTools.
            </div>
        </div>
    )
}

function BootStatus({ children }) {
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState('')

    React.useEffect(() => {
        let cancelled = false
        const timeoutId = setTimeout(() => {
            if (!cancelled) {
                setError('Initialization timeout: backend API not reachable yet.')
                setLoading(false)
            }
        }, 2500)

        ;(async () => {
            try {
                await fetch(API_BOOKS_BASE, { method: 'GET' })
            } catch (e) {
                if (!cancelled) {
                    setError(`Initialization API check failed: ${String(e?.message || e)}`)
                }
            } finally {
                clearTimeout(timeoutId)
                if (!cancelled) {
                    setLoading(false)
                }
            }
        })()

        return () => {
            cancelled = true
            clearTimeout(timeoutId)
        }
    }, [])

    if (loading) {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'grid',
                placeItems: 'center',
                background: '#111',
                color: '#e5e5e5',
                fontFamily: 'system-ui, sans-serif',
            }}
            >
                Initializing BookReader...
            </div>
        )
    }

    return (
        <>
            {error ? (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 2147483646,
                    background: '#602020',
                    color: '#ffdcdc',
                    padding: '8px 10px',
                    fontSize: 12,
                    fontFamily: 'Consolas, monospace',
                }}
                >
                    {error} (app continues)
                </div>
            ) : null}
            {children}
        </>
    )
}

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <GlobalErrorOverlay />
            <BootStatus>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </BootStatus>
        </ErrorBoundary>
    </React.StrictMode>,
)
