import NextImage from 'next/image'
import { cn } from '@/lib/utils'
import { coerceRevisionHistoryItems } from '@/lib/revision-history'
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic.mjs'
import {
    PRESET_TERM_CATEGORY_ID_SET,
    type AnchorRect,
    type CustomCategoryIcon,
    type StoredTerms,
    type TermEntryExternalReference,
    type TermEntryGalleryItem,
    type TermEntryRelation,
    type TermEntryRelationDirection,
} from '@/components/editor/terms/types'
import { coerceTermEntryColorId } from '@/components/editor/terms/term-entry-colors'

const ICON_NAME_SET = new Set<string>(iconNames as unknown as string[])
const AI_CONTEXT_POLICY_SET = new Set<string>(['always', 'detected', 'never'])
const TERM_SORT_BY_SET = new Set<string>(['name', 'priority'])

const TERM_ICON_PRESET_CANDIDATES: string[] = [
    'badge',
    'binoculars',
    'book',
    'book-a',
    'book-copy',
    'book-open',
    'book-text',
    'bookmark',
    'brain',
    'briefcase',
    'building',
    'calendar',
    'camera',
    'candy',
    'castle',
    'cat',
    'chef-hat',
    'clapperboard',
    'cloud',
    'code',
    'compass',
    'cookie',
    'crown',
    'diamond',
    'dice-6',
    'drama',
    'dumbbell',
    'feather',
    'fingerprint',
    'flame',
    'flower',
    'gem',
    'ghost',
    'globe',
    'hammer',
    'heart',
    'home',
    'hotel',
    'inbox',
    'key',
    'landmark',
    'leaf',
    'lightbulb',
    'lock',
    'magic-wand',
    'mail',
    'map',
    'map-pin',
    'medal',
    'megaphone',
    'microscope',
    'milestone',
    'moon',
    'mountain',
    'music',
    'palette',
    'paw-print',
    'pen-line',
    'pickaxe',
    'pizza',
    'planet',
    'puzzle',
    'rocket',
    'scroll-text',
    'search',
    'shield',
    'ship',
    'skull',
    'sparkles',
    'sprout',
    'star',
    'sun',
    'sword',
    'tag',
    'tent-tree',
    'theater',
    'ticket',
    'torus',
    'trophy',
    'user-round',
    'users',
    'wand',
    'wrench',
]

export const TERM_ICON_PRESETS: IconName[] = TERM_ICON_PRESET_CANDIDATES.filter((name) => ICON_NAME_SET.has(name)) as IconName[]

