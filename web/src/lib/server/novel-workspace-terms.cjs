/* eslint-disable @typescript-eslint/no-require-imports */
// Term-state → workspace-projection logic shared between the Next.js server
// (novel-workspace.ts) and the standalone MCP server (opennovelwriter-mcp-server.cjs).
const { buildNovelWorkspaceTermMarkdown } = require('./novel-workspace-projection.cjs')

const DEFAULT_TERM_CATEGORY_IDS = ['characters', 'locations', 'items', 'lore']
const PRESET_TERM_CATEGORY_IDS = ['preset_skills', 'preset_talents', 'preset_realms']

function normalizeTermTitleKey(value) {
    if (typeof value !== 'string') return ''
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function getTermStateEntries(state) {
    if (!state || typeof state !== 'object') return []
    const entries = state.entries
    if (!Array.isArray(entries)) return []
    return entries.filter((entry) => Boolean(entry) && typeof entry === 'object')
}

function getNovelWorkspaceTermFileName(title) {
    const normalized = title
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/^\.+/, '')
        .replace(/[.\s]+$/g, '')
    return `${normalized || 'untitled'}.md`
}

/**
 * Assign a unique, collision-free Markdown file name to each term. Names stay human-friendly
 * (derived from the title, so Codex can grep/`@` them) — when two titles sanitize to the same
 * name (rare), terms are disambiguated by a numeric suffix in a stable id order. Both the
 * workspace projection and the `@term` → path resolver call this so they always agree on a path.
 * Matching is case-insensitive because the projection lives on a case-insensitive filesystem.
 */
function assignUniqueTermFileNames(terms) {
    const result = new Map()
    const used = new Set()
    const ordered = [...terms]
        .filter((term) => term.id && term.title)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const { id, title } of ordered) {
        const base = getNovelWorkspaceTermFileName(title)
        const stem = base.replace(/\.md$/i, '')
        let candidate = base
        let suffix = 2
        while (used.has(candidate.toLowerCase())) {
            candidate = `${stem}-${suffix}.md`
            suffix += 1
        }
        used.add(candidate.toLowerCase())
        result.set(id, candidate)
    }
    return result
}

function getTermCategoryLabel(categoryId, language, state) {
    const normalizedCategoryId = typeof categoryId === 'string' ? categoryId.trim() : ''
    const customCategories = getCustomCategories(state)
    const custom = customCategories.find((category) => category.id === normalizedCategoryId)
    if (custom && custom.label) return custom.label
    if (isChineseLanguage(language)) {
        if (normalizedCategoryId === 'characters') return '角色'
        if (normalizedCategoryId === 'locations') return '地点'
        if (normalizedCategoryId === 'items') return '物品'
        if (normalizedCategoryId === 'lore') return '设定'
        if (normalizedCategoryId === 'preset_skills') return '技能'
        if (normalizedCategoryId === 'preset_talents') return '天赋'
        if (normalizedCategoryId === 'preset_realms') return '境界'
    } else {
        if (normalizedCategoryId === 'characters') return 'Character'
        if (normalizedCategoryId === 'locations') return 'Location'
        if (normalizedCategoryId === 'items') return 'Item'
        if (normalizedCategoryId === 'lore') return 'Lore'
        if (normalizedCategoryId === 'preset_skills') return 'Skills'
        if (normalizedCategoryId === 'preset_talents') return 'Talents'
        if (normalizedCategoryId === 'preset_realms') return 'Realms'
    }
    return normalizedCategoryId || 'Term'
}

function getCustomCategories(state) {
    const parsed = state && typeof state === 'object' ? state.customCategories : null
    if (!Array.isArray(parsed)) return []
    return parsed
        .filter((category) => {
            if (!category || typeof category !== 'object') return false
            return typeof category.id === 'string' && typeof category.label === 'string'
        })
        .map((category) => ({ id: category.id.trim(), label: category.label.trim() }))
        .filter((category) => Boolean(category.id))
}

function getEnabledPresetCategoryIds(state) {
    const parsed = state && typeof state === 'object' ? state.enabledPresetCategoryIds : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => PRESET_TERM_CATEGORY_IDS.includes(id))
}

