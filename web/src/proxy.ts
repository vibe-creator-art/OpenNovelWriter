import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
    getSiteProtectionCookieValue,
    getSiteProtectionCredentials,
    isAuthorizedBySiteProtectionCookie,
    isAuthorizedBySiteProtection,
    isSiteProtectionEnabled,
    SITE_PROTECTION_COOKIE_NAME,
} from '@/lib/site-protection'

function unauthorizedResponse() {
    return new NextResponse('Authentication required.', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="OpenNovelWriter", charset="UTF-8"',
            'Cache-Control': 'no-store',
        },
    })
}

export function proxy(request: NextRequest) {
    if (!isSiteProtectionEnabled()) {
        return NextResponse.next()
    }

    if (!getSiteProtectionCredentials()) {
        return new NextResponse('Site protection is enabled but credentials are missing.', {
            status: 500,
            headers: {
                'Cache-Control': 'no-store',
            },
        })
    }

    const siteProtectionCookie = request.cookies.get(SITE_PROTECTION_COOKIE_NAME)?.value
    if (isAuthorizedBySiteProtectionCookie(siteProtectionCookie)) {
        return NextResponse.next()
    }

    if (isAuthorizedBySiteProtection(request.headers.get('authorization'))) {
        const response = NextResponse.next()
        const cookieValue = getSiteProtectionCookieValue()

        if (cookieValue) {
            response.cookies.set({
                name: SITE_PROTECTION_COOKIE_NAME,
                value: cookieValue,
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/',
            })
        }

        return response
    }

    return unauthorizedResponse()
}

export const config = {
    // `api/internal` is excluded: those routes are server-to-server (e.g. the Codex
    // MCP run_llm callback) and carry their own internal-token auth, so they must not
    // sit behind the browser-only Basic Auth prompt.
    matcher: ['/((?!_next/static|_next/image|favicon.ico|uploads|api/internal).*)'],
}
