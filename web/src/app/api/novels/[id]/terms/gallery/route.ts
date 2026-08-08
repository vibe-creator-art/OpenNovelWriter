import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
    appendCodexArtifactToTermGallery,
    appendTermGalleryImage,
    isImportableTermGalleryUrl,
    TermGalleryError,
} from '@/lib/server/term-gallery'

interface RouteParams {
    params: Promise<{ id: string }>
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

        const body = (await request.json().catch(() => null)) as {
            entryId?: unknown
            url?: unknown
            artifact?: { sessionId?: unknown; imagePath?: unknown }
        } | null
        const entryId = typeof body?.entryId === 'string' ? body.entryId : ''
        const url = typeof body?.url === 'string' ? body.url.trim() : ''
        const sessionId = typeof body?.artifact?.sessionId === 'string' ? body.artifact.sessionId.trim() : ''
        const imagePath = typeof body?.artifact?.imagePath === 'string' ? body.artifact.imagePath.trim() : ''
        const hasUrl = Boolean(url)
        const hasArtifact = Boolean(sessionId && imagePath)
        if (!entryId || hasUrl === hasArtifact || (hasUrl && !isImportableTermGalleryUrl(url))) {
            return NextResponse.json({ detail: 'Invalid gallery item' }, { status: 400 })
        }

        const gallery = hasArtifact
            ? (await appendCodexArtifactToTermGallery({
                ownerId: user.userId,
                sessionId,
                novelId,
                termId: entryId,
                imagePath,
            })).gallery
            : await appendTermGalleryImage({
                ownerId: user.userId,
                novelId,
                termId: entryId,
                url,
            })
        return NextResponse.json({ entryId, gallery })
    } catch (error) {
        if (error instanceof TermGalleryError) {
            return NextResponse.json({ detail: error.message }, { status: error.status })
        }
        console.error('Add term gallery image error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