export function safeParseTerms(raw: unknown): StoredTerms | null {
    if (!raw) return null
    try {
        const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as StoredTerms
        if (!parsed || typeof parsed !== 'object') return null
        if (!Array.isArray(parsed.entries)) return null
        if (parsed.customCategories && !Array.isArray(parsed.customCategories)) return null
        if (parsed.enabledPresetCategoryIds && !Array.isArray(parsed.enabledPresetCategoryIds)) return null
        if (parsed.enabledPresetCategoryIds) {
            parsed.enabledPresetCategoryIds = parsed.enabledPresetCategoryIds.filter((id) => PRESET_TERM_CATEGORY_ID_SET.has(id))
        }

        // Migrate older persisted shapes to the current schema.
        for (const entry of parsed.entries as unknown as Record<string, unknown>[]) {
            if (!entry || typeof entry !== 'object') continue
            const maybeHistory = entry.history
            if (Array.isArray(maybeHistory)) {
                entry.history = coerceRevisionHistoryItems(maybeHistory, { idPrefix: 'term' })
            }
            const maybeNotesHistory = entry.researchNotesHistory
            if (Array.isArray(maybeNotesHistory)) {
                entry.researchNotesHistory = coerceRevisionHistoryItems(maybeNotesHistory, { idPrefix: 'term' })
            }
            const maybeExternal = entry.externalReferences
            if (Array.isArray(maybeExternal)) {
                entry.externalReferences = coerceExternalReferences(maybeExternal)
            }
            const maybeTags = entry.tags
            const nextTags = coerceTags(maybeTags)
            if (nextTags) entry.tags = nextTags
            else delete entry.tags

            const maybeColor = entry.color
            const nextColor = coerceTermEntryColorId(maybeColor)
            if (nextColor) entry.color = nextColor
            else delete entry.color

            const maybeArchived = entry.archived
            if (typeof maybeArchived === 'boolean') entry.archived = maybeArchived
            else delete entry.archived

            const maybeRelations = entry.relations
            const nextRelations = coerceRelations(maybeRelations)
            if (nextRelations) entry.relations = nextRelations
            else delete entry.relations

            const nextGallery = coerceGalleryItems(entry.gallery)
            if (nextGallery) entry.gallery = nextGallery
            else delete entry.gallery

            const maybeAiContextPolicy = entry.aiContextPolicy
            if (typeof maybeAiContextPolicy === 'string' && AI_CONTEXT_POLICY_SET.has(maybeAiContextPolicy)) {
                entry.aiContextPolicy = maybeAiContextPolicy
            } else {
                delete entry.aiContextPolicy
            }
        }

        const maybeSortBy = (parsed as unknown as Record<string, unknown>).sortBy
        if (typeof maybeSortBy === 'string' && TERM_SORT_BY_SET.has(maybeSortBy)) {
            ; (parsed as unknown as Record<string, unknown>).sortBy = maybeSortBy
        } else {
            delete (parsed as unknown as Record<string, unknown>).sortBy
        }

        return parsed
    } catch {
        return null
    }
}

export function createId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export function normalizeCategoryName(name: string) {
    return name.trim().toLocaleLowerCase()
}

function coerceExternalReferences(rawItems: unknown[]): TermEntryExternalReference[] {
    const items: TermEntryExternalReference[] = []
    for (const raw of rawItems) {
        if (typeof raw === 'string') {
            items.push({ id: createId(), url: raw })
            continue
        }
        if (!raw || typeof raw !== 'object') continue
        const record = raw as Record<string, unknown>
        const url = typeof record.url === 'string' ? record.url : ''
        if (!url) continue
        const id = typeof record.id === 'string' && record.id.trim() ? record.id : createId()
        items.push({ id, url })
    }
    return items
}

function coerceGalleryItems(raw: unknown): TermEntryGalleryItem[] | null {
    if (!Array.isArray(raw)) return null
    const seenUrls = new Set<string>()
    const items: TermEntryGalleryItem[] = []
    for (const candidate of raw) {
        if (!candidate || typeof candidate !== 'object') continue
        const record = candidate as Record<string, unknown>
        const url = typeof record.url === 'string' ? record.url.trim() : ''
        if (!url || seenUrls.has(url)) continue
        seenUrls.add(url)
        const id = typeof record.id === 'string' && record.id.trim() ? record.id : createId()
        items.push({ id, url })
    }
    return items.length ? items : null
}

const RELATION_DIRECTION_SET = new Set<string>(['outgoing', 'incoming', 'bidirectional'])

function coerceRelations(raw: unknown): TermEntryRelation[] | null {
    if (!Array.isArray(raw)) return null
    const items: TermEntryRelation[] = []
    for (const candidate of raw) {
        if (!candidate || typeof candidate !== 'object') continue
        const record = candidate as Record<string, unknown>
        const id = typeof record.id === 'string' && record.id.trim() ? record.id : createId()
        const otherId = typeof record.otherId === 'string' ? record.otherId : ''
        if (!otherId) continue
        const directionRaw = typeof record.direction === 'string' ? record.direction : ''
        const direction: TermEntryRelationDirection = RELATION_DIRECTION_SET.has(directionRaw)
            ? (directionRaw as TermEntryRelationDirection)
            : 'outgoing'
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        const relation: TermEntryRelation = { id, otherId, direction }
        if (label) relation.label = label
        items.push(relation)
    }
    return items.length ? items.slice(0, 200) : null
}

