export const READER_LOCATOR_VERSION = 2

export function createReaderLocator(kind, value) {
    if (!value || typeof value !== 'object') return null
    return {
        ...value,
        version: READER_LOCATOR_VERSION,
        kind: typeof value.kind === 'string' ? value.kind : kind,
    }
}

export function hasMeaningfulLocator(locator) {
    if (!locator || typeof locator !== 'object') return false
    return Object.keys(locator).some((key) => !['version', 'kind'].includes(key) && locator[key] != null)
}
