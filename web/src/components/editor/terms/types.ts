import type { RevisionHistoryItem } from '@/lib/revision-history'

export type DefaultTermCategoryId = 'characters' | 'locations' | 'items' | 'lore'
export type PresetTermCategoryId = 'preset_skills' | 'preset_talents' | 'preset_realms'
export type TermCategoryId = DefaultTermCategoryId | PresetTermCategoryId | (string & {})

export type CustomCategoryIcon =
    | { type: 'lucide'; name: string }
    | { type: 'image'; dataUrl: string }

export type CustomTermCategory = {
    id: string
    label: string
    icon?: CustomCategoryIcon
}

export type TermEntryHistoryItem = RevisionHistoryItem

export type TermEntryColorId =
    | 'black'
    | 'gray'
    | 'brown'
    | 'orange'
    | 'yellow'
    | 'green'
    | 'blue'
    | 'purple'
    | 'pink'
    | 'red'

export type TermEntryRelationDirection = 'outgoing' | 'incoming' | 'bidirectional'

export type TermEntryRelation = {
    id: string
    otherId: string
    direction: TermEntryRelationDirection
    label?: string
}

export type TermEntryExternalReference = {
    id: string
    url: string
}

export type TermEntryGalleryItem = {
    id: string
    url: string
}

export type TermEntryAiContextPolicy = 'always' | 'detected' | 'never'
export type TermEntrySortBy = 'name' | 'priority'

export interface TermEntry {
    id: string
    categoryId: TermCategoryId
    title: string
    subtitle?: string
    aliases?: string
    description?: string
    experiences?: string
    history?: TermEntryHistoryItem[]
    tags?: string[]
    color?: TermEntryColorId
    archived?: boolean
    relations?: TermEntryRelation[]
    researchNotes?: string
    researchNotesHistory?: TermEntryHistoryItem[]
    externalReferences?: TermEntryExternalReference[]
    avatar?: string
    avatarCrop?: string
    gallery?: TermEntryGalleryItem[]
    aiContextPolicy?: TermEntryAiContextPolicy
}

export type StoredTerms = {
    entries: TermEntry[]
    expandedCategoryIds?: TermCategoryId[]
    selectedEntryId?: string | null
    customCategories?: CustomTermCategory[]
    enabledPresetCategoryIds?: PresetTermCategoryId[]
    sortBy?: TermEntrySortBy
}

export type TermCategory = {
    id: TermCategoryId
    label: string
    icon: CustomCategoryIcon
    isCustom: boolean
}

export type TermCategoryView = {
    id: TermCategoryId
    label: string
    icon: CustomCategoryIcon
}

export type AnchorRect = {
    top: number
    left: number
    right: number
    bottom: number
    width: number
    height: number
}

export const PRESET_TERM_CATEGORY_IDS: readonly PresetTermCategoryId[] = [
    'preset_skills',
    'preset_talents',
    'preset_realms',
]

export const PRESET_TERM_CATEGORY_ID_SET = new Set<string>(PRESET_TERM_CATEGORY_IDS)
