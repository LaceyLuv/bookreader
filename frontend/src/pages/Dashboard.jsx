import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BOOKS_BASE } from '../lib/apiBase'
import { getBookProgress } from '../hooks/useReadingProgress'
import { createT } from '../i18n'

const API = API_BOOKS_BASE

function Dashboard() {
    const navigate = useNavigate()
    const [books, setBooks] = useState([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef(null)

    const savedLang = (() => {
        try {
            const s = localStorage.getItem('bookreader_settings')
            return s ? JSON.parse(s).lang || 'en' : 'en'
        } catch {
            return 'en'
        }
    })()
    const tt = createT(savedLang)

    const fetchBooks = useCallback(async () => {
        try {
            const res = await fetch(API)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const list = Array.isArray(data) ? data : (Array.isArray(data?.books) ? data.books : [])
            setBooks(list)
        } catch (err) {
            console.error('Failed to fetch books', err)
        }
        setLoading(false)
    }, [])

    useEffect(() => {
        fetchBooks()
    }, [fetchBooks])

    const handleUpload = async (file) => {
        if (!file) return
        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch(API, { method: 'POST', body: formData })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            await fetchBooks()
        } catch (err) {
            console.error('Upload failed', err)
            alert('Upload failed: ' + err.message)
        }
        setUploading(false)
    }

    const handleDelete = async (bookId) => {
        if (!window.confirm(tt('deleteConfirm'))) return
        try {
            const res = await fetch(`${API}/${bookId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            setBooks(prev => prev.filter(b => b.id !== bookId))
        } catch (err) {
            console.error('Delete failed', err)
        }
    }

    const openBook = (book) => navigate(`/read/${book.file_type}/${book.id}`)

    const handleDrop = (e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0])
    }
    const handleDragOver = (e) => {
        e.preventDefault()
        setDragOver(true)
    }
    const handleDragLeave = () => setDragOver(false)

    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const typeBadgeClass = (type) => {
        if (type === 'txt') return 'badge badge-txt'
        if (type === 'epub') return 'badge badge-epub'
        return 'badge badge-zip'
    }

    const mutedTextColor = 'color-mix(in srgb, var(--app-fg) 72%, var(--app-bg) 28%)'
    const subtleTextColor = 'color-mix(in srgb, var(--app-fg) 58%, var(--app-bg) 42%)'

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)' }}>
            <div className="mx-auto max-w-4xl px-6 py-12">
                <div className="mb-10 text-center">
                    <h1 className="mb-2 text-3xl font-bold tracking-tight">{tt('appTitle')}</h1>
                    <p className="text-sm" style={{ color: mutedTextColor }}>{tt('appSubtitle')}</p>
                </div>

                <div
                    className={`glass-card mb-8 flex cursor-pointer flex-col items-center justify-center px-6 py-10 transition-all ${dragOver ? 'scale-[1.01] ring-2 ring-[#5c7cfa]' : 'hover:shadow-sm'}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.epub,.zip"
                        className="hidden"
                        onChange={e => {
                            if (e.target.files[0]) handleUpload(e.target.files[0])
                            e.target.value = ''
                        }}
                    />
                    {uploading ? (
                        <div className="flex items-center gap-3">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" />
                            <span className="text-sm" style={{ color: mutedTextColor }}>{tt('uploading')}</span>
                        </div>
                    ) : (
                        <>
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-30"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                            <p className="mb-1 text-sm" style={{ color: mutedTextColor }}>{tt('uploadPrompt')}</p>
                            <p className="text-[11px]" style={{ color: subtleTextColor }}>{tt('supportedFiles')}</p>
                        </>
                    )}
                </div>

                <div>
                    <h2 className="mb-4 text-[11px] font-bold uppercase tracking-widest" style={{ color: mutedTextColor }}>{tt('library')}</h2>
                    {loading ? (
                        <div className="flex justify-center py-16">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                        </div>
                    ) : books.length === 0 ? (
                        <div className="py-16 text-center" style={{ color: mutedTextColor }}>
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-4 opacity-30"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                            <p className="mb-1 font-medium">{tt('emptyLibrary')}</p>
                            <p className="text-sm" style={{ color: subtleTextColor }}>{tt('emptyLibrarySub')}</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {books.map(book => {
                                const prog = getBookProgress(book.id)
                                return (
                                    <div key={book.id} className="glass-card group flex cursor-pointer items-center gap-4 px-5 py-4 hover:shadow-sm" onClick={() => openBook(book)}>
                                        <div className="min-w-0 flex-1">
                                            <div className="mb-1 flex items-center gap-2">
                                                <span className={typeBadgeClass(book.file_type)}>{book.file_type.toUpperCase()}</span>
                                                <h3 className="truncate text-sm font-semibold">{book.title}</h3>
                                            </div>
                                            <div className="flex items-center gap-3 text-[11px]" style={{ color: subtleTextColor }}>
                                                <span>{formatSize(book.size)}</span>
                                                {prog && <span className="text-[#5c7cfa]">{prog.percent}%</span>}
                                            </div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); handleDelete(book.id) }} className="flex h-8 w-8 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-75 hover:!opacity-100" title="Delete">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default Dashboard
