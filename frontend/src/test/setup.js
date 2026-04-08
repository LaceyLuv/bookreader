import { afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

beforeAll(() => {
    if (!window.ResizeObserver) {
        window.ResizeObserver = class {
            observe() {}
            disconnect() {}
            unobserve() {}
        }
    }

    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0)
        window.cancelAnimationFrame = (id) => window.clearTimeout(id)
    }

    if (!HTMLElement.prototype.scrollIntoView) {
        HTMLElement.prototype.scrollIntoView = vi.fn()
    }

    if (!HTMLElement.prototype.scrollTo) {
        HTMLElement.prototype.scrollTo = vi.fn()
    }
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
})
