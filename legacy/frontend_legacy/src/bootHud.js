;(() => {
    if (!import.meta.env.DEV) return

    const RETRY_MS = 1000

    const start = () => {
        try {
            const HUD_ID = 'bookreader-boot-hud'
            const REFRESH_MS = 250
            let latestError = null
            let hud = null
            let bodyText = null

            const shortStack = (value) => {
                if (!value) return ''
                return String(value).split('\n').slice(0, 4).join('\n')
            }

            const rememberError = (kind, message, stack = '') => {
                latestError = {
                    kind,
                    message: String(message || 'Unknown error'),
                    stack: shortStack(stack),
                }
            }

            const prevOnError = window.onerror
            window.onerror = function (message, source, lineno, colno, error) {
                rememberError(
                    'onerror',
                    `${message || error?.message || 'Unknown error'} @ ${source || '(unknown)'}:${lineno ?? '-'}:${colno ?? '-'}`,
                    error?.stack || ''
                )
                if (typeof prevOnError === 'function') {
                    return prevOnError.apply(this, arguments)
                }
                return false
            }

            const prevOnUnhandled = window.onunhandledrejection
            window.onunhandledrejection = function (event) {
                const reason = event?.reason
                rememberError('unhandledrejection', reason?.message || reason || 'Unhandled promise rejection', reason?.stack || '')
                if (typeof prevOnUnhandled === 'function') {
                    return prevOnUnhandled.apply(this, arguments)
                }
            }

            const makeButton = (label, onClick) => {
                const button = document.createElement('button')
                button.type = 'button'
                button.textContent = label
                button.onclick = onClick
                button.style.all = 'initial'
                button.style.cursor = 'pointer'
                button.style.padding = '3px 8px'
                button.style.border = '1px solid #555'
                button.style.background = '#222'
                button.style.color = '#fff'
                button.style.font = '12px/1.4 system-ui'
                return button
            }

            const ensureHud = () => {
                hud = document.getElementById(HUD_ID) || hud
                if (!hud) {
                    hud = document.createElement('div')
                    hud.id = HUD_ID
                    hud.style.all = 'initial'
                    hud.style.position = 'fixed'
                    hud.style.left = '0'
                    hud.style.bottom = '0'
                    hud.style.zIndex = '2147483647'
                    hud.style.background = '#111'
                    hud.style.color = '#fff'
                    hud.style.font = '12px/1.4 system-ui'
                    hud.style.padding = '8px'
                    hud.style.maxWidth = '520px'
                    hud.style.boxSizing = 'border-box'
                    hud.style.display = 'block'
                    hud.style.whiteSpace = 'pre-wrap'

                    bodyText = document.createElement('pre')
                    bodyText.style.all = 'initial'
                    bodyText.style.display = 'block'
                    bodyText.style.whiteSpace = 'pre-wrap'
                    bodyText.style.color = '#fff'
                    bodyText.style.font = '12px/1.4 system-ui'
                    bodyText.style.margin = '0'
                    bodyText.style.maxHeight = '220px'
                    bodyText.style.overflow = 'auto'

                    const controls = document.createElement('div')
                    controls.style.all = 'initial'
                    controls.style.display = 'flex'
                    controls.style.gap = '8px'
                    controls.style.marginTop = '8px'

                    const resetButton = makeButton('Reset UI', () => {
                        try {
                            localStorage.removeItem('bookreader_settings')
                            localStorage.removeItem('bookreader_progress')
                        } catch {
                            // ignore
                        }
                        window.location.reload()
                    })

                    const reloadButton = makeButton('Reload', () => {
                        window.location.reload()
                    })

                    controls.appendChild(resetButton)
                    controls.appendChild(reloadButton)
                    hud.appendChild(bodyText)
                    hud.appendChild(controls)
                }

                if (!bodyText || !hud.contains(bodyText)) {
                    bodyText = hud.querySelector('pre')
                }

                const parent = document.body || document.documentElement
                if (hud.parentNode !== parent) {
                    parent.appendChild(hud)
                }

                hud.style.display = 'block'
                hud.style.visibility = 'visible'
                hud.style.opacity = '1'
            }

            const render = () => {
                ensureHud()
                if (!bodyText) return
                const lines = [
                    `href: ${window.location.href}`,
                    `main: ${window.__BOOKREADER_MAIN_LOGGED__ === true}`,
                    `app: ${window.__BOOKREADER_APP_LOGGED__ === true}`,
                    `dashboard: ${window.__BOOKREADER_DASHBOARD_LOGGED__ === true}`,
                ]

                if (latestError) {
                    lines.push(`error: [${latestError.kind}] ${latestError.message}`)
                    if (latestError.stack) {
                        lines.push(`stack: ${latestError.stack}`)
                    }
                } else {
                    lines.push('error: (none)')
                }

                bodyText.textContent = lines.join('\n')
            }

            render()
            window.setInterval(render, REFRESH_MS)
        } catch (error) {
            console.error('[bookreader-boot-hud] init failed', error)
            window.setTimeout(start, RETRY_MS)
        }
    }

    start()
})()
