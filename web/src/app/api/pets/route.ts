import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { listPets } from '@/lib/server/pet-storage'

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    return NextResponse.json({ pets: await listPets(user.userId) })
}
