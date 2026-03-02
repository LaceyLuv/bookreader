import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { getBookProgress } from '../hooks/useReadingProgress'
import { createT } from '../i18n'
import { API_BOOKS_BASE } from '../lib/apiBase'

const API = API_BOOKS_BASE
const BOOKS_PATH = '/api/books'
const BOOKS_FETCH_TIMEOUT_MS = 8000

function getLang() {
    try {
        const raw = localStorage.getItem('bookreader_settings')
        if (raw) return JSON.parse(raw).lang || 'en'
    } catch { /* ignore */ }
    return 'en'
}

function buildBooksRequestUrl() {
    if (typeof window === 'undefined') return API
    try {
        return new URL(API, window.location.origin).toString()
    } catch {
        return API
    }
}

function describeBooksFetchError(err) {
    if (err?.code === 'BOOKS_HTTP_ERROR') {
        return {
            title: 'API connection failed',
            reason: `HTTP ${err.status}${err.statusText ? ` ${err.statusText}` : ''}`,
            status: String(err.status),
        }
    }

    if (err?.name === 'AbortError') {
        return {
            title: 'API connection failed',
            reason: `Request timeout (${BOOKS_FETCH_TIMEOUT_MS / 1000}s)`,
            status: 'timeout',
        }
    }

    return {
        title: 'API connection failed',
        reason: `Network error: ${String(err?.message || err || 'unknown error')}`,
        status: 'network',
    }
}

