import { useEffect, useState } from 'react'

const NARROW_READER_QUERY = '(max-width: 760px)'

export function useResponsiveReaderLayout(preferredLayout) {
    const [isNarrow, setIsNarrow] = useState(() => (
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(NARROW_READER_QUERY).matches
    ))

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined
        const query = window.matchMedia(NARROW_READER_QUERY)
        const update = () => setIsNarrow(query.matches)
        update()
        query.addEventListener?.('change', update)
        return () => query.removeEventListener?.('change', update)
    }, [])

    return isNarrow ? 'single' : preferredLayout
}
