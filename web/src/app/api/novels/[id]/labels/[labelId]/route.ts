import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { parseLabelIdsJson } from '@/lib/labels'

interface RouteParams {
    params: Promise<{ id: string; labelId: string }>
}

async function loadLabelForOwner(novelId: string, labelId: string, ownerId: string) {
    const label = await prisma.label.findUnique({
        where: { id: labelId },
        include: { novel: { select: { ownerId: true } } },
    })
    if (!label) return null
    if (label.novelId !== novelId) return null
    if (label.novel.ownerId !== ownerId) return null
    return label
}

// PUT /api/novels/[id]/labels/[labelId] - Update a label
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId, labelId } = await params
        const existing = await loadLabelForOwner(novelId, labelId, user.userId)
        if (!existing) {
            return NextResponse.json({ detail: 'Label not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const updateData: { name?: string; sortOrder?: number; color?: string | null } = {}

        if (body && typeof body === 'object') {
            if ('name' in body) {
                const nameRaw = (body as { name?: unknown }).name
                if (typeof nameRaw !== 'string') {
                    return NextResponse.json({ detail: 'Invalid label name' }, { status: 400 })
                }
                const name = nameRaw.trim()
                if (!name) {
                    return NextResponse.json({ detail: 'Invalid label name' }, { status: 400 })
                }
                updateData.name = name
            }
            if ('sortOrder' in body) {
                const sortOrderRaw = (body as { sortOrder?: unknown }).sortOrder
                if (typeof sortOrderRaw !== 'number' || !Number.isFinite(sortOrderRaw) || !Number.isInteger(sortOrderRaw) || sortOrderRaw < 0) {
                    return NextResponse.json({ detail: 'Invalid sort order' }, { status: 400 })
                }
                updateData.sortOrder = sortOrderRaw
            }
            if ('color' in body) {
                const colorRaw = (body as { color?: unknown }).color
                if (colorRaw === null) {
                    updateData.color = null
                } else if (typeof colorRaw === 'string') {
                    const trimmed = colorRaw.trim()
                    if (!trimmed) {
                        updateData.color = null
                    } else if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
                        return NextResponse.json({ detail: 'Invalid color' }, { status: 400 })
                    } else {
                        updateData.color = trimmed.toLowerCase()
                    }
                } else {
                    return NextResponse.json({ detail: 'Invalid color' }, { status: 400 })
                }
            }
        }

        const label = await prisma.label.update({
            where: { id: labelId },
            data: updateData,
        })

        return NextResponse.json(label)
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
            return NextResponse.json({ detail: 'Label name already exists' }, { status: 409 })
        }

        console.error('Update label error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/novels/[id]/labels/[labelId] - Delete a label
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId, labelId } = await params
        const existing = await loadLabelForOwner(novelId, labelId, user.userId)
        if (!existing) {
            return NextResponse.json({ detail: 'Label not found' }, { status: 404 })
        }

        await prisma.label.delete({ where: { id: labelId } })

        // Clean up label references from act/scene JSON fields (best-effort)
        const acts = await prisma.act.findMany({
            where: { novelId },
            select: { id: true, labelIdsJson: true },
        })
        const chapterIds = await prisma.chapter.findMany({
            where: { novelId },
            select: { id: true },
        })
        const scenes = chapterIds.length > 0
            ? await prisma.scene.findMany({
                where: { chapterId: { in: chapterIds.map(c => c.id) } },
                select: { id: true, labelIdsJson: true },
            })
            : []

        const updates = []
        for (const act of acts) {
            const ids = parseLabelIdsJson(act.labelIdsJson)
            if (!ids.includes(labelId)) continue
            const next = ids.filter(id => id !== labelId)
            updates.push(prisma.act.update({
                where: { id: act.id },
                data: { labelIdsJson: JSON.stringify(next) },
            }))
        }
        for (const scene of scenes) {
            const ids = parseLabelIdsJson(scene.labelIdsJson)
            if (!ids.includes(labelId)) continue
            const next = ids.filter(id => id !== labelId)
            updates.push(prisma.scene.update({
                where: { id: scene.id },
                data: { labelIdsJson: JSON.stringify(next) },
            }))
        }
        if (updates.length > 0) {
            await prisma.$transaction(updates)
        }

        return NextResponse.json({ message: 'Label deleted' })
    } catch (error) {
        console.error('Delete label error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
