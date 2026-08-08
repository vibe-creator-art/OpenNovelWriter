import { NextRequest, NextResponse } from 'next/server'

import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import {
    generateCodexImageArtifacts,
    normalizeGptImageBatch,
    normalizeGptImageDirect,
} from '@/lib/server/gpt-image'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
    const directoryPath = typeof body?.directoryPath === 'string' ? body.directoryPath.trim() : ''
    if (!ownerId || !sessionId || !directoryPath) {
        return NextResponse.json({ detail: 'ownerId, sessionId, and directoryPath are required.' }, { status: 400 })
    }

    const session = await prisma.codexSession.findFirst({
        where: { id: sessionId, ownerId },
        select: { id: true },
    })
    if (!session) return NextResponse.json({ detail: 'Codex session not found.' }, { status: 404 })

    let batch
    try {
        batch = body.batch === undefined
            ? normalizeGptImageDirect(body)
            : normalizeGptImageBatch(body.batch)
    } catch (error) {
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Invalid image request.' },
            { status: 400 }
        )
    }

    try {
        const result = await generateCodexImageArtifacts({
            ownerId,
            sessionId,
            directoryPath,
            batch,
            signal: request.signal,
        })
        return NextResponse.json(result)
    } catch (error) {
        console.error('Codex GPT Image request failed:', error)
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Failed to generate images.' },
            { status: 502 }
        )
    }
}
