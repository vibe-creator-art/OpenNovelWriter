import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizeLabelIds, serializeWithLabelIds } from '@/lib/labels'
import { syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/novels/[id]/acts - Get all acts for a novel
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        // Check ownership
        const novel = await prisma.novel.findUnique({
            where: { id: novelId },
            select: { ownerId: true },
        })

        if (!novel || novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const acts = await prisma.act.findMany({
            where: { novelId },
            orderBy: { number: 'asc' },
        })

        return NextResponse.json(acts.map(serializeWithLabelIds))
    } catch (error) {
        console.error('Get acts error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/acts - Create or update an act (upsert)
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params
        const body = await request.json()
        const { number, title, summary, labelIds } = body

        if (number === undefined) {
            return NextResponse.json({ detail: 'Act number is required' }, { status: 400 })
        }

        // Check ownership
        const novel = await prisma.novel.findUnique({
            where: { id: novelId },
            select: { ownerId: true },
        })

        if (!novel || novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        let sanitizedLabelIds: string[] | undefined
        if (labelIds !== undefined) {
            const normalized = normalizeLabelIds(labelIds)
            if (!normalized) {
                return NextResponse.json({ detail: 'Invalid labelIds' }, { status: 400 })
            }
            if (normalized.length === 0) {
                sanitizedLabelIds = []
            } else {
                const allowed = await prisma.label.findMany({
                    where: { novelId, id: { in: normalized } },
                    select: { id: true },
                })
                const allowedSet = new Set(allowed.map(l => l.id))
                sanitizedLabelIds = normalized.filter(id => allowedSet.has(id))
            }
        }

        // Upsert - create if doesn't exist, update if it does
        const act = await prisma.act.upsert({
            where: {
                novelId_number: {
                    novelId,
                    number,
                },
            },
            update: {
                ...(title !== undefined && { title: title || null }),
                ...(summary !== undefined && { summary: summary || null }),
                ...(sanitizedLabelIds !== undefined && { labelIdsJson: JSON.stringify(sanitizedLabelIds) }),
            },
            create: {
                novelId,
                number,
                title: title || null,
                summary: summary || null,
                ...(sanitizedLabelIds !== undefined && { labelIdsJson: JSON.stringify(sanitizedLabelIds) }),
            },
        })
        await syncNovelWorkspaceOutline(user.userId, novelId)

        return NextResponse.json(serializeWithLabelIds(act))
    } catch (error) {
        console.error('Upsert act error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
