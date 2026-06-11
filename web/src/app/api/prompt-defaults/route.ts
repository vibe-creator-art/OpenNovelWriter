import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizeDefaultPromptSelectionCategory } from '@/lib/prompt-default-categories'
import { normalizePromptCategory } from '@/lib/prompts'
import { getPromptApiErrorDetail } from '@/lib/server/prompt-helpers'

type PromptDefaultSelectionDto = { promptId: string }

async function listDefaults(ownerId: string): Promise<Record<string, PromptDefaultSelectionDto>> {
    const records = await prisma.promptDefault.findMany({
        where: {
            ownerId,
            prompt: {
                allowLlmCall: true,
            },
        },
        select: {
            category: true,
            promptId: true,
        },
    })

    const defaults: Record<string, PromptDefaultSelectionDto> = {}
    for (const record of records) {
        const category = normalizeDefaultPromptSelectionCategory(record.category)
        if (!category) continue
        defaults[category] = { promptId: record.promptId }
    }
    return defaults
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const defaults = await listDefaults(user.userId)
        return NextResponse.json({ defaults })
    } catch (error) {
        console.error('List prompt defaults error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}

export async function PUT(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const body = await request.json().catch(() => null)
        const category = normalizeDefaultPromptSelectionCategory(body?.category)
        const promptId = typeof body?.promptId === 'string' ? body.promptId.trim() : ''

        if (!category) {
            return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
        }

        if (!promptId) {
            await prisma.promptDefault.deleteMany({
                where: { ownerId: user.userId, category },
            })
            const defaults = await listDefaults(user.userId)
            return NextResponse.json({ defaults })
        }

        const prompt = await prisma.prompt.findFirst({
            where: {
                id: promptId,
                ownerId: user.userId,
                allowLlmCall: true,
            },
            select: { id: true, category: true },
        })

        if (!prompt) {
            return NextResponse.json({ detail: 'Prompt not found' }, { status: 404 })
        }

        const promptCategory = normalizePromptCategory(prompt.category)
        if (promptCategory !== category) {
            return NextResponse.json({ detail: 'Prompt category mismatch' }, { status: 400 })
        }

        await prisma.promptDefault.upsert({
            where: { ownerId_category: { ownerId: user.userId, category } },
            create: { ownerId: user.userId, category, promptId },
            update: { promptId },
        })

        const defaults = await listDefaults(user.userId)
        return NextResponse.json({ defaults })
    } catch (error) {
        console.error('Update prompt default error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}
