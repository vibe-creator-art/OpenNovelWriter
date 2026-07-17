import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

// POST /api/novels/[id]/scene-edits/statuses - body { ids: string[] }
// Returns only the authoritative status fields needed by historical Codex diff cards.
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id: novelId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const body = await request.json().catch(() => ({}))
        if (!Array.isArray(body?.ids) || body.ids.some((id: unknown) => typeof id !== 'string')) {
            return NextResponse.json({ detail: 'ids must be an array of strings' }, { status: 400 })
        }

        const ids = [...new Set(body.ids as string[])]
        if (ids.length === 0) return NextResponse.json({ statuses: [] })

        // Stay below SQLite's bound-parameter limit even for unusually long Codex sessions.
        const chunks: string[][] = []
        for (let index = 0; index < ids.length; index += 500) chunks.push(ids.slice(index, index + 500))

        const statuses = (await Promise.all(chunks.map((chunk) => prisma.sceneEdit.findMany({
            where: { novelId, id: { in: chunk } },
            select: { id: true, status: true },
        })))).flat()

        return NextResponse.json({ statuses })
    } catch (error) {
        console.error('List scene edit statuses error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
