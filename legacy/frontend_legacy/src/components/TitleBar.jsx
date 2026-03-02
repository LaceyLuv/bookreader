import { useEffect, useState } from 'react'
import { IS_TAURI_RUNTIME } from '../lib/apiBase'
import { TITLE_BAR_HEIGHT } from '../lib/appChrome'

const WINDOW_MODULE = '@tauri-apps/api/window'

function reportWindowWarning(context, error) {
    const message = `${context}: ${String(error?.message || error || 'unknown error')}`
    console.warn('[tauri-window]', message)
    try {
        window.dispatchEvent(
            new CustomEvent('__bootwatchdog_warning__', {
                detail: { kind: 'tauri-window', message, extra: String(error?.stack || '') },
            }),
        )
    } catch {
        // Ignore secondary reporting errors.
    }
}

function TitleBarButton({ disabled, onClick, title, children }) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            onClick={onClick}
            disabled={disabled}
            className="h-7 w-10 flex items-center justify-center rounded transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--app-fg)' }}
        >
            {children}
        </button>
    )
}

export default function TitleBar({ visible = true }) {
    const [appWindow, setAppWindow] = useState(null)
    const [isMaximized, setIsMaximized] = useState(false)

    useEffect(() => {
        let mounted = true
        let unlisten = null

        if (!IS_TAURI_RUNTIME) {
            return () => {}
        }

        ;(async () => {
            try {
                const api = await import(WINDOW_MODULE)
                if (!mounted) return
                const win = api.getCurrentWindow()
                setAppWindow(win)
                try {
                    setIsMaximized(await win.isMaximized())
                } catch (error) {
                    reportWindowWarning('isMaximized(init) failed', error)
                }
                unlisten = await win.onResized(() => {
                    if (!mounted) return
                    win.isMaximized()
                        .then((value) => {
                            if (mounted) setIsMaximized(value)
                        })
                        .catch((error) => {
                            reportWindowWarning('isMaximized(onResized) failed', error)
                        })
                })
            } catch (error) {
                reportWindowWarning('window module init failed', error)
                setAppWindow(null)
            }
        })()

        return () => {
            mounted = false
            if (typeof unlisten === 'function') {
                try {
                    unlisten()
                } catch (error) {
                    reportWindowWarning('window onResized unlisten failed', error)
                }
            }
        }
    }, [])

    if (!visible) {
        return null
    }

    const disabled = !appWindow
    const noop = () => {}
    const runWindowAction = async (label, action) => {
        try {
            await action()
        } catch (error) {
            reportWindowWarning(`${label} failed`, error)
        }
    }

    return (
        <div
            className="fixed left-0 right-0 top-0 z-[1000] flex items-center justify-between px-2"
            style={{
                height: `${TITLE_BAR_HEIGHT}px`,
                backgroundColor: 'var(--app-bg)',
                color: 'var(--app-fg)',
                borderBottom: '1px solid rgba(127, 127, 127, 0.3)',
            }}
        >
            <div className="flex h-full flex-1 select-none items-center px-2 text-xs opacity-70" data-tauri-drag-region>
                BookReader
            </div>
            <div className="flex items-center gap-1">
                <TitleBarButton
                    disabled={disabled}
                    onClick={disabled ? noop : () => void runWindowAction('minimize', () => appWindow.minimize())}
                    title="Minimize"
                >
                    <span aria-hidden>-</span>
                </TitleBarButton>
                <TitleBarButton
                    disabled={disabled}
                    onClick={disabled ? noop : () => void runWindowAction('toggleMaximize', async () => {
                        await appWindow.toggleMaximize()
                        setIsMaximized(await appWindow.isMaximized())
                    })}
                    title="Toggle Maximize"
                >
                    <span aria-hidden>{isMaximized ? '[]' : '[ ]'}</span>
                </TitleBarButton>
                <TitleBarButton
                    disabled={disabled}
                    onClick={disabled ? noop : () => void runWindowAction('close', () => appWindow.close())}
                    title="Close"
                >
                    <span aria-hidden>x</span>
                </TitleBarButton>
            </div>
        </div>
    )
}
