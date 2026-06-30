import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { getPromptApiErrorDetail, toPromptDto } from '@/lib/server/prompt-helpers'

interface RouteParams {
    params: Promise<{ id: string }>
}

function normalizeStringIdList(value: unknown) {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) return null

    const seen = new Set<string>()
    const result: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') continue
        const trimmed = item.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        result.push(trimmed)
    }
    return result
}

/**
 * Update only a prompt's model bindings (modelGroupIds / modelSetIds). These are user-local data,
 * not preset content, so — unlike the full prompt PUT — this endpoint is intentionally NOT gated by
 * `sourcePresetId`: a prompt cloned from an official preset can still bind/unbind models in place,
 * without cloning. Preset upgrades never overwrite these (see prompt-preset-helpers).
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const existing = await prisma.prompt.findFirst({ where: { id, ownerId: user.userId } })
        if (!existing) {
            return NextResponse.json({ detail: 'Prompt not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const modelGroupIds = normalizeStringIdList(body?.modelGroupIds)
        const modelSetIds = normalizeStringIdList(body?.modelSetIds)
        if (modelGroupIds === null) {
            return NextResponse.json({ detail: 'Invalid modelGroupIds' }, { status: 400 })
        }
        if (modelSetIds === null) {
            return NextResponse.json({ detail: 'Invalid modelSetIds' }, { status: 400 })
        }

        const updated = await prisma.prompt.update({
            where: { id: existing.id },
            data: {
                ...(modelGroupIds !== undefined ? { modelGroupIdsJson: JSON.stringify(modelGroupIds) } : {}),
                ...(modelSetIds !== undefined ? { modelSetIdsJson: JSON.stringify(modelSetIds) } : {}),
            },
        })

        return NextResponse.json({ prompt: toPromptDto(updated) })
    } catch (error) {
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}
