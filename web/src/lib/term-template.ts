import type { CustomTermCategory, TermCategoryId, TermEntry } from '@/components/editor/terms/types'

type SupportedLocale = 'zh' | 'en'

const PRESET_CATEGORY_LABELS: Record<SupportedLocale, Record<string, string>> = {
    zh: {
        characters: '角色',
        locations: '地点',
        items: '物品',
        lore: '设定',
        preset_skills: '技能',
        preset_talents: '天赋',
        preset_realms: '境界',
    },
    en: {
        characters: 'Character',
        locations: 'Location',
        items: 'Item',
        lore: 'Lore',
        preset_skills: 'Skills',
        preset_talents: 'Talents',
        preset_realms: 'Realms',
    },
}

function normalizeLocale(locale: string | null | undefined): SupportedLocale {
    return locale?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

function splitAliases(raw: string | undefined) {
    if (!raw) return []
    return raw
        .split(/[,\uFF0C\u3001;\uFF1B\n]/g)
        .map((part) => part.trim())
        .filter(Boolean)
}

export function splitTermExperiences(raw: string | undefined) {
    if (!raw) return []
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
}

export function getTermCategoryLabel(params: {
    categoryId: TermCategoryId
    locale?: string | null
    customCategories?: readonly CustomTermCategory[] | null | undefined
}) {
    const custom = params.customCategories?.find((item) => item.id === params.categoryId) ?? null
    if (custom?.label?.trim()) return custom.label.trim()

    const locale = normalizeLocale(params.locale)
    return PRESET_CATEGORY_LABELS[locale][params.categoryId] ?? String(params.categoryId)
}

export function renderTermTemplateText(entry: TermEntry | null) {
    if (!entry || entry.archived) return ''
    return entry.title?.trim() ?? ''
}

export function renderTermTemplateValue(params: {
    entry: TermEntry | null
    locale?: string | null
    customCategories?: readonly CustomTermCategory[] | null | undefined
}) {
    const { entry } = params
    if (!entry || entry.archived) return ''

    const title = entry.title?.trim() ?? ''
    if (!title) return ''

    const separator = normalizeLocale(params.locale) === 'en' ? ', ' : '，'
    const categoryLabel = getTermCategoryLabel({
        categoryId: entry.categoryId,
        locale: params.locale,
        customCategories: params.customCategories,
    })
    const aliases = splitAliases(entry.aliases)
    const openTag = `<${categoryLabel}${separator}${['name=' + title, ...aliases].join(separator)}>`
    const experiences = splitTermExperiences(entry.experiences)
    const experiencesBlock = experiences.length
        ? [normalizeLocale(params.locale) === 'en' ? 'Experiences:' : '经历：', ...experiences.map((item) => `- ${item}`)].join('\n')
        : ''
    const body = [entry.subtitle?.trim(), entry.description?.trim(), experiencesBlock, entry.researchNotes?.trim()].filter(Boolean)

    return [openTag, ...body, `</${categoryLabel}>`].join('\n').trim()
}

export function resolveTrackedTermIds(params: {
    mentionedTermIds: Iterable<string> | null | undefined
    termsById: ReadonlyMap<string, TermEntry>
}) {
    const out: string[] = []
    const seen = new Set<string>()

    for (const rawId of params.mentionedTermIds ?? []) {
        const id = typeof rawId === 'string' ? rawId.trim() : ''
        if (!id || seen.has(id)) continue

        const entry = params.termsById.get(id) ?? null
        const policy = entry?.aiContextPolicy ?? 'detected'
        if (!entry || entry.archived || policy === 'never') continue

        seen.add(id)
        out.push(id)
    }

    const alwaysIncluded = [...params.termsById.values()]
        .filter((entry) => !entry.archived && (entry.aiContextPolicy ?? 'detected') === 'always' && !seen.has(entry.id))
        .sort((left, right) => {
            const leftTitle = left.title?.trim() ?? left.id
            const rightTitle = right.title?.trim() ?? right.id
            return leftTitle.localeCompare(rightTitle, undefined, { sensitivity: 'base' })
        })

    for (const entry of alwaysIncluded) {
        seen.add(entry.id)
        out.push(entry.id)
    }

    return out
}
