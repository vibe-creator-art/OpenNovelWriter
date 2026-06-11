import { prisma } from '@/lib/db'
import { normalizePromptCategory } from '@/lib/prompts'

function toNameKey(name: string) {
    return name.trim().toLowerCase()
}

export async function loadPromptNameKeys(params: { ownerId: string; category?: string; excludeId?: string }) {
    const normalizedCategory = params.category ? normalizePromptCategory(params.category) : null
    const records = await prisma.prompt.findMany({
        where: {
            ownerId: params.ownerId,
            ...(normalizedCategory ? { category: normalizedCategory } : {}),
            ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
        },
        select: { name: true },
    })

    const keys = new Set<string>()
    for (const record of records) {
        const key = toNameKey(record.name ?? '')
        if (key) keys.add(key)
    }
    return keys
}

export function getNextAvailableNumberedPromptName(baseName: string, existingKeys: Set<string>) {
    const trimmed = baseName.trim()
    const base = trimmed || 'Untitled'
    if (!existingKeys.has(toNameKey(base))) return base

    for (let i = 1; i < 10_000; i++) {
        const candidate = `${base} ${i}`
        if (!existingKeys.has(toNameKey(candidate))) return candidate
    }

    return `${base} ${Date.now()}`
}

export function promptNameKeyEquals(a: string, b: string) {
    return toNameKey(a) === toNameKey(b)
}

export function toPromptNameKey(name: string) {
    return toNameKey(name)
}
