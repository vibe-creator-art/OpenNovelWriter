import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { getPromptApiErrorDetail, toPromptDto } from '@/lib/server/prompt-helpers'
import { normalizePromptCategory } from '@/lib/prompts'
import { getNextAvailableNumberedPromptName, loadPromptNameKeys } from '@/lib/server/prompt-names'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
        const source = await prisma.prompt.findFirst({
            where: { id, ownerId: user.userId },
        })

        if (!source) {
            return NextResponse.json({ detail: 'Prompt not found' }, { status: 404 })
        }

        const existingKeys = await loadPromptNameKeys({ ownerId: user.userId })
        const cloneName = getNextAvailableNumberedPromptName(source.name, existingKeys)

        const prompt = await prisma.prompt.create({
            data: {
                name: cloneName,
                category: normalizePromptCategory(source.category) ?? source.category,
                messagesJson: source.messagesJson,
                inputsJson: (source as { inputsJson?: string | null }).inputsJson ?? '[]',
                modelGroupIdsJson: (source as { modelGroupIdsJson?: string | null }).modelGroupIdsJson ?? '[]',
                modelSetIdsJson: (source as { modelSetIdsJson?: string | null }).modelSetIdsJson ?? '[]',
                allowLlmCall: source.category === 'component' ? false : Boolean(source.allowLlmCall),
                allowAgentCall: source.category === 'component' ? false : Boolean(source.allowAgentCall),
                agentCallMode: source.agentCallMode,
                description: source.description,
                isNsfw: Boolean(source.isNsfw),
                ownerId: user.userId,
            },
        })

        return NextResponse.json({ prompt: toPromptDto(prompt) }, { status: 201 })
    } catch (error) {
        console.error('Clone prompt error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}
