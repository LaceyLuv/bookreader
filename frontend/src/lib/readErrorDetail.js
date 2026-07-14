function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return { ...value }
}

function defaultRetryable(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500
}

export async function readApiProblem(response, fallback = 'Request failed') {
    const status = Number.isFinite(response?.status) ? response.status : null
    let data = null

    try {
        data = await response.clone().json()
    } catch {
        // A plain-text response is handled below.
    }

    const structuredDetail = data?.detail && typeof data.detail === 'object' && !Array.isArray(data.detail)
        ? data.detail
        : null
    const stringDetail = nonEmptyString(data?.detail)
    const structuredMessage = nonEmptyString(structuredDetail?.message)
    const topLevelMessage = nonEmptyString(data?.message)

    let plainText = null
    if (data == null && !structuredMessage && !stringDetail && !topLevelMessage) {
        try {
            plainText = nonEmptyString(await response.text())
        } catch {
            // Use the localized fallback below.
        }
    }

    const message = structuredMessage
        || stringDetail
        || topLevelMessage
        || plainText
        || (status ? `${fallback} (HTTP ${status})` : fallback)

    return {
        code: nonEmptyString(structuredDetail?.code) || 'request_failed',
        message,
        severity: nonEmptyString(structuredDetail?.severity) || 'error',
        stage: nonEmptyString(structuredDetail?.stage),
        retryable: typeof structuredDetail?.retryable === 'boolean'
            ? structuredDetail.retryable
            : defaultRetryable(status),
        recovery: nonEmptyString(structuredDetail?.recovery),
        context: normalizeContext(structuredDetail?.context),
        status,
    }
}

export async function readErrorDetail(response, fallback = 'Request failed') {
    const problem = await readApiProblem(response, fallback)
    return problem.message
}
