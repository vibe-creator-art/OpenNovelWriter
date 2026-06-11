import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

type RemapRequestBody = {
    mapping: Record<string, unknown>
}

function parseInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number.isInteger(value) ? value : null
    }
    if (typeof value === 'string') {
        const parsed = parseInt(value, 10)
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null
        return parsed
    }
    return null
}

// POST /api/novels/[id]/outlines/acts/remap - Remap act numbers for outlines
export async function POST(request: NextRequest, { params }: RouteParams) {
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

        const body = (await request.json().catch(() => null)) as RemapRequestBody | null
        const rawMapping = body?.mapping
        if (!rawMapping || typeof rawMapping !== 'object') {
            return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 })
        }

        const mapping = new Map<number, number>()
        for (const [rawOld, rawNew] of Object.entries(rawMapping as Record<string, unknown>)) {
            const oldNumber = parseInteger(rawOld)
            const newNumber = parseInteger(rawNew)
            if (!oldNumber || oldNumber <= 0) continue
            if (!newNumber || newNumber <= 0) continue
            if (oldNumber === newNumber) continue
            mapping.set(oldNumber, newNumber)
        }

        if (mapping.size === 0) {
            return NextResponse.json({ ok: true })
        }

        const newNumbers = Array.from(mapping.values())
        const uniqueNewNumbers = new Set(newNumbers)
        if (uniqueNewNumbers.size !== newNumbers.length) {
            return NextResponse.json({ detail: 'Invalid mapping (duplicate destination numbers)' }, { status: 400 })
        }

        const oldNumbers = Array.from(mapping.keys())
        const outlines = await prisma.outline.findMany({
            where: { novelId, type: 'ACT', actNumber: { in: oldNumbers } },
            select: { id: true, actNumber: true },
        })

        if (outlines.length === 0) {
            return NextResponse.json({ ok: true })
        }

        const maxAct = await prisma.outline.aggregate({
            where: { novelId, type: 'ACT' },
            _max: { actNumber: true },
        })
        const maxActNumber = typeof maxAct._max.actNumber === 'number' ? maxAct._max.actNumber : 0
        const tempOffset = maxActNumber + outlines.length + 1000

        const updates = outlines
            .map((outline) => {
                const oldActNumber = outline.actNumber
                if (typeof oldActNumber !== 'number') return null
                const newActNumber = mapping.get(oldActNumber)
                if (!newActNumber) return null
                return {
                    id: outline.id,
                    oldActNumber,
                    tempActNumber: oldActNumber + tempOffset,
                    newActNumber,
                }
            })
            .filter(Boolean) as { id: string; oldActNumber: number; tempActNumber: number; newActNumber: number }[]

        if (updates.length === 0) {
            return NextResponse.json({ ok: true })
        }

        await prisma.$transaction(async (tx) => {
            for (const update of updates) {
                await tx.outline.update({
                    where: { id: update.id },
                    data: { actNumber: update.tempActNumber },
                })
            }

            for (const update of updates) {
                await tx.outline.update({
                    where: { id: update.id },
                    data: { actNumber: update.newActNumber },
                })
            }
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Remap act outlines error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

