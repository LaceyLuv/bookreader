import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// ─── Error Boundary ───

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null } }
    static getDerivedStateFromError(error) { return { hasError: true, error } }
    componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info) }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', color: '#f87171', fontFamily: 'monospace', background: '#1a1b1e', minHeight: '100vh' }}>
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⚠ Rendering Error</h1>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', opacity: 0.8 }}>{String(this.state.error)}</pre>
                    <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid #374151', background: 'transparent', color: '#d1d5db', cursor: 'pointer' }}>Reload</button>
                </div>
            )
        }
        return this.props.children
    }
}

// ─── Global Error Overlay ───

function GlobalErrorOverlay() {
    const [error, setError] = React.useState(null)
    React.useEffect(() => {
        const handler = (event) => setError(event.error || event.reason || 'Unknown error')
        window.addEventListener('error', handler)
        window.addEventListener('unhandledrejection', (e) => handler({ error: e.reason }))
        return () => {
            window.removeEventListener('error', handler)
            window.removeEventListener('unhandledrejection', handler)
        }
    }, [])
    if (!error) return null
    return (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, padding: '1rem', background: '#7f1d1dee', color: 'white', fontFamily: 'monospace', fontSize: '0.8rem' }}>
            <strong>Unhandled Error: </strong>{String(error)}
            <button onClick={() => setError(null)} style={{ marginLeft: '1rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid white', background: 'transparent', color: 'white', cursor: 'pointer' }}>✕</button>
        </div>
    )
}

// ─── Boot ───

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
            <GlobalErrorOverlay />
        </ErrorBoundary>
    </React.StrictMode>,
)
