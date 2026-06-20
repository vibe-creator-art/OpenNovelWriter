import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizePromptAgentCallMode, normalizePromptCategory } from '@/lib/prompts'
import { normalizePromptInputs } from '@/lib/prompt-inputs'
import { recordRevisionHistory, safeParseRevisionHistoryJson } from '@/lib/revision-history'
import { getPromptApiErrorDetail, getPromptPrimaryMessageContent, normalizeIncomingMessages, normalizeStoredMessages, toPromptDto } from '@/lib/server/prompt-helpers'
import { loadPromptNameKeys, toPromptNameKey } from '@/lib/server/prompt-names'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'

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

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }
        if (!('prompt' in (prisma as unknown as Record<string, unknown>))) {
            return NextResponse.json(
                { detail: 'Prisma client is out of date. Run `prisma generate`.' },
                { status: 500 }
            )
        }

        const { id } = await params
        const prompt = await prisma.prompt.findFirst({
            where: { id, ownerId: user.userId },
        })

        if (!prompt) {
            return NextResponse.json({ detail: 'Prompt not found' }, { status: 404 })
        }

        return NextResponse.json({ prompt: toPromptDto(prompt) })
    } catch (error) {
        console.error('Get prompt error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }
        if (!('prompt' in (prisma as unknown as Record<string, unknown>))) {
            return NextResponse.json(
                { detail: 'Prisma client is out of date. Run `prisma generate`.' },
                { status: 500 }
            )
        }

        const { id } = await params
        const existing = await prisma.prompt.findFirst({
            where: { id, ownerId: user.userId },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Prompt not found' }, { status: 404 })
        }

        // Prompts cloned from an official preset are read-only unless preset authoring is enabled.
        // Editing requires cloning the prompt first (which produces an unmarked, editable copy).
        const existingSourcePresetId = (existing as { sourcePresetId?: string | null }).sourcePresetId ?? null
        if (existingSourcePresetId && !isPresetAuthoringEnabled()) {
            return NextResponse.json(
                { detail: 'This prompt is from an official preset. Clone it before editing.', code: 'PRESET_SOURCED_READ_ONLY' },
                { status: 403 }
            )
        }

        const body = await request.json().catch(() => null)
        const name = typeof body?.name === 'string' ? body.name.trim() : undefined
        const categoryRaw = typeof body?.category === 'string' ? body.category : undefined
        const category = categoryRaw !== undefined ? normalizePromptCategory(categoryRaw) : undefined
        const description =
            body?.description === null ? null : typeof body?.description === 'string' ? body.description : undefined
        const sortOrder = typeof body?.sortOrder === 'number' ? body.sortOrder : undefined
        const inputsRaw = body?.inputs
        const isNsfw = body?.isNsfw
        const modelGroupIds = normalizeStringIdList(body?.modelGroupIds)
        const modelSetIds = normalizeStringIdList(body?.modelSetIds)
        const allowLlmCall = body?.allowLlmCall
        const allowAgentCall = body?.allowAgentCall
        const hasAgentCallMode = body?.agentCallMode !== undefined
        const agentCallMode = normalizePromptAgentCallMode(body?.agentCallMode)

        if (name !== undefined && !name) {
            return NextResponse.json({ detail: 'Name cannot be empty' }, { status: 400 })
        }
        if (categoryRaw !== undefined && category === null) {
            return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
        }
        if (inputsRaw !== undefined && !Array.isArray(inputsRaw)) {
            return NextResponse.json({ detail: 'Invalid inputs' }, { status: 400 })
        }
        if (isNsfw !== undefined && typeof isNsfw !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid isNsfw' }, { status: 400 })
        }
        if (modelGroupIds === null) {
            return NextResponse.json({ detail: 'Invalid modelGroupIds' }, { status: 400 })
        }
        if (modelSetIds === null) {
            return NextResponse.json({ detail: 'Invalid modelSetIds' }, { status: 400 })
        }
        if (allowLlmCall !== undefined && typeof allowLlmCall !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid allowLlmCall' }, { status: 400 })
        }
        if (allowAgentCall !== undefined && typeof allowAgentCall !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid allowAgentCall' }, { status: 400 })
        }

        const existingCategory = normalizePromptCategory(existing.category)
        const nextCategory = category ?? existingCategory ?? 'default'
        const changingCategory = category !== undefined && nextCategory !== (existingCategory ?? nextCategory)
        const shouldNormalizeStoredCategory = existingCategory !== null && existing.category !== existingCategory
        const hasIncomingMessages = body?.messages !== undefined
        if (changingCategory && !hasIncomingMessages) {
            return NextResponse.json({ detail: 'Messages are required when changing category' }, { status: 400 })
        }

        const nextName = name ?? existing.name
        if (name !== undefined && nextName !== existing.name) {
            const existingKeys = await loadPromptNameKeys({ ownerId: user.userId, excludeId: id })
            const nextKey = toPromptNameKey(nextName)
            if (nextKey && existingKeys.has(nextKey)) {
                return NextResponse.json({ detail: 'Prompt name already exists' }, { status: 409 })
            }
        }

        const updateData: Record<string, unknown> = {
            ...(name !== undefined ? { name } : {}),
            ...(category !== undefined || shouldNormalizeStoredCategory ? { category: nextCategory } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
        }

        if (inputsRaw !== undefined) {
            updateData.inputsJson = JSON.stringify(normalizePromptInputs(inputsRaw))
        }
        if (modelGroupIds !== undefined) {
            updateData.modelGroupIdsJson = JSON.stringify(modelGroupIds)
        }
        if (modelSetIds !== undefined) {
            updateData.modelSetIdsJson = JSON.stringify(modelSetIds)
        }

        if (nextCategory === 'component') {
            if (Boolean(existing.allowLlmCall)) updateData.allowLlmCall = false
            if (Boolean(existing.allowAgentCall)) updateData.allowAgentCall = false
            if (existing.agentCallMode !== 'generate_then_agent') updateData.agentCallMode = 'generate_then_agent'
        } else {
            if (allowLlmCall !== undefined) updateData.allowLlmCall = allowLlmCall
            if (allowAgentCall !== undefined) updateData.allowAgentCall = allowAgentCall
            if (hasAgentCallMode) updateData.agentCallMode = agentCallMode
        }

        if (body?.messages !== undefined) {
            const normalized = normalizeIncomingMessages({
                category: nextCategory,
                messages: body?.messages,
            })
            if (!normalized.ok) {
                return NextResponse.json({ detail: normalized.detail }, { status: 400 })
            }
            updateData.messagesJson = JSON.stringify(normalized.messages)

            const existingMessages = normalizeStoredMessages({
                promptId: existing.id,
                category: existing.category,
                messagesJson: existing.messagesJson,
            })
            const existingPrimaryContent = getPromptPrimaryMessageContent(existingMessages)
            const nextPrimaryContent = getPromptPrimaryMessageContent(normalized.messages)

            if (nextPrimaryContent !== existingPrimaryContent) {
                const now = Date.now()
                const history = safeParseRevisionHistoryJson(existing.historyJson ?? null, { idPrefix: 'prompt' })
                const { history: nextHistory, recorded } = recordRevisionHistory(history, nextPrimaryContent, {
                    now,
                    idPrefix: 'prompt',
                    normalize: (value) => value.trim(),
                })
                if (recorded) updateData.historyJson = JSON.stringify(nextHistory)
            }
        }

        if (isNsfw !== undefined) {
            const current = Boolean(existing.isNsfw)
            if (current !== isNsfw) updateData.isNsfw = isNsfw
        }

        const prompt = await prisma.prompt.update({
            where: { id },
            data: updateData,
        })

        return NextResponse.json({ prompt: toPromptDto(prompt) })
    } catch (error) {
        console.error('Update prompt error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }
        if (!('prompt' in (prisma as unknown as Record<string, unknown>))) {
            return NextResponse.json(
                { detail: 'Prisma client is out of date. Run `prisma generate`.' },
                { status: 500 }
            )
        }

        const { id } = await params
        const existing = await prisma.prompt.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Prompt not found' }, { status: 404 })
        }

        await prisma.prompt.delete({ where: { id } })
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Delete prompt error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}
