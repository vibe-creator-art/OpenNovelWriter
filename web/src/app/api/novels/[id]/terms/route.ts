import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { findDuplicateActiveTermTitle } from '@/lib/term-state'
import { syncNovelWorkspaceTerms } from '@/lib/server/novel-workspace'
import { scheduleImageGcSweep } from '@/lib/server/image-gc'

interface RouteParams {
    params: Promise<{ id: string }>
}

type TermStateResponse = {
    exists: boolean
    state: unknown
    updatedAt: string | null
}

function toDefaultTermState() {
    return { entries: [] as unknown[] }
}

function safeParseStateJson(raw: string | null) {
    if (!raw) return null
    try {
        return JSON.parse(raw) as unknown
    } catch {
        return null
    }
}

// GET /api/novels/[id]/terms - Get term state for a novel
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const record = await prisma.novelTermState.findUnique({
            where: { novelId },
            select: { stateJson: true, updatedAt: true },
        })

        if (!record) {
            const response: TermStateResponse = { exists: false, state: toDefaultTermState(), updatedAt: null }
            return NextResponse.json(response)
        }

        const parsed = safeParseStateJson(record.stateJson)
        const state =
            parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
                ? parsed
                : toDefaultTermState()
        const response: TermStateResponse = { exists: true, state, updatedAt: record.updatedAt.toISOString() }
        return NextResponse.json(response)
    } catch (error) {
        console.error('Get term state error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PUT /api/novels/[id]/terms - Save/replace term state for a novel
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        if (!body || typeof body !== 'object' || !Array.isArray((body as { entries?: unknown }).entries)) {
            return NextResponse.json({ detail: 'Invalid term state' }, { status: 400 })
        }

        const duplicateTitle = findDuplicateActiveTermTitle(body)
        if (duplicateTitle) {
            return NextResponse.json(
                { detail: 'Duplicate term title', title: duplicateTitle },
                { status: 409 }
            )
        }

        const previousRecord = await prisma.novelTermState.findUnique({
            where: { novelId },
            select: { stateJson: true },
        })
        const previousState = safeParseStateJson(previousRecord?.stateJson ?? null)
        const stateJson = JSON.stringify(body)
        const record = await prisma.novelTermState.upsert({
            where: { novelId },
            update: { stateJson },
            create: { novelId, stateJson },
            select: { updatedAt: true },
        })
        await syncNovelWorkspaceTerms(user.userId, novelId, {
            previousState,
            nextState: body,
        })
        // Saving may drop image references (deleted entries, removed gallery
        // items, replaced avatars) — let the sweeper reclaim the files.
        scheduleImageGcSweep()

        const response: TermStateResponse = { exists: true, state: body, updatedAt: record.updatedAt.toISOString() }
        return NextResponse.json(response)
    } catch (error) {
        console.error('Save term state error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
