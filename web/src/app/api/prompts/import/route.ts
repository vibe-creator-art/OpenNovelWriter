import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizePromptAgentCallMode, normalizePromptCategory, type PromptAgentCallMode, type PromptCategory } from '@/lib/prompts'
import { normalizePromptInputs } from '@/lib/prompt-inputs'
import { getPromptApiErrorDetail, normalizeIncomingMessages, toPromptDto } from '@/lib/server/prompt-helpers'
import { loadPromptNameKeys, toPromptNameKey } from '@/lib/server/prompt-names'

type ImportPromptPayload = {
    name: string
    category: PromptCategory
    description: string | null
    messages: unknown
    inputs: unknown
    isNsfw: boolean
    modelGroupIds: string[] | undefined
    modelSetIds: string[] | undefined
    allowLlmCall: boolean
    allowAgentCall: boolean
    agentCallMode: PromptAgentCallMode
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
        const promptsRaw = body?.prompts
        const overwriteExisting = body?.overwriteExisting === true
        if (!Array.isArray(promptsRaw) || promptsRaw.length === 0) {
            return NextResponse.json({ detail: 'Invalid prompts' }, { status: 400 })
        }

        const imported: ImportPromptPayload[] = []
        for (const item of promptsRaw) {
            const obj = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
            const name = typeof obj.name === 'string' ? obj.name.trim() : ''
            const categoryRaw = typeof obj.category === 'string' ? obj.category : ''
            const category = normalizePromptCategory(categoryRaw)
            const description = obj.description === null ? null : typeof obj.description === 'string' ? obj.description : null
            const inputsRaw = obj.inputs
            const isNsfw = obj.isNsfw === true
            const modelGroupIds = normalizeStringIdList(obj.modelGroupIds)
            const modelSetIds = normalizeStringIdList(obj.modelSetIds)
            const allowLlmCall = category === 'component' ? false : obj.allowLlmCall === true
            const allowAgentCall = category === 'component' ? false : obj.allowAgentCall === true
            const agentCallMode = normalizePromptAgentCallMode(obj.agentCallMode)

            if (!name) return NextResponse.json({ detail: 'Name is required' }, { status: 400 })
            if (!category) return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
            if (inputsRaw !== undefined && !Array.isArray(inputsRaw)) {
                return NextResponse.json({ detail: 'Invalid inputs' }, { status: 400 })
            }
            if (modelGroupIds === null) {
                return NextResponse.json({ detail: 'Invalid modelGroupIds' }, { status: 400 })
            }
            if (modelSetIds === null) {
                return NextResponse.json({ detail: 'Invalid modelSetIds' }, { status: 400 })
            }

            imported.push({
                name,
                category,
                description,
                messages: obj.messages,
                inputs: inputsRaw ?? [],
                isNsfw,
                modelGroupIds,
                modelSetIds,
                allowLlmCall,
                allowAgentCall,
                agentCallMode,
            })
        }

        const existingKeys = await loadPromptNameKeys({ ownerId: user.userId })
        const incomingKeys = new Set<string>()
        const duplicateIncomingNames: string[] = []
        const conflictingNames: string[] = []

        for (const prompt of imported) {
            const key = toPromptNameKey(prompt.name)
            if (!key) continue
            if (incomingKeys.has(key)) duplicateIncomingNames.push(prompt.name)
            incomingKeys.add(key)
            if (existingKeys.has(key)) conflictingNames.push(prompt.name)
        }

        if (duplicateIncomingNames.length > 0) {
            const unique = [...new Set(duplicateIncomingNames.map((n) => n.trim()).filter(Boolean))]
            return NextResponse.json(
                {
                    detail: 'Duplicate prompt names in bundle',
                    code: 'PROMPT_BUNDLE_DUPLICATE_NAMES',
                    names: unique,
                },
                { status: 400 }
            )
        }

        if (conflictingNames.length > 0 && !overwriteExisting) {
            const unique = [...new Set(conflictingNames.map((n) => n.trim()).filter(Boolean))]
            const list = unique.slice(0, 8).join(', ')
            const suffix = unique.length > 8 ? ` (+${unique.length - 8} more)` : ''
            return NextResponse.json(
                {
                    detail: `Prompt name already exists: ${list}${suffix}`,
                    code: 'PROMPT_NAME_ALREADY_EXISTS',
                    names: unique,
                },
                { status: 409 }
            )
        }

        const prepared: Array<{
            name: string
            category: PromptCategory
            description: string | null
            messagesJson: string
            inputsJson: string
            isNsfw: boolean
            modelGroupIdsJson: string
            modelSetIdsJson: string
            allowLlmCall: boolean
            allowAgentCall: boolean
            agentCallMode: PromptAgentCallMode
        }> = []

        for (const prompt of imported) {
            const normalized = normalizeIncomingMessages({
                category: prompt.category,
                messages: prompt.messages,
            })
            if (!normalized.ok) {
                return NextResponse.json({ detail: normalized.detail }, { status: 400 })
            }

            const inputs = normalizePromptInputs(prompt.inputs)
            prepared.push({
                name: prompt.name,
                category: prompt.category,
                description: prompt.description,
                messagesJson: JSON.stringify(normalized.messages),
                inputsJson: JSON.stringify(inputs),
                isNsfw: prompt.isNsfw,
                modelGroupIdsJson: JSON.stringify(prompt.modelGroupIds ?? []),
                modelSetIdsJson: JSON.stringify(prompt.modelSetIds ?? []),
                allowLlmCall: prompt.allowLlmCall,
                allowAgentCall: prompt.allowAgentCall,
                agentCallMode: prompt.agentCallMode,
            })
        }

        const records = await prisma.$transaction(async (tx) => {
            const nameKeys = prepared.map((prompt) => toPromptNameKey(prompt.name)).filter(Boolean)
            const existingRecords = overwriteExisting && nameKeys.length > 0
                ? await tx.prompt.findMany({
                    where: {
                        ownerId: user.userId,
                        name: { in: prepared.map((prompt) => prompt.name) },
                    },
                })
                : []
            const existingByNameKey = new Map(existingRecords.map((record) => [toPromptNameKey(record.name), record]))

            const created = []
            for (const prompt of prepared) {
                const nameKey = toPromptNameKey(prompt.name)
                const existing = nameKey ? existingByNameKey.get(nameKey) ?? null : null
                const record = existing
                    ? await tx.prompt.update({
                        where: { id: existing.id },
                        data: {
                            name: prompt.name,
                            category: prompt.category,
                            description: prompt.description,
                            messagesJson: prompt.messagesJson,
                            inputsJson: prompt.inputsJson,
                            modelGroupIdsJson: prompt.modelGroupIdsJson,
                            modelSetIdsJson: prompt.modelSetIdsJson,
                            allowLlmCall: prompt.allowLlmCall,
                            allowAgentCall: prompt.allowAgentCall,
                            agentCallMode: prompt.agentCallMode,
                            isNsfw: prompt.isNsfw,
                        },
                    })
                    : await tx.prompt.create({
                        data: {
                            name: prompt.name,
                            category: prompt.category,
                            description: prompt.description,
                            messagesJson: prompt.messagesJson,
                            inputsJson: prompt.inputsJson,
                            modelGroupIdsJson: prompt.modelGroupIdsJson,
                            modelSetIdsJson: prompt.modelSetIdsJson,
                            allowLlmCall: prompt.allowLlmCall,
                            allowAgentCall: prompt.allowAgentCall,
                            agentCallMode: prompt.agentCallMode,
                            isNsfw: prompt.isNsfw,
                            ownerId: user.userId,
                        },
                    })
                created.push(record)
            }
            return created
        })

        return NextResponse.json({ prompts: records.map(toPromptDto) }, { status: 201 })
    } catch (error) {
        console.error('Import prompts error:', error)
        return NextResponse.json({ detail: getPromptApiErrorDetail(error) }, { status: 500 })
    }
}
