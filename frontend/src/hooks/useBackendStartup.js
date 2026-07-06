import { useEffect, useState } from 'react'

import { IS_TAURI_RUNTIME } from '../lib/apiBase'
import { checkBackendStartup } from '../lib/backendStartup'

export function useBackendStartup() {
    const [state, setState] = useState(() => ({
        checking: IS_TAURI_RUNTIME,
        ready: !IS_TAURI_RUNTIME,
        message: null,
        status: null,
    }))

    useEffect(() => {
        if (!IS_TAURI_RUNTIME) return undefined

        let cancelled = false
        setState({ checking: true, ready: false, message: null, status: null })

        checkBackendStartup().then((result) => {
            if (cancelled) return
            setState({
                checking: false,
                ready: result.ready,
                message: result.message,
                status: result.status,
            })
        })

        return () => {
            cancelled = true
        }
    }, [])

    return state
}
