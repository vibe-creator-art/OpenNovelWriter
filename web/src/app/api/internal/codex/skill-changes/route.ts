import { NextRequest, NextResponse } from 'next/server'

import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { syncActiveCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import { applySkillChanges, validateSkillChanges } from '@/lib/server/skill-authoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const sourceRoot = typeof body?.sourceRoot === 'string' ? body.sourceRoot.trim() : ''
    const mode = body?.mode === 'apply' ? 'apply' : body?.mode === 'validate' ? 'validate' : null
    if (!ownerId) return NextResponse.json({ detail: 'ownerId is required.' }, { status: 400 })
    if (!sourceRoot) return NextResponse.json({ detail: 'sourceRoot is required.' }, { status: 400 })
    if (!mode) return NextResponse.json({ detail: 'mode must be validate or apply.' }, { status: 400 })

    try {
        if (mode === 'validate') {
            const validation = await validateSkillChanges({ ownerId, sourceRoot, changeSet: body?.changeSet })
            return NextResponse.json({ ok: true, mode, plan: validation.plan })
        }

        const result = await applySkillChanges({ ownerId, sourceRoot, changeSet: body?.changeSet })
        await syncActiveCodexConnectionSkills(ownerId)
        return NextResponse.json({ ok: true, mode, ...result })
    } catch (error) {
        console.error('Codex skill-changes internal call failed:', error)
        return NextResponse.json(
            { ok: false, detail: error instanceof Error ? error.message : 'Failed to process skill changes.' },
            { status: 400 }
        )
    }
}
