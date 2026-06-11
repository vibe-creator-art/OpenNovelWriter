import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

type GalleryItem = { id: string; url: string }

function isImportableUrl(url: string) {
    return url.startsWith('/uploads/') || url.startsWith('http://') || url.startsWith('https://')
}

// POST /api/novels/[id]/terms/gallery - Append an image to one term entry's gallery.
//
// This exists alongside the whole-state PUT because imports happen from the
// chat / codex panels, where the terms sidebar (the whole-state owner) may not
// be mounted. Mutating the stored state server-side keeps the append atomic.
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

        const body = (await request.json().catch(() => null)) as { entryId?: unknown; url?: unknown } | null
        const entryId = typeof body?.entryId === 'string' ? body.entryId : ''
        const url = typeof body?.url === 'string' ? body.url.trim() : ''
        if (!entryId || !url || !isImportableUrl(url)) {
            return NextResponse.json({ detail: 'Invalid gallery item' }, { status: 400 })
        }

        const record = await prisma.novelTermState.findUnique({
            where: { novelId },
            select: { stateJson: true },
        })
        let state: { entries?: unknown[] } | null = null
        try {
            state = record ? (JSON.parse(record.stateJson) as { entries?: unknown[] }) : null
        } catch {
            state = null
        }
        if (!state || !Array.isArray(state.entries)) {
            return NextResponse.json({ detail: 'Term entry not found' }, { status: 404 })
        }

        const entry = state.entries.find(
            (candidate): candidate is Record<string, unknown> =>
                Boolean(candidate) &&
                typeof candidate === 'object' &&
                (candidate as { id?: unknown }).id === entryId
        )
        if (!entry) {
            return NextResponse.json({ detail: 'Term entry not found' }, { status: 404 })
        }

        const gallery: GalleryItem[] = Array.isArray(entry.gallery)
            ? (entry.gallery as unknown[]).filter(
                  (item): item is GalleryItem =>
                      Boolean(item) && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string'
              )
            : []

        if (!gallery.some((item) => item.url === url)) {
            gallery.push({ id: randomUUID(), url })
            entry.gallery = gallery
            await prisma.novelTermState.update({
                where: { novelId },
                data: { stateJson: JSON.stringify(state) },
            })
        }

        return NextResponse.json({ entryId, gallery })
    } catch (error) {
        console.error('Add term gallery image error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
