function isTruthyEnvValue(value: string | undefined) {
    return value === 'true' || value === '1'
}

export const SITE_PROTECTION_COOKIE_NAME = 'open_novel_writer_site_protection'

function decodeBasicAuthCredentials(header: string) {
    if (!header.startsWith('Basic ')) return null

    try {
        const decoded = atob(header.slice(6))
        const separatorIndex = decoded.indexOf(':')
        if (separatorIndex < 0) return null

        return {
            username: decoded.slice(0, separatorIndex),
            password: decoded.slice(separatorIndex + 1),
        }
    } catch {
        return null
    }
}

export function isSiteProtectionEnabled() {
    return isTruthyEnvValue(process.env.SITE_BASIC_AUTH_ENABLED)
}

export function getSiteProtectionCredentials() {
    const username = process.env.SITE_BASIC_AUTH_USERNAME ?? ''
    const password = process.env.SITE_BASIC_AUTH_PASSWORD ?? ''

    if (!username || !password) return null

    return { username, password }
}

export function getSiteProtectionCookieValue() {
    const credentials = getSiteProtectionCredentials()
    if (!credentials) return null

    return btoa(`${credentials.username}:${credentials.password}`)
}

export function isAuthorizedBySiteProtection(header: string | null) {
    const credentials = getSiteProtectionCredentials()
    if (!credentials) return false

    const parsed = header ? decodeBasicAuthCredentials(header) : null
    if (!parsed) return false

    return parsed.username === credentials.username && parsed.password === credentials.password
}

export function isAuthorizedBySiteProtectionCookie(cookieValue: string | undefined) {
    const expectedValue = getSiteProtectionCookieValue()
    if (!expectedValue) return false

    return cookieValue === expectedValue
}
