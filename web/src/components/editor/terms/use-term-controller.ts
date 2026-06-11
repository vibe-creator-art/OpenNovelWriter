import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
    AnchorRect,
    CustomCategoryIcon,
    CustomTermCategory,
    PresetTermCategoryId,
    StoredTerms,
    TermCategory,
    TermCategoryId,
    TermEntry,
    TermEntrySortBy,
    TermEntryRelation,
    TermEntryRelationDirection,
} from '@/components/editor/terms/types'
import { PRESET_TERM_CATEGORY_ID_SET } from '@/components/editor/terms/types'
import { getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import {
    TERM_GALLERY_UPDATED_EVENT,
    useTermEntriesStore,
    type TermGalleryUpdatedDetail,
} from '@/components/editor/terms/term-entries-store'
import {
    TERM_ICON_PRESETS,
    createId,
    cropImageFileToSquareDataUrl,
    getAnchorRect,
    normalizeCategoryName,
    normalizeTagKey,
    safeParseTerms,
} from '@/components/editor/terms/utils'
import { termsApi } from '@/lib/api'
import {
    NOVEL_REFRESH_REQUESTED_EVENT,
    type NovelRefreshRequestedEventDetail,
} from '@/lib/novel-refresh-events'
import type { TermEntryPanelTab } from '@/components/editor/terms/term-entry-events'
import { useAuthStore } from '@/lib/store'
import { recordRevisionHistory } from '@/lib/revision-history'
import { normalizeTermTitleKey } from '@/lib/term-state'

type UseTermControllerParams = {
    novelId?: string
    locale?: string
    defaultCategoryLabels: {
        characters: string
        locations: string
        items: string
        lore: string
    }
    presetCategoryLabels: {
        skills: string
        talents: string
        realms: string
    }
    customCategoryErrorLabels: {
        reservedNameHint: string
        alreadyExists: string
    }
    createErrorLabels: {
        duplicateTitle: string
    }
}

type IconPickerTarget = { kind: 'new' } | { kind: 'existing'; id: string }

type TermState = {
    entries: TermEntry[]
    expandedCategoryIds: Set<TermCategoryId>
    selectedEntryId: string | null
    customCategories: CustomTermCategory[]
    enabledPresetCategoryIds: PresetTermCategoryId[]
    sortBy: TermEntrySortBy
}

export type TermEntryFilters = {
    hasRelations: boolean
    hasNotes: boolean
    hasDescription: boolean
    hasThumbnail: boolean
    hasTags: boolean
    alwaysInclude: boolean
    neverInclude: boolean
    tagKeys: string[]
    typeCategoryIds: TermCategoryId[]
}

const DEFAULT_TERM_ENTRY_FILTERS: TermEntryFilters = {
    hasRelations: false,
    hasNotes: false,
    hasDescription: false,
    hasThumbnail: false,
    hasTags: false,
    alwaysInclude: false,
    neverInclude: false,
    tagKeys: [],
    typeCategoryIds: [],
}

export function useTermController({
    novelId,
    locale,
    defaultCategoryLabels,
    presetCategoryLabels,
    customCategoryErrorLabels,
    createErrorLabels,
}: UseTermControllerParams) {
    const token = useAuthStore((s) => s.token)
    const isHydrated = useAuthStore((s) => s.isHydrated)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null)
    const mentionsSignatureRef = useRef<string>('')
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
    const pendingSaveRef = useRef<StoredTerms | null>(null)
    const hasLoadedFromServerRef = useRef(false)
    const skipNextPersistRef = useRef(false)

    const setMentionEntries = useTermEntriesStore((s) => s.setEntries)
    const setMentionEntriesStatus = useTermEntriesStore((s) => s.setStatus)
    const setMentionMeta = useTermEntriesStore((s) => s.setMeta)

    const [termState, setTermState] = useState<TermState>(() => {
        return {
            entries: [] as TermEntry[],
            expandedCategoryIds: new Set<TermCategoryId>(['characters']),
            selectedEntryId: null,
            customCategories: [] as CustomTermCategory[],
            enabledPresetCategoryIds: [] as PresetTermCategoryId[],
            sortBy: 'name',
        }
    })

    const [searchQuery, setSearchQuery] = useState('')
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const isSearching = normalizedQuery.length > 0

    const [filters, setFilters] = useState<TermEntryFilters>(() => DEFAULT_TERM_ENTRY_FILTERS)
    const filterActiveCount = useMemo(() => {
        return (
            (filters.hasRelations ? 1 : 0) +
            (filters.hasNotes ? 1 : 0) +
            (filters.hasDescription ? 1 : 0) +
            (filters.hasThumbnail ? 1 : 0) +
            (filters.hasTags ? 1 : 0) +
            (filters.alwaysInclude ? 1 : 0) +
            (filters.neverInclude ? 1 : 0) +
            filters.tagKeys.length +
            filters.typeCategoryIds.length
        )
    }, [filters])
    const isFiltering = filterActiveCount > 0

    const [createOpen, setCreateOpen] = useState(false)
    const [createTitle, setCreateTitle] = useState('')
    const [createSubtitle, setCreateSubtitle] = useState('')
    const [createCategoryId, setCreateCategoryId] = useState<TermCategoryId>('characters')
    const [createError, setCreateError] = useState<string | null>(null)

    const [customCategoriesOpen, setCustomCategoriesOpen] = useState(false)
    const [presetCategoriesOpen, setPresetCategoriesOpen] = useState(false)
    const [customTemplatesOpen, setCustomTemplatesOpen] = useState(false)
    const [customCategoryName, setCustomCategoryName] = useState('')
    const [customCategoryError, setCustomCategoryError] = useState<string | null>(null)
    const [newCustomCategoryIcon, setNewCustomCategoryIcon] = useState<CustomCategoryIcon>({
        type: 'lucide',
        name: 'shapes',
    })

    const [iconPickerOpen, setIconPickerOpen] = useState(false)
    const [iconPickerQuery, setIconPickerQuery] = useState('')
    const [iconPickerTarget, setIconPickerTarget] = useState<IconPickerTarget | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleteTargetEntryId, setDeleteTargetEntryId] = useState<string | null>(null)
    const iconUploadRef = useRef<HTMLInputElement | null>(null)

    const [panelInitialTab, setPanelInitialTab] = useState<TermEntryPanelTab>('details')

    const nameCollator = useMemo(
        () =>
            new Intl.Collator(locale ? [locale, 'zh-Hans', 'zh', 'en'] : undefined, {
                numeric: true,
                sensitivity: 'base',
            }),
        [locale]
    )

    const isLatinLeading = (value: string) => /^[A-Za-z0-9]/.test(value.trim())

    const defaultCategories = useMemo(
        () =>
            [
                {
                    id: 'characters' as const,
                    label: defaultCategoryLabels.characters,
                    icon: { type: 'lucide' as const, name: 'user-round' },
                },
                {
                    id: 'locations' as const,
                    label: defaultCategoryLabels.locations,
                    icon: { type: 'lucide' as const, name: 'map-pin' },
                },
                {
                    id: 'items' as const,
                    label: defaultCategoryLabels.items,
                    icon: { type: 'lucide' as const, name: 'shapes' },
                },
                {
                    id: 'lore' as const,
                    label: defaultCategoryLabels.lore,
                    icon: { type: 'lucide' as const, name: 'book-text' },
                },
            ] as const,
        [defaultCategoryLabels.characters, defaultCategoryLabels.items, defaultCategoryLabels.locations, defaultCategoryLabels.lore]
    )

    const allPresetCategories = useMemo(
        () =>
            [
                {
                    id: 'preset_skills' as const,
                    label: presetCategoryLabels.skills,
                    icon: { type: 'lucide' as const, name: 'sword' },
                },
                {
                    id: 'preset_talents' as const,
                    label: presetCategoryLabels.talents,
                    icon: { type: 'lucide' as const, name: 'sparkles' },
                },
                {
                    id: 'preset_realms' as const,
                    label: presetCategoryLabels.realms,
                    icon: { type: 'lucide' as const, name: 'milestone' },
                },
            ] as const,
        [presetCategoryLabels.realms, presetCategoryLabels.skills, presetCategoryLabels.talents]
    )

    const categories = useMemo(() => {
        const preset = allPresetCategories
            .filter((c) => termState.enabledPresetCategoryIds.includes(c.id))
            .map((c) => ({
                id: c.id as TermCategoryId,
                label: c.label,
                icon: c.icon as CustomCategoryIcon,
                isCustom: false as const,
            }))

        const custom = (termState.customCategories as CustomTermCategory[]).map((c) => ({
            id: c.id as TermCategoryId,
            label: c.label,
            icon: (c.icon ?? ({ type: 'lucide', name: 'shapes' } as const)) as CustomCategoryIcon,
            isCustom: true as const,
        }))

        return [...defaultCategories.map((c) => ({ ...c, isCustom: false as const })), ...preset, ...custom]
    }, [allPresetCategories, defaultCategories, termState.customCategories, termState.enabledPresetCategoryIds])

    const reservedCategoryNameSet = useMemo(() => {
        const names = [...defaultCategories.map((c) => c.label), ...allPresetCategories.map((c) => c.label)]
        return new Set(names.map((name) => normalizeCategoryName(name)))
    }, [allPresetCategories, defaultCategories])

    const categoryById = useMemo(() => {
        const map = new Map<TermCategoryId, TermCategory>()
        for (const c of categories) map.set(c.id, c)
        return map
    }, [categories])

    useLayoutEffect(() => {
        const root = rootRef.current
        const aside = root?.closest('aside') as HTMLElement | null
        if (!aside) return

        const update = () => setAnchorRect(getAnchorRect(aside))
        update()

        const ro = new ResizeObserver(update)
        ro.observe(aside)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)

        return () => {
            ro.disconnect()
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
        }
    }, [])

    useEffect(() => {
        if (!novelId) return
        if (!isHydrated || !token) return

        let canceled = false
        hasLoadedFromServerRef.current = false

        const load = async () => {
            try {
                const response = await termsApi.getState(novelId)
                const parsed = safeParseTerms(response.state) ?? { entries: [] }

                if (canceled) return

                skipNextPersistRef.current = true

                const loadedEntries = parsed.entries ?? ([] as TermEntry[])
                const loadedExpandedCategoryIds = new Set<TermCategoryId>(
                    parsed.expandedCategoryIds?.length ? parsed.expandedCategoryIds : (['characters'] as TermCategoryId[])
                )
                const loadedEnabledPresetCategoryIds = (parsed.enabledPresetCategoryIds ?? []).filter((id): id is PresetTermCategoryId =>
                    PRESET_TERM_CATEGORY_ID_SET.has(id)
                )

                setTermState((prev) => ({
                    ...prev,
                    entries: loadedEntries,
                    expandedCategoryIds: new Set<TermCategoryId>([...loadedExpandedCategoryIds, ...prev.expandedCategoryIds]),
                    selectedEntryId: prev.selectedEntryId,
                    customCategories: (parsed.customCategories ?? []) as CustomTermCategory[],
                    enabledPresetCategoryIds: loadedEnabledPresetCategoryIds,
                    sortBy: parsed.sortBy ?? prev.sortBy ?? 'name',
                }))

                hasLoadedFromServerRef.current = true
            } catch (error) {
                console.error('Failed to load terms from server:', error)
                if (canceled) return
                hasLoadedFromServerRef.current = true
            }
        }

        load()

        // Codex mutates terms server-side (create_term / edit_term / delete_term); when a codex
        // turn finishes a refresh request is dispatched — re-pull the whole state so the panel
        // shows the changes and a later whole-state save does not clobber them.
        const handleRefresh = (event: Event) => {
            const detail = (event as CustomEvent<NovelRefreshRequestedEventDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            void load()
        }
        window.addEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handleRefresh as EventListener)

        return () => {
            canceled = true
            window.removeEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handleRefresh as EventListener)
        }
    }, [isHydrated, novelId, token])

    // Gallery imports from the chat / codex panels are written server-side
    // (see /terms/gallery route); merge them into our local copy so the next
    // whole-state save does not clobber them.
    useEffect(() => {
        if (!novelId) return
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<TermGalleryUpdatedDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            setTermState((prev) => ({
                ...prev,
                entries: prev.entries.map((entry) =>
                    entry.id === detail.entryId ? { ...entry, gallery: detail.gallery } : entry
                ),
            }))
        }
        window.addEventListener(TERM_GALLERY_UPDATED_EVENT, handler)
        return () => window.removeEventListener(TERM_GALLERY_UPDATED_EVENT, handler)
    }, [novelId])

    useEffect(() => {
        if (!novelId) return
        if (!isHydrated || !token) return
        if (!hasLoadedFromServerRef.current) return
        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false
            return
        }

        const toStore: StoredTerms = {
            entries: termState.entries,
            expandedCategoryIds: Array.from(termState.expandedCategoryIds),
            customCategories: termState.customCategories,
            enabledPresetCategoryIds: termState.enabledPresetCategoryIds,
            sortBy: termState.sortBy,
        }

        pendingSaveRef.current = toStore
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            const pending = pendingSaveRef.current
            pendingSaveRef.current = null
            if (!pending) return
            termsApi.saveState(novelId, pending).catch((error) => {
                console.error('Failed to save terms to server:', error)
            })
        }, 1200)

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }
        }
    }, [
        isHydrated,
        novelId,
        token,
        termState.customCategories,
        termState.enabledPresetCategoryIds,
        termState.entries,
        termState.expandedCategoryIds,
        termState.sortBy,
    ])

    useEffect(() => {
        if (!novelId) return

        const signature = termState.entries
            .map((entry) => {
                const archived = entry.archived ? '1' : '0'
                return [
                    entry.id,
                    archived,
                    entry.categoryId,
                    entry.title,
                    entry.subtitle ?? '',
                    entry.aliases ?? '',
                    entry.color ?? '',
                    entry.avatar ?? '',
                    (entry.tags ?? []).join(','),
                    entry.description ?? '',
                ].join('\t')
            })
            .join('\n')

        if (signature === mentionsSignatureRef.current) return

        mentionsSignatureRef.current = signature
        setMentionEntries(novelId, termState.entries)
        setMentionEntriesStatus(novelId, 'loaded')
    }, [novelId, setMentionEntries, setMentionEntriesStatus, termState.entries])

    useEffect(() => {
        if (!novelId) return
        setMentionMeta(novelId, {
            customCategories: termState.customCategories,
            enabledPresetCategoryIds: termState.enabledPresetCategoryIds,
        })
    }, [novelId, setMentionMeta, termState.customCategories, termState.enabledPresetCategoryIds])

    const entriesByCategory = useMemo(() => {
        const byCategory: Record<string, TermEntry[]> = {}
        for (const c of categories) byCategory[c.id] = []

        const visibleEntries = termState.entries.filter((entry) => !entry.archived)

        const selectedTagKeySet = new Set(filters.tagKeys)
        const selectedTypeIdSet = new Set(filters.typeCategoryIds)

        const matchesSearch = (entry: TermEntry) => {
            if (!isSearching) return true
            const q = normalizedQuery
            const title = entry.title.toLowerCase()
            if (title.includes(q)) return true
            const subtitle = (entry.subtitle ?? '').toLowerCase()
            if (subtitle.includes(q)) return true
            const aliases = (entry.aliases ?? '').toLowerCase()
            if (aliases.includes(q)) return true
            const description = (entry.description ?? '').toLowerCase()
            if (description.includes(q)) return true
            return false
        }

        const matchesFilters = (entry: TermEntry) => {
            if (!isFiltering) return true
            if (filters.hasRelations && (entry.relations ?? []).length === 0) return false
            if (filters.hasNotes && !(entry.researchNotes ?? '').trim()) return false
            if (filters.hasDescription && !(entry.description ?? '').trim()) return false
            if (filters.hasThumbnail && !entry.avatar) return false
            if (filters.hasTags && (entry.tags ?? []).length === 0) return false
            if (filters.alwaysInclude && (entry.aiContextPolicy ?? 'detected') !== 'always') return false
            if (filters.neverInclude && (entry.aiContextPolicy ?? 'detected') !== 'never') return false

            if (selectedTagKeySet.size > 0) {
                const entryTags = entry.tags ?? []
                const matchesTag = entryTags.some((tag) => selectedTagKeySet.has(normalizeTagKey(tag)))
                if (!matchesTag) return false
            }

            if (selectedTypeIdSet.size > 0 && !selectedTypeIdSet.has(entry.categoryId)) return false

            return true
        }

        const source = visibleEntries.filter((entry) => matchesSearch(entry) && matchesFilters(entry))

        for (const entry of source) {
            const key = entry.categoryId
            if (!byCategory[key]) byCategory[key] = []
            byCategory[key].push(entry)
        }

        const tagCount = (entry: TermEntry) => {
            const tags = entry.tags ?? []
            if (tags.length === 0) return 0
            const unique = new Set(tags.map((tag) => normalizeTagKey(tag)))
            return unique.size
        }

        const policyRank = (entry: TermEntry) => {
            const policy = entry.aiContextPolicy ?? 'detected'
            if (policy === 'always') return 0
            if (policy === 'never') return 2
            return 1
        }

        const hasNonBlackColor = (entry: TermEntry) => getTermEntryColorId(entry.color) !== 'black'

        const compareName = (a: TermEntry, b: TermEntry) => {
            const aTitle = a.title ?? ''
            const bTitle = b.title ?? ''

            const aLatin = isLatinLeading(aTitle)
            const bLatin = isLatinLeading(bTitle)
            if (aLatin !== bLatin) return aLatin ? -1 : 1

            return nameCollator.compare(aTitle, bTitle)
        }

        const compareByName = compareName
        const compareByPriority = (a: TermEntry, b: TermEntry) => {
            const aPolicy = policyRank(a)
            const bPolicy = policyRank(b)
            if (aPolicy !== bPolicy) return aPolicy - bPolicy

            const aColored = hasNonBlackColor(a)
            const bColored = hasNonBlackColor(b)
            if (aColored !== bColored) return aColored ? -1 : 1

            const tagDiff = tagCount(b) - tagCount(a)
            if (tagDiff !== 0) return tagDiff

            return compareName(a, b)
        }

        const compare = termState.sortBy === 'priority' ? compareByPriority : compareByName
        for (const categoryId of Object.keys(byCategory)) {
            byCategory[categoryId].sort(compare)
        }
        return byCategory
    }, [categories, filters, isFiltering, isSearching, nameCollator, normalizedQuery, termState.entries, termState.sortBy])

    const toggleCategory = (categoryId: TermCategoryId) => {
        setTermState((prev) => {
            const next = new Set(prev.expandedCategoryIds)
            if (next.has(categoryId)) next.delete(categoryId)
            else next.add(categoryId)
            return { ...prev, expandedCategoryIds: next }
        })
    }

    const collapseAllCategories = () => {
        setTermState((prev) => ({ ...prev, expandedCategoryIds: new Set() }))
    }

    const expandAllCategories = () => {
        setTermState((prev) => ({ ...prev, expandedCategoryIds: new Set(categories.map((c) => c.id)) }))
    }

    const setSortBy = (sortBy: TermEntrySortBy) => {
        setTermState((prev) => ({ ...prev, sortBy }))
    }

    const clearFilters = () => {
        setFilters(DEFAULT_TERM_ENTRY_FILTERS)
    }

    const handleCreate = () => {
        const title = createTitle.trim()
        if (!title) return

        const titleKey = normalizeTermTitleKey(title)
        const duplicate = termState.entries.some((entry) => !entry.archived && normalizeTermTitleKey(entry.title) === titleKey)
        if (duplicate) {
            setCreateError(createErrorLabels.duplicateTitle)
            return
        }

        const newEntry: TermEntry = {
            id: createId(),
            categoryId: createCategoryId,
            title,
            subtitle: createSubtitle.trim() || undefined,
        }

        setTermState((prev) => {
            const expanded = new Set(prev.expandedCategoryIds)
            expanded.add(newEntry.categoryId)
            return {
                ...prev,
                entries: [newEntry, ...prev.entries],
                expandedCategoryIds: expanded,
                selectedEntryId: newEntry.id,
            }
        })

        setCreateTitle('')
        setCreateSubtitle('')
        setCreateCategoryId('characters')
        setCreateError(null)
        setCreateOpen(false)
    }

    const setCreateTitleValue = (value: string) => {
        setCreateTitle(value)
        if (createError) setCreateError(null)
    }

    const selectedEntry = useMemo(() => {
        if (!termState.selectedEntryId) return null
        return termState.entries.find((e) => e.id === termState.selectedEntryId) ?? null
    }, [termState.entries, termState.selectedEntryId])

    const archivedEntries = useMemo(
        () => termState.entries.filter((entry) => entry.archived).sort((a, b) => a.title.localeCompare(b.title)),
        [termState.entries]
    )

    const allTags = useMemo(() => {
        const byKey = new Map<string, { label: string; count: number }>()
        for (const entry of termState.entries) {
            const tags = entry.tags
            if (!tags) continue
            for (const rawTag of tags) {
                if (typeof rawTag !== 'string') continue
                const tag = rawTag.trim()
                if (!tag) continue
                const key = normalizeTagKey(tag)
                const existing = byKey.get(key)
                if (existing) existing.count += 1
                else byKey.set(key, { label: tag, count: 1 })
            }
        }
        return [...byKey.values()]
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .map((item) => item.label)
    }, [termState.entries])

    const deleteTargetEntry = useMemo(() => {
        if (!deleteTargetEntryId) return null
        return termState.entries.find((e) => e.id === deleteTargetEntryId) ?? null
    }, [deleteTargetEntryId, termState.entries])

    const selectedCategory = useMemo(() => {
        if (!selectedEntry) return null
        return categoryById.get(selectedEntry.categoryId) ?? null
    }, [categoryById, selectedEntry])

    const updateSelectedEntry = (patch: Partial<TermEntry>) => {
        if (!selectedEntry) return
        setTermState((prev) => {
            const nextExpanded = patch.categoryId ? new Set(prev.expandedCategoryIds).add(patch.categoryId) : prev.expandedCategoryIds
            return {
                ...prev,
                entries: prev.entries.map((e) => (e.id === selectedEntry.id ? { ...e, ...patch } : e)),
                expandedCategoryIds: nextExpanded,
            }
        })
    }

    const openEntry = (entryId: string | null, tab: typeof panelInitialTab = 'details') => {
        setPanelInitialTab(tab)
        setTermState((prev) => {
            if (!entryId) return { ...prev, selectedEntryId: null }
            const target = prev.entries.find((e) => e.id === entryId) ?? null
            if (!target) return { ...prev, selectedEntryId: entryId }
            const expanded = new Set(prev.expandedCategoryIds)
            expanded.add(target.categoryId)
            return { ...prev, selectedEntryId: entryId, expandedCategoryIds: expanded }
        })
    }

    const archiveEntry = (entryId: string) => {
        setTermState((prev) => {
            const exists = prev.entries.some((e) => e.id === entryId)
            if (!exists) return prev
            return {
                ...prev,
                entries: prev.entries.map((e) => (e.id === entryId ? { ...e, archived: true } : e)),
                selectedEntryId: prev.selectedEntryId === entryId ? null : prev.selectedEntryId,
            }
        })
    }

    const invertRelationDirection = (direction: TermEntryRelationDirection): TermEntryRelationDirection => {
        if (direction === 'outgoing') return 'incoming'
        if (direction === 'incoming') return 'outgoing'
        return 'bidirectional'
    }

    const addRelation = (fromEntryId: string, toEntryId: string) => {
        if (fromEntryId === toEntryId) return
        setTermState((prev) => {
            const from = prev.entries.find((e) => e.id === fromEntryId) ?? null
            const to = prev.entries.find((e) => e.id === toEntryId) ?? null
            if (!from || !to) return prev

            const existing = (from.relations ?? []).some((rel) => rel.otherId === toEntryId)
            if (existing) return prev

            const id = createId()
            const relA: TermEntryRelation = { id, otherId: toEntryId, direction: 'outgoing' }
            const relB: TermEntryRelation = { id, otherId: fromEntryId, direction: 'incoming' }

            return {
                ...prev,
                entries: prev.entries.map((entry) => {
                    if (entry.id === fromEntryId) return { ...entry, relations: [...(entry.relations ?? []), relA] }
                    if (entry.id === toEntryId) return { ...entry, relations: [...(entry.relations ?? []), relB] }
                    return entry
                }),
            }
        })
    }

    const updateRelation = (
        fromEntryId: string,
        relationId: string,
        patch: Partial<Pick<TermEntryRelation, 'direction' | 'label'>>
    ) => {
        setTermState((prev) => {
            const from = prev.entries.find((e) => e.id === fromEntryId) ?? null
            if (!from) return prev
            const fromRel = (from.relations ?? []).find((rel) => rel.id === relationId) ?? null
            if (!fromRel) return prev
            const toEntryId = fromRel.otherId

            const nextDirectionA = patch.direction ?? fromRel.direction
            const nextDirectionB = invertRelationDirection(nextDirectionA)

            return {
                ...prev,
                entries: prev.entries.map((entry) => {
                    if (entry.id !== fromEntryId && entry.id !== toEntryId) return entry

                    const isA = entry.id === fromEntryId
                    const nextDir = isA ? nextDirectionA : nextDirectionB

                    const nextRelations = (entry.relations ?? []).map((rel) => {
                        if (rel.id !== relationId) return rel
                        const updated: TermEntryRelation = { ...rel, direction: nextDir }
                        if (typeof patch.label === 'string') {
                            const trimmed = patch.label.trim()
                            if (trimmed) updated.label = trimmed
                            else delete updated.label
                        }
                        return updated
                    })

                    return { ...entry, relations: nextRelations }
                }),
            }
        })
    }

    const deleteRelation = (fromEntryId: string, relationId: string) => {
        setTermState((prev) => {
            const from = prev.entries.find((e) => e.id === fromEntryId) ?? null
            if (!from) return prev
            const fromRel = (from.relations ?? []).find((rel) => rel.id === relationId) ?? null
            if (!fromRel) return prev
            const toEntryId = fromRel.otherId

            return {
                ...prev,
                entries: prev.entries.map((entry) => {
                    if (entry.id !== fromEntryId && entry.id !== toEntryId) return entry
                    const nextRelations = (entry.relations ?? []).filter((rel) => rel.id !== relationId)
                    return { ...entry, relations: nextRelations.length ? nextRelations : undefined }
                }),
            }
        })
    }

    const restoreArchivedEntries = (entryIds: string[]) => {
        if (!entryIds.length) return
        const restoreSet = new Set(entryIds)
        setTermState((prev) => {
            let changed = false
            const nextExpanded = new Set(prev.expandedCategoryIds)
            const nextEntries = prev.entries.map((entry) => {
                if (!restoreSet.has(entry.id)) return entry
                if (!entry.archived) return entry
                changed = true
                nextExpanded.add(entry.categoryId)
                return { ...entry, archived: false }
            })
            if (!changed) return prev
            return { ...prev, entries: nextEntries, expandedCategoryIds: nextExpanded }
        })
    }

    const entryCountsByCategoryId = useMemo(() => {
        const counts = new Map<TermCategoryId, number>()
        for (const c of categories) counts.set(c.id, 0)
        for (const e of termState.entries) {
            counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1)
        }
        return counts
    }, [categories, termState.entries])

    const updateCustomCategory = (id: string, patch: Partial<CustomTermCategory>) => {
        setTermState((prev) => ({
            ...prev,
            customCategories: prev.customCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }))
    }

    const handleAddCustomCategory = () => {
        const label = customCategoryName.trim()
        if (!label) return

        const normalizedLabel = normalizeCategoryName(label)
        if (reservedCategoryNameSet.has(normalizedLabel)) {
            setCustomCategoryError(customCategoryErrorLabels.reservedNameHint)
            return
        }

        const exists = termState.customCategories.some((c) => normalizeCategoryName(c.label) === normalizedLabel)
        if (exists) {
            setCustomCategoryError(customCategoryErrorLabels.alreadyExists)
            return
        }

        const id = createId()
        setTermState((prev) => ({
            ...prev,
            customCategories: [...prev.customCategories, { id, label, icon: newCustomCategoryIcon }],
            expandedCategoryIds: new Set(prev.expandedCategoryIds).add(id),
        }))
        setCustomCategoryName('')
        setCustomCategoryError(null)
        setNewCustomCategoryIcon({ type: 'lucide', name: 'shapes' })
    }

    const handleDeleteCustomCategory = (categoryId: TermCategoryId) => {
        const count = entryCountsByCategoryId.get(categoryId) ?? 0
        if (count > 0) return
        setTermState((prev) => ({
            ...prev,
            customCategories: prev.customCategories.filter((c) => c.id !== categoryId),
            expandedCategoryIds: new Set(Array.from(prev.expandedCategoryIds).filter((id) => id !== categoryId)),
        }))
        setCreateCategoryId((prev) => (prev === categoryId ? 'characters' : prev))
    }

    const togglePresetCategory = (categoryId: PresetTermCategoryId, enabled: boolean) => {
        const count = entryCountsByCategoryId.get(categoryId as TermCategoryId) ?? 0
        if (!enabled && count > 0) return

        setTermState((prev) => {
            const has = prev.enabledPresetCategoryIds.includes(categoryId)
            if (enabled === has) return prev

            const nextPresetIds = enabled
                ? [...prev.enabledPresetCategoryIds, categoryId]
                : prev.enabledPresetCategoryIds.filter((id) => id !== categoryId)
            const nextExpandedCategoryIds = new Set(prev.expandedCategoryIds)

            if (enabled) {
                nextExpandedCategoryIds.add(categoryId)
            } else {
                nextExpandedCategoryIds.delete(categoryId)
            }

            return {
                ...prev,
                enabledPresetCategoryIds: nextPresetIds,
                expandedCategoryIds: nextExpandedCategoryIds,
            }
        })

        if (!enabled) {
            setCreateCategoryId((prev) => (prev === categoryId ? 'characters' : prev))
        }
    }

    const deleteEntry = (entryId: string) => {
        setTermState((prev) => {
            const target = prev.entries.find((entry) => entry.id === entryId)
            if (!target) return prev

            return {
                ...prev,
                entries: prev.entries
                    .filter((entry) => entry.id !== entryId)
                    .map((entry) => {
                        const relations = entry.relations ?? []
                        if (relations.length === 0) return entry
                        const nextRelations = relations.filter((rel) => rel.otherId !== entryId)
                        if (nextRelations.length === relations.length) return entry
                        return { ...entry, relations: nextRelations.length ? nextRelations : undefined }
                    }),
                selectedEntryId: prev.selectedEntryId === entryId ? null : prev.selectedEntryId,
            }
        })
    }

    const iconPickerPresets = useMemo(() => {
        const q = iconPickerQuery.trim().toLowerCase()
        if (!q) return TERM_ICON_PRESETS
        return TERM_ICON_PRESETS.filter((name) => name.includes(q))
    }, [iconPickerQuery])

    const openIconPicker = (target: IconPickerTarget) => {
        setIconPickerTarget(target)
        setIconPickerQuery('')
        setIconPickerOpen(true)
    }

    const applyPickedIcon = (icon: CustomCategoryIcon) => {
        if (!iconPickerTarget) return
        if (iconPickerTarget.kind === 'new') {
            setNewCustomCategoryIcon(icon)
        } else {
            updateCustomCategory(iconPickerTarget.id, { icon })
        }
        setIconPickerOpen(false)
        setIconPickerTarget(null)
    }

    const handleUploadIcon = async (file: File | null) => {
        if (!file) return
        if (!file.type.startsWith('image/')) return
        const dataUrl = await cropImageFileToSquareDataUrl(file, 64)
        applyPickedIcon({ type: 'image', dataUrl })
    }

    useEffect(() => {
        if (!termState.selectedEntryId) return

        const onPointerDownCapture = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null
            if (!target) return
            if (target.closest('[data-slot="dialog-content"]')) return
            if (target.closest('[data-slot="dialog-overlay"]')) return
            if (target.closest('[data-slot="alert-dialog-content"]')) return
            if (target.closest('[data-slot="alert-dialog-overlay"]')) return
            if (target.closest('[data-term-floating-panel="true"]')) return
            if (target.closest('[data-term-entry-trigger="true"]')) return
            setTermState((prev) => (prev.selectedEntryId ? { ...prev, selectedEntryId: null } : prev))
        }

        document.addEventListener('pointerdown', onPointerDownCapture, true)
        return () => document.removeEventListener('pointerdown', onPointerDownCapture, true)
    }, [termState.selectedEntryId])

    const MIN_HISTORY_VERSION_INTERVAL_MS = 10_000
    const HISTORY_DEBOUNCE_MS = 1_200

    const descHistoryDebounceRef = useRef<number | null>(null)
    const lastDescChangeRef = useRef<{ entryId: string; value: string } | null>(null)

    const notesHistoryDebounceRef = useRef<number | null>(null)
    const lastNotesChangeRef = useRef<{ entryId: string; value: string } | null>(null)

    const selectedEntryId = termState.selectedEntryId
    const selectedDescription = selectedEntry?.description ?? ''
    const selectedResearchNotes = selectedEntry?.researchNotes ?? ''

    useEffect(() => {
        if (!selectedEntryId) {
            lastDescChangeRef.current = null
            if (descHistoryDebounceRef.current) window.clearTimeout(descHistoryDebounceRef.current)
            descHistoryDebounceRef.current = null
            return
        }
        const current = { entryId: selectedEntryId, value: selectedDescription }
        const prev = lastDescChangeRef.current
        lastDescChangeRef.current = current

        if (!prev || prev.entryId !== current.entryId) return
        if (prev.value === current.value) return

        if (descHistoryDebounceRef.current) window.clearTimeout(descHistoryDebounceRef.current)
        descHistoryDebounceRef.current = window.setTimeout(() => {
            setTermState((prevState) => {
                const entryId = current.entryId
                let changed = false
                const nextEntries = prevState.entries.map((e) => {
                    if (e.id !== entryId) return e
                    const value = (e.description ?? '').trim()
                    if (!value) return e

                    const history = e.history ?? []
                    const now = Date.now()
                    const { history: nextHistory, recorded } = recordRevisionHistory(history, value, {
                        now,
                        idPrefix: 'term',
                        minIntervalMs: MIN_HISTORY_VERSION_INTERVAL_MS,
                        normalize: (next) => next.trim(),
                    })
                    if (!recorded) return e

                    changed = true
                    return { ...e, history: nextHistory }
                })

                if (!changed) return prevState
                return { ...prevState, entries: nextEntries }
            })
        }, HISTORY_DEBOUNCE_MS)

        return () => {
            if (descHistoryDebounceRef.current) window.clearTimeout(descHistoryDebounceRef.current)
        }
    }, [selectedDescription, selectedEntryId])

    useEffect(() => {
        if (!selectedEntryId) {
            lastNotesChangeRef.current = null
            if (notesHistoryDebounceRef.current) window.clearTimeout(notesHistoryDebounceRef.current)
            notesHistoryDebounceRef.current = null
            return
        }
        const current = { entryId: selectedEntryId, value: selectedResearchNotes }
        const prev = lastNotesChangeRef.current
        lastNotesChangeRef.current = current

        if (!prev || prev.entryId !== current.entryId) return
        if (prev.value === current.value) return

        if (notesHistoryDebounceRef.current) window.clearTimeout(notesHistoryDebounceRef.current)
        notesHistoryDebounceRef.current = window.setTimeout(() => {
            setTermState((prevState) => {
                const entryId = current.entryId
                let changed = false
                const nextEntries = prevState.entries.map((e) => {
                    if (e.id !== entryId) return e
                    const value = (e.researchNotes ?? '').trim()
                    if (!value) return e

                    const history = e.researchNotesHistory ?? []
                    const now = Date.now()
                    const { history: nextHistory, recorded } = recordRevisionHistory(history, value, {
                        now,
                        idPrefix: 'term',
                        minIntervalMs: MIN_HISTORY_VERSION_INTERVAL_MS,
                        normalize: (next) => next.trim(),
                    })
                    if (!recorded) return e

                    changed = true
                    return { ...e, researchNotesHistory: nextHistory }
                })

                if (!changed) return prevState
                return { ...prevState, entries: nextEntries }
            })
        }, HISTORY_DEBOUNCE_MS)

        return () => {
            if (notesHistoryDebounceRef.current) window.clearTimeout(notesHistoryDebounceRef.current)
        }
    }, [selectedEntryId, selectedResearchNotes])

    return {
        panelInitialTab,
        rootRef,
        anchorRect,
        termState,
        setTermState,
        sortBy: termState.sortBy,
        setSortBy,
        collapseAllCategories,
        expandAllCategories,
        filters,
        setFilters,
        clearFilters,
        filterActiveCount,
        isFiltering,
        searchQuery,
        setSearchQuery,
        isSearching,
        createOpen,
        setCreateOpen,
        createTitle,
        setCreateTitle: setCreateTitleValue,
        createSubtitle,
        setCreateSubtitle,
        createCategoryId,
        setCreateCategoryId,
        createError,
        setCreateError,
        customCategoriesOpen,
        setCustomCategoriesOpen,
        presetCategoriesOpen,
        setPresetCategoriesOpen,
        customTemplatesOpen,
        setCustomTemplatesOpen,
        customCategoryName,
        setCustomCategoryName,
        customCategoryError,
        setCustomCategoryError,
        newCustomCategoryIcon,
        setNewCustomCategoryIcon,
        iconPickerOpen,
        setIconPickerOpen,
        iconPickerQuery,
        setIconPickerQuery,
        iconPickerTarget,
        setIconPickerTarget,
        deleteDialogOpen,
        setDeleteDialogOpen,
        deleteTargetEntryId,
        setDeleteTargetEntryId,
        iconUploadRef,
        allPresetCategories,
        categories,
        entriesByCategory,
        toggleCategory,
        handleCreate,
        selectedEntry,
        archivedEntries,
        allTags,
        deleteTargetEntry,
        selectedCategory,
        updateSelectedEntry,
        openEntry,
        archiveEntry,
        restoreArchivedEntries,
        addRelation,
        updateRelation,
        deleteRelation,
        entryCountsByCategoryId,
        handleAddCustomCategory,
        handleDeleteCustomCategory,
        togglePresetCategory,
        deleteEntry,
        iconPickerPresets,
        openIconPicker,
        applyPickedIcon,
        handleUploadIcon,
    }
}