function coerceTags(raw: unknown): string[] | null {
    if (Array.isArray(raw)) {
        const strings = raw.filter((value): value is string => typeof value === 'string')
        const normalized = normalizeTagList(strings)
        return normalized.length ? normalized : null
    }
    if (typeof raw === 'string') {
        const normalized = parseTagsInput(raw)
        return normalized.length ? normalized : null
    }
    return null
}

export function normalizeTagKey(tag: string) {
    return tag.trim().toLocaleLowerCase()
}

export function normalizeTagList(tags: readonly string[] | null | undefined): string[] {
    if (!tags || !Array.isArray(tags)) return []
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const rawTag of tags) {
        const tag = rawTag.trim()
        if (!tag) continue
        const key = normalizeTagKey(tag)
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push(tag)
    }
    return normalized
}

export function parseTagsInput(input: string): string[] {
    if (!input) return []
    const parts = input
        .split(/[,，]/g)
        .map((part) => part.trim())
        .filter(Boolean)
    return normalizeTagList(parts)
}

export function mergeTags(existing: readonly string[] | null | undefined, toAdd: readonly string[] | null | undefined): string[] {
    return normalizeTagList([...(existing ?? []), ...(toAdd ?? [])])
}

export function renderIconSpec(icon: CustomCategoryIcon | undefined, className: string, fallbackName: IconName = 'shapes') {
    if (icon?.type === 'image') {
        return <NextImage alt="" src={icon.dataUrl} width={32} height={32} unoptimized className={cn('object-cover', className)} />
    }
    const name = icon?.type === 'lucide' && ICON_NAME_SET.has(icon.name) ? (icon.name as IconName) : fallbackName
    return <DynamicIcon name={name} className={className} />
}

export function normalizeExternalUrl(input: string): string | null {
    const trimmed = input.trim()
    if (!trimmed) return null

    const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        const url = new URL(withScheme)
        if (!url.hostname) return null
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

        const origin = `${url.protocol}//${url.host}`
        const hasRootPath = url.pathname === '/' || url.pathname === ''
        const shouldDropPath = hasRootPath && !url.search && !url.hash
        const pathPart = shouldDropPath ? '' : url.pathname
        const full = `${origin}${pathPart}${url.search}${url.hash}`
        return full.endsWith('/') ? full.slice(0, -1) : full
    } catch {
        return null
    }
}

export function formatExternalUrlForDisplay(input: string): string {
    const normalized = normalizeExternalUrl(input) ?? input.trim()
    if (!normalized) return ''

    const withScheme = normalized.includes('://') ? normalized : `https://${normalized}`
    try {
        const url = new URL(withScheme)
        let display = url.host
        if (url.pathname && url.pathname !== '/') display += url.pathname
        if (url.search) display += url.search
        if (url.hash) display += url.hash
        if (display.endsWith('/')) display = display.slice(0, -1)
        return display
    } catch {
        return normalized.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
}

export function getExternalFaviconUrl(input: string, size = 64): string | null {
    const normalized = normalizeExternalUrl(input)
    if (!normalized) return null
    try {
        const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`)
        return `https://www.google.com/s2/favicons?sz=${encodeURIComponent(String(size))}&domain=${encodeURIComponent(url.hostname)}`
    } catch {
        return null
    }
}

export async function cropImageFileToSquareDataUrl(file: File, size: number) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(file)
    })

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = dataUrl
    })

    const srcSize = Math.min(image.naturalWidth, image.naturalHeight)
    const sx = Math.max(0, Math.floor((image.naturalWidth - srcSize) / 2))
    const sy = Math.max(0, Math.floor((image.naturalHeight - srcSize) / 2))

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to create canvas')

    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, size, size)
    return canvas.toDataURL('image/png')
}

export function countWords(text: string): number {
    if (!text || text.trim() === '') return 0

    const plainText = text.replace(/\s+/g, ' ').trim()
    if (!plainText) return 0

    const chineseChars = plainText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0
    const englishWords = plainText
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length
    return chineseChars + englishWords
}

export function getAnchorRect(element: HTMLElement): AnchorRect {
    const rect = element.getBoundingClientRect()
    return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
    }
}
