export async function readErrorDetail(response, fallback = "Request failed") {
    try {
        const data = await response.clone().json()
        if (typeof data?.detail === "string" && data.detail.trim()) return data.detail
        if (typeof data?.message === "string" && data.message.trim()) return data.message
    } catch {
        // Ignore parse failures and fall back to plain text/status.
    }

    try {
        const text = (await response.text()).trim()
        if (text) return text
    } catch {
        // Ignore body read failures and use fallback below.
    }

    return response?.status ? `${fallback} (HTTP ${response.status})` : fallback
}
