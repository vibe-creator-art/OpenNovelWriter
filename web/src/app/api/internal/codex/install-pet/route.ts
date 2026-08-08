import { NextRequest, NextResponse } from 'next/server'

import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import {
    BuiltInPetError,
    DuplicatePetError,
    installPetFromDirectory,
    InvalidPetPackageError,
} from '@/lib/server/pet-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const directoryPath = typeof body?.directoryPath === 'string' ? body.directoryPath.trim() : ''
    if (!ownerId || !directoryPath) {
        return NextResponse.json({ detail: 'ownerId and directoryPath are required.' }, { status: 400 })
    }
    try {
        const pet = await installPetFromDirectory(ownerId, directoryPath)
        return NextResponse.json({ ok: true, pet })
    } catch (error) {
        if (
            error instanceof InvalidPetPackageError
            || error instanceof DuplicatePetError
            || error instanceof BuiltInPetError
        ) {
            return NextResponse.json({ detail: error.message }, { status: 400 })
        }
        console.error('Install Codex pet failed:', error)
        return NextResponse.json({ detail: 'Failed to install pet.' }, { status: 500 })
    }
}
