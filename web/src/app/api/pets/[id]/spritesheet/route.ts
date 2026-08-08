import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { PetNotFoundError, readPetSpritesheet } from '@/lib/server/pet-storage'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await params
    try {
        const sprite = await readPetSpritesheet(user.userId, id)
        return new NextResponse(new Uint8Array(sprite.bytes), {
            headers: {
                'Content-Type': sprite.contentType,
                'Cache-Control': 'private, max-age=3600',
            },
        })
    } catch (error) {
        if (error instanceof PetNotFoundError) {
            return NextResponse.json({ detail: error.message }, { status: 404 })
        }
        return NextResponse.json({ detail: 'Pet spritesheet not found.' }, { status: 404 })
    }
}