function buildTermProjectionSnapshots(input) {
    const entries = getTermStateEntries(input.state)
    const activeEntries = entries.filter((entry) => entry.archived !== true)
    const categoryLabelById = new Map()
    for (const entry of entries) {
        const categoryId = typeof entry.categoryId === 'string' && entry.categoryId.trim() ? entry.categoryId.trim() : ''
        if (!categoryId || categoryLabelById.has(categoryId)) continue
        categoryLabelById.set(categoryId, getTermCategoryLabel(entry.categoryId, input.language, input.state))
    }

    const titleById = new Map()
    for (const entry of entries) {
        const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : ''
        const title = typeof entry.title === 'string' ? entry.title.trim() : ''
        if (!id || !title) continue
        titleById.set(id, title)
    }

    const fileNameById = assignUniqueTermFileNames(
        activeEntries.map((entry) => ({
            id: typeof entry.id === 'string' ? entry.id.trim() : '',
            title: typeof entry.title === 'string' ? entry.title.trim() : '',
        }))
    )

    return activeEntries
        .map((entry) => {
            const id = typeof entry.id === 'string' ? entry.id.trim() : ''
            const title = typeof entry.title === 'string' ? entry.title.trim() : ''
            const categoryId = typeof entry.categoryId === 'string' && entry.categoryId.trim() ? entry.categoryId.trim() : 'characters'
            if (!id || !title) return null

            const fileName = fileNameById.get(id) ?? getNovelWorkspaceTermFileName(title)
            const categoryLabel = categoryLabelById.get(categoryId) ?? categoryId
            const term = {
                id,
                title,
                categoryId,
                categoryLabel,
                subtitle: normalizeTextValue(entry.subtitle),
                aliases: normalizeTextValue(entry.aliases),
                description: normalizeTextValue(entry.description),
                experiences: normalizeTextValue(entry.experiences),
                researchNotes: normalizeTextValue(entry.researchNotes),
                externalReferences: normalizeExternalReferences(entry.externalReferences),
                relations: normalizeRelations(entry.relations, titleById),
                aiContextPolicy: normalizeTermTrackingPolicy(entry.aiContextPolicy),
                color: normalizeTextValue(entry.color),
                tags: normalizeTagList(entry.tags),
            }
            const markdown = buildNovelWorkspaceTermMarkdown({
                novelId: input.novelId,
                language: input.language,
                term,
            })
            return {
                term,
                fileName,
                markdown,
            }
        })
        .filter(Boolean)
}

function normalizeTextValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeExternalReferences(raw) {
    if (!Array.isArray(raw)) return []
    const items = []
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const url = typeof item.url === 'string' ? item.url.trim() : ''
        if (!url) continue
        const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `term_ref_${items.length}`
        items.push({ id, url })
    }
    return items
}

function normalizeRelations(raw, titleById) {
    if (!Array.isArray(raw)) return []
    const items = []
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const otherId = typeof item.otherId === 'string' ? item.otherId.trim() : ''
        if (!otherId) continue
        const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `term_rel_${items.length}`
        const direction = typeof item.direction === 'string' && item.direction.trim() ? item.direction.trim() : 'outgoing'
        const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : null
        items.push({
            id,
            otherId,
            otherTitle: titleById.get(otherId) ?? otherId,
            direction,
            label,
        })
    }
    return items
}

function normalizeTermTrackingPolicy(value) {
    if (value === 'always' || value === 'never') return value
    return 'detected'
}

function normalizeTagList(raw) {
    if (!Array.isArray(raw)) return []
    const seen = new Set()
    const items = []
    for (const value of raw) {
        const item = typeof value === 'string' ? value.trim() : ''
        if (!item) continue
        const key = item.toLocaleLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
    }
    return items
}

function isChineseLanguage(language) {
    return typeof language === 'string' && language.trim().toLowerCase().startsWith('zh')
}

module.exports = {
    DEFAULT_TERM_CATEGORY_IDS,
    PRESET_TERM_CATEGORY_IDS,
    normalizeTermTitleKey,
    getTermStateEntries,
    getNovelWorkspaceTermFileName,
    assignUniqueTermFileNames,
    getTermCategoryLabel,
    getCustomCategories,
    getEnabledPresetCategoryIds,
    buildTermProjectionSnapshots,
}
