import { NextRequest } from 'next/server'

import { handleCodexUpstreamRequest } from '@/lib/server/codex-proxy/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ connectionId: string; path: string[] }> }
) {
    const { connectionId, path } = await context.params
    return handleCodexUpstreamRequest({ request, connectionId, path })
}
