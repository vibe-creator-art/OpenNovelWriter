import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizePromptAgentCallMode, normalizePromptCategory } from '@/lib/prompts'
import { normalizePromptInputs } from '@/lib/prompt-inputs'
import { getPromptApiErrorDetail, normalizeIncomingMessages, toPromptDto } from '@/lib/server/prompt-helpers'
import { getNextAvailableNumberedPromptName, loadPromptNameKeys } from '@/lib/server/prompt-names'

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

export async function GET(request: NextRequest) {
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

        const { searchParams } = new URL(request.url)
        const categoryRaw = searchParams.get('category')
        const category = categoryRaw ? normalizePromptCategory(categoryRaw) : null
        if (categoryRaw && !category) {
            return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
        }

        const records = await prisma.prompt.findMany({
            where: {
                ownerId: user.userId,
                ...(category ? { category } : {}),
            },
            orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { updatedAt: 'desc' }],
        })

        return NextResponse.json({ prompts: records.map(toPromptDto) })
    } catch (error) {
        console.error('List prompts error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
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

        const body = await request.json().catch(() => null)
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        const categoryRaw = typeof body?.category === 'string' ? body.category : ''
        const category = normalizePromptCategory(categoryRaw)
        const description = typeof body?.description === 'string' ? body.description : null
        const inputsRaw = body?.inputs
        const isNsfw = body?.isNsfw === true
        const modelGroupIds = normalizeStringIdList(body?.modelGroupIds)
        const modelSetIds = normalizeStringIdList(body?.modelSetIds)
        const allowLlmCall = category === 'component' ? false : body?.allowLlmCall === true
        const allowAgentCall = category === 'component' ? false : body?.allowAgentCall === true
        const agentCallMode = normalizePromptAgentCallMode(body?.agentCallMode)

        if (!name) {
            return NextResponse.json({ detail: 'Name is required' }, { status: 400 })
        }
        if (!category) {
            return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
        }
        if (inputsRaw !== undefined && !Array.isArray(inputsRaw)) {
            return NextResponse.json({ detail: 'Invalid inputs' }, { status: 400 })
        }
        if (modelGroupIds === null) {
            return NextResponse.json({ detail: 'Invalid modelGroupIds' }, { status: 400 })
        }
        if (modelSetIds === null) {
            return NextResponse.json({ detail: 'Invalid modelSetIds' }, { status: 400 })
        }

        const normalized = normalizeIncomingMessages({
            category,
            messages: body?.messages,
        })
        if (!normalized.ok) {
            return NextResponse.json({ detail: normalized.detail }, { status: 400 })
        }

        const existingKeys = await loadPromptNameKeys({ ownerId: user.userId })
        const uniqueName = getNextAvailableNumberedPromptName(name, existingKeys)
        const inputs = inputsRaw !== undefined ? normalizePromptInputs(inputsRaw) : []

        const record = await prisma.prompt.create({
            data: {
                name: uniqueName,
                category,
                messagesJson: JSON.stringify(normalized.messages),
                inputsJson: JSON.stringify(inputs),
                modelGroupIdsJson: JSON.stringify(modelGroupIds ?? []),
                modelSetIdsJson: JSON.stringify(modelSetIds ?? []),
                allowLlmCall,
                allowAgentCall,
                agentCallMode,
                description,
                isNsfw,
                ownerId: user.userId,
            },
        })

        return NextResponse.json({ prompt: toPromptDto(record) }, { status: 201 })
    } catch (error) {
        console.error('Create prompt error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}
