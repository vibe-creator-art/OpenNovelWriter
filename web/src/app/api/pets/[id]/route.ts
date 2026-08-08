import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { DEFAULT_PET_ID } from '@/lib/pets'
import { BuiltInPetError, deletePet, PetNotFoundError } from '@/lib/server/pet-storage'

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await params
    try {
        await deletePet(user.userId, id)
        await prisma.novel.updateMany({
            where: { ownerId: user.userId, codexPetId: id },
            data: { codexPetId: DEFAULT_PET_ID },
        })
        return NextResponse.json({ ok: true })
    } catch (error) {
        if (error instanceof BuiltInPetError) {
            return NextResponse.json({ detail: error.message }, { status: 400 })
        }
        if (error instanceof PetNotFoundError) {
            return NextResponse.json({ detail: error.message }, { status: 404 })
        }
        throw error
    }
}