function Dashboard() {
    const [books, setBooks] = useState([])
    const [booksLoading, setBooksLoading] = useState(true)
    const [booksError, setBooksError] = useState(null)
    const [uploading, setUploading] = useState(false)
    const [dragActive, setDragActive] = useState(false)
    const fileInputRef = useRef(null)
    const booksFetchAbortRef = useRef(null)
    const navigate = useNavigate()
    const tt = createT(getLang())

    useEffect(() => {
        if (window.__BOOKREADER_DASHBOARD_LOGGED__) {
            return
        }
        window.__BOOKREADER_DASHBOARD_LOGGED__ = true
        console.log('Dashboard mounted')
    }, [])

    useEffect(() => {
        fetchBooks()
        return () => booksFetchAbortRef.current?.abort('unmount')
    }, [])

    const fetchBooks = async () => {
        booksFetchAbortRef.current?.abort('replaced')
        const controller = new AbortController()
        booksFetchAbortRef.current = controller
        const timeoutId = setTimeout(() => controller.abort('timeout'), BOOKS_FETCH_TIMEOUT_MS)
        const requestUrl = buildBooksRequestUrl()

        setBooksLoading(true)
        setBooksError(null)

        try {
            const res = await fetch(requestUrl, {
                method: 'GET',
                signal: controller.signal,
            })

            if (!res.ok) {
                const httpError = new Error(`HTTP ${res.status}`)
                httpError.code = 'BOOKS_HTTP_ERROR'
                httpError.status = res.status
                httpError.statusText = res.statusText
                throw httpError
            }

            const data = await res.json()
            const nextBooks = Array.isArray(data?.books) ? data.books : []
            setBooks(nextBooks)
            console.log(`books fetch ok: ${nextBooks.length}`)
        } catch (err) {
            if (err?.name === 'AbortError' && controller.signal?.reason !== 'timeout') {
                return
            }

            setBooks([])
            const details = describeBooksFetchError(err)
            setBooksError({
                title: details.title,
                reason: details.reason,
                status: details.status,
                relativeUrl: BOOKS_PATH,
                requestUrl,
                origin: typeof window !== 'undefined' ? window.location.origin : '',
            })
            console.error(`books fetch failed: ${details.reason}`)
        } finally {
            clearTimeout(timeoutId)
            if (booksFetchAbortRef.current === controller) {
                setBooksLoading(false)
            }
        }
    }

    const uploadFile = async (file) => {
        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            await axios.post(API, formData)
            await fetchBooks()
        } catch (err) {
            alert('Upload failed: ' + (err.response?.data?.detail || err.message))
        }
        setUploading(false)
    }

    const deleteBook = async (id, e) => {
        e.stopPropagation()
        if (!confirm(tt('deleteConfirm'))) return
        try {
            await axios.delete(`${API}/${id}`)
            await fetchBooks()
        } catch (err) {
            console.error('Delete failed', err)
        }
    }

    const openBook = (book) => {
        navigate(`/read/${book.file_type}/${book.id}`)
    }

    const handleDrop = (e) => {
        e.preventDefault()
        setDragActive(false)
        if (e.dataTransfer.files?.[0]) uploadFile(e.dataTransfer.files[0])
    }

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / 1048576).toFixed(1) + ' MB'
    }

    const typeIcon = (type) => {
        if (type === 'txt') return '📄'
        if (type === 'epub') return '📖'
        if (type === 'zip') return '🖼️'
        return '📁'
    }

    return (
        <div className="min-h-screen p-6 md:p-10">
            {/* Header */}
            <div className="max-w-6xl mx-auto mb-10">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-2xl shadow-lg shadow-brand-500/30">
                        📚
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-surface-400 bg-clip-text text-transparent">
                            {tt('appTitle')}
                        </h1>
                        <p className="text-surface-500 text-sm">{tt('appSubtitle')}</p>
                    </div>
                </div>
            </div>

            {/* Upload Zone */}
            <div className="max-w-6xl mx-auto mb-10">
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`glass-card p-10 text-center cursor-pointer transition-all duration-300 ${dragActive
                        ? 'border-brand-500 bg-brand-500/10 scale-[1.01]'
                        : 'hover:border-surface-500 hover:bg-surface-700/40'
                        }`}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.epub,.zip"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                    />
                    <div className="text-5xl mb-4">{uploading ? '⏳' : '📂'}</div>
                    <p className="text-lg font-medium text-surface-300">
                        {uploading ? tt('uploading') : tt('uploadPrompt')}
                    </p>
                    <p className="text-surface-500 text-sm mt-2">{tt('supportedFiles')}</p>
                </div>
            </div>

            {/* Library Grid */}
            <div className="max-w-6xl mx-auto">
                <h2 className="text-xl font-semibold text-surface-300 mb-5 flex items-center gap-2">
                    <span>{tt('library')}</span>
                    <span className="badge bg-surface-700 text-surface-400 border-surface-600">{books.length}</span>
                </h2>

                {booksError ? (
                    <div className="glass-card p-5 mb-5 border-red-500/40 bg-red-900/10">
                        <p className="text-red-300 font-semibold mb-1">{booksError.title}</p>
                        <p className="text-red-200 text-sm mb-2">{booksError.reason}</p>
                        <p className="text-red-100 text-xs font-mono">status: {booksError.status}</p>
                        <p className="text-red-100 text-xs font-mono">request(relative): {booksError.relativeUrl}</p>
                        <p className="text-red-100 text-xs font-mono break-all">request(absolute): {booksError.requestUrl}</p>
                        <p className="text-red-100 text-xs font-mono break-all">location.origin: {booksError.origin}</p>
                        <button
                            type="button"
                            onClick={fetchBooks}
                            className="mt-3 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-100 text-sm border border-red-500/40 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                {booksLoading ? (
                    <div className="glass-card p-16 text-center">
                        <p className="text-surface-500 text-lg">Loading library...</p>
                    </div>
                ) : books.length === 0 ? (
                    <div className="glass-card p-16 text-center">
                        <p className="text-5xl mb-4">📭</p>
                        <p className="text-surface-500 text-lg">{tt('emptyLibrary')}</p>
                        <p className="text-surface-600 text-sm mt-1">{tt('emptyLibrarySub')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                        {books.map((book) => {
                            const prog = getBookProgress(book.id)
                            return (
                                <div
                                    key={book.id}
                                    onClick={() => openBook(book)}
                                    className="glass-card p-5 cursor-pointer group hover:border-brand-500/40 hover:bg-surface-700/40
                           transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-brand-500/10"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <span className="text-4xl transform group-hover:scale-110 transition-transform duration-300">
                                            {typeIcon(book.file_type)}
                                        </span>
                                        <button
                                            onClick={(e) => deleteBook(book.id, e)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200
                               p-2 hover:bg-red-500/20 rounded-lg text-red-400 hover:text-red-300"
                                            title="Delete"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                    <h3 className="font-semibold text-white truncate mb-2 group-hover:text-brand-300 transition-colors">
                                        {book.title}
                                    </h3>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`badge badge-${book.file_type}`}>{book.file_type}</span>
                                        <span className="text-xs text-surface-500">{formatSize(book.size)}</span>
                                    </div>

                                    {/* Reading Progress */}
                                    {prog && (
                                        <div className="mt-3 pt-3 border-t border-surface-700/50">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-[10px] uppercase tracking-widest text-surface-500 font-semibold">
                                                    {tt('progress')}
                                                </span>
                                                <span className="text-xs text-brand-400 font-semibold tabular-nums">
                                                    {prog.percent}%
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 rounded-full bg-surface-700 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-500"
                                                    style={{ width: `${prog.percent}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export default Dashboard
