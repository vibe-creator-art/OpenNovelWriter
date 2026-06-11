'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Archive, BookText, ChevronDown, ChevronRight, Filter, FoldVertical, ImagePlus, List, Monitor, Plus, Search, Settings, Shapes, Trash2, UnfoldVertical } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic.mjs'
import { TermEntryFloatingPanel } from '@/components/editor/terms/term-entry-floating-panel'
import { TermEntryItem } from '@/components/editor/terms/term-entry-item'
import { useTermController } from '@/components/editor/terms/use-term-controller'
import type { TermEntryPanelTab } from '@/components/editor/terms/term-entry-events'
import type { TermCategoryId, TermEntrySortBy } from '@/components/editor/terms/types'
import { normalizeTermTitleKey } from '@/lib/term-state'
import { normalizeTagKey, renderIconSpec } from '@/components/editor/terms/utils'
import type { ChapterWithScenes } from '@/lib/api'

export type { DefaultTermCategoryId, TermCategoryId, TermEntry } from '@/components/editor/terms/types'

interface LeftPanelTermsProps {
    novelId?: string
    isCompact: boolean
    chapters: ChapterWithScenes[]
    requestedOpenEntry?: { entryId: string; tab?: TermEntryPanelTab } | null
    onRequestedOpenEntryHandled?: () => void
    onNavigateToManuscript: (chapterId: string, sceneId?: string, termId?: string, target?: 'manuscript' | 'summary') => void
    onNavigateToSnippet?: (snippetId: string) => void
    onNavigateToOutline?: (target: { kind: 'act'; actNumber: number } | { kind: 'chapter'; chapterId: string }) => void
}

export function LeftPanelTerms({
    novelId,
    isCompact,
    chapters,
    requestedOpenEntry,
    onRequestedOpenEntryHandled,
    onNavigateToManuscript,
    onNavigateToSnippet,
    onNavigateToOutline,
}: LeftPanelTermsProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const locale = useLocale()

    const {
        panelInitialTab,
        rootRef,
        anchorRect,
        termState,
        sortBy,
        setSortBy,
        collapseAllCategories,
        expandAllCategories,
        filters,
        setFilters,
        clearFilters,
        isFiltering,
        searchQuery,
        setSearchQuery,
        isSearching,
        createOpen,
        setCreateOpen,
        createTitle,
        setCreateTitle,
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
        iconPickerOpen,
        setIconPickerOpen,
        iconPickerQuery,
        setIconPickerQuery,
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
    } = useTermController({
        novelId,
        locale,
        defaultCategoryLabels: {
            characters: t('terms.categories.characters'),
            locations: t('terms.categories.locations'),
            items: t('terms.categories.items'),
            lore: t('terms.categories.lore'),
        },
        presetCategoryLabels: {
            skills: t('terms.presetCategories.items.skills'),
            talents: t('terms.presetCategories.items.talents'),
            realms: t('terms.presetCategories.items.realms'),
        },
        customCategoryErrorLabels: {
            reservedNameHint: t('terms.customCategories.reservedNameHint'),
            alreadyExists: t('terms.customCategories.alreadyExists'),
        },
        createErrorLabels: {
            duplicateTitle: t('terms.createErrors.duplicateTitle'),
        },
    })

    useEffect(() => {
        if (!requestedOpenEntry?.entryId) return
        openEntry(requestedOpenEntry.entryId, requestedOpenEntry.tab ?? 'details')
        onRequestedOpenEntryHandled?.()
    }, [onRequestedOpenEntryHandled, openEntry, requestedOpenEntry])

    const [archivedDialogOpen, setArchivedDialogOpen] = useState(false)
    const [archivedRestoreSelection, setArchivedRestoreSelection] = useState<Set<string>>(() => new Set())

    const activeEntryTitleKeySet = useMemo(() => {
        const set = new Set<string>()
        for (const entry of termState.entries) {
            if (entry.archived) continue
            const key = normalizeTermTitleKey(entry.title)
            if (!key) continue
            set.add(key)
        }
        return set
    }, [termState.entries])

    const isSearchOrFiltered = isSearching || isFiltering

    const selectedTypeIdSet = useMemo(() => new Set(filters.typeCategoryIds), [filters.typeCategoryIds])
    const categoriesToRender = useMemo(() => {
        if (selectedTypeIdSet.size === 0) return categories
        return categories.filter((category) => selectedTypeIdSet.has(category.id))
    }, [categories, selectedTypeIdSet])

    return (
        <div ref={rootRef} className="flex flex-col min-h-0 flex-1">
            <div className="p-2 border-b">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t('terms.search')}
                            className="pl-8 h-8 text-sm"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                        />
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn('h-8 w-8 shrink-0 relative', isFiltering && 'bg-muted/40')}
                                title={t('terms.filter')}
                                aria-label={t('terms.filter')}
                            >
                                <Filter className="h-4 w-4" />
                                {isFiltering && (
                                    <span
                                        aria-hidden="true"
                                        className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                                    />
                                )}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuCheckboxItem
                                checked={filters.hasRelations}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, hasRelations: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.hasRelations')}
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={filters.hasNotes}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, hasNotes: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.hasNotes')}
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={filters.hasDescription}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, hasDescription: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.hasDescription')}
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={filters.hasThumbnail}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, hasThumbnail: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.hasThumbnail')}
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={filters.hasTags}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, hasTags: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.hasTags')}
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={filters.alwaysInclude}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, alwaysInclude: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.alwaysInclude')}
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={filters.neverInclude}
                                onCheckedChange={(checked) => setFilters((prev) => ({ ...prev, neverInclude: Boolean(checked) }))}
                                onSelect={(event) => event.preventDefault()}
                            >
                                {t('terms.filters.neverInclude')}
                            </DropdownMenuCheckboxItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>{t('terms.filters.filterByTag')}</DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-56">
                                    {allTags.length === 0 ? (
                                        <DropdownMenuItem disabled>{t('terms.filters.emptyTags')}</DropdownMenuItem>
                                    ) : (
                                        allTags.map((tag) => {
                                            const key = normalizeTagKey(tag)
                                            const checked = filters.tagKeys.includes(key)
                                            return (
                                                <DropdownMenuCheckboxItem
                                                    key={key}
                                                    checked={checked}
                                                    onCheckedChange={(nextChecked) => {
                                                        setFilters((prev) => {
                                                            const next = new Set(prev.tagKeys)
                                                            if (nextChecked) next.add(key)
                                                            else next.delete(key)
                                                            return { ...prev, tagKeys: [...next] }
                                                        })
                                                    }}
                                                    onSelect={(event) => event.preventDefault()}
                                                >
                                                    {tag}
                                                </DropdownMenuCheckboxItem>
                                            )
                                        })
                                    )}
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>

                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>{t('terms.filters.filterByType')}</DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-56">
                                    {categories.map((category) => {
                                        const checked = filters.typeCategoryIds.includes(category.id)
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={category.id}
                                                checked={checked}
                                                onCheckedChange={(nextChecked) => {
                                                    setFilters((prev) => {
                                                        const next = new Set(prev.typeCategoryIds)
                                                        if (nextChecked) next.add(category.id)
                                                        else next.delete(category.id)
                                                        return { ...prev, typeCategoryIds: [...next] }
                                                    })
                                                }}
                                                onSelect={(event) => event.preventDefault()}
                                            >
                                                {category.label}
                                            </DropdownMenuCheckboxItem>
                                        )
                                    })}
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>

                            <DropdownMenuSeparator />

                            <DropdownMenuItem disabled={!isFiltering} onSelect={clearFilters}>
                                {t('terms.filters.clear')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        title={t('terms.add')}
                        aria-label={t('terms.add')}
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                title={t('terms.menu')}
                                aria-label={t('terms.menu')}
                            >
                                <Settings className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setPresetCategoriesOpen(true)}>
                                <List className="h-4 w-4" />
                                <span>{t('terms.menuItems.presetCategories')}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setCustomCategoriesOpen(true)}>
                                <Shapes className="h-4 w-4" />
                                <span>{t('terms.menuItems.customCategories')}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setCustomTemplatesOpen(true)}>
                                <BookText className="h-4 w-4" />
                                <span>{t('terms.menuItems.customDescriptionTemplate')}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setArchivedDialogOpen(true)}>
                                <Archive className="h-4 w-4" />
                                <span>{t('terms.menuItems.archivedEntries')}</span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <Monitor className="h-4 w-4" />
                                    <span>{t('terms.menuItems.displaySettings')}</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    <DropdownMenuItem onSelect={collapseAllCategories}>
                                        <FoldVertical className="h-4 w-4" />
                                        <span>{t('terms.displaySettings.collapseAll')}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={expandAllCategories}>
                                        <UnfoldVertical className="h-4 w-4" />
                                        <span>{t('terms.displaySettings.expandAll')}</span>
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    <DropdownMenuLabel>{t('terms.displaySettings.sortBy')}</DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                        value={sortBy}
                                        onValueChange={(value) => setSortBy(value as TermEntrySortBy)}
                                    >
                                        <DropdownMenuRadioItem value="name">
                                            {t('terms.displaySettings.sort.name')}
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="priority">
                                            {t('terms.displaySettings.sort.priority')}
                                        </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="p-2 space-y-2">
                    {categoriesToRender.map((category) => {
                        const categoryEntries = entriesByCategory[category.id]
                        const count = categoryEntries.length
                        const isExpanded = isSearchOrFiltered ? count > 0 : termState.expandedCategoryIds.has(category.id)

                        return (
                            <div key={category.id} className="rounded-md">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!isSearchOrFiltered) toggleCategory(category.id)
                                    }}
                                    className={cn(
                                        'w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted transition-colors',
                                        isSearchOrFiltered && count === 0 && 'opacity-60 cursor-default hover:bg-transparent'
                                    )}
                                >
                                    {isExpanded ? (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <span className="text-sm font-semibold">{category.label}</span>
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        {t('terms.entryCount', { count })}
                                    </span>
                                </button>

                                {isExpanded && (
                                    <div className="mt-1 space-y-1">
                                        {count === 0 ? (
                                            <div className="px-2 py-2 text-xs text-muted-foreground">
                                                {t('terms.emptyCategory')}
                                            </div>
                                        ) : (
                                            categoryEntries.map((entry) => (
                                                <TermEntryItem
                                                    key={entry.id}
                                                    entry={entry}
                                                    selected={entry.id === termState.selectedEntryId}
                                                    isCompact={isCompact}
                                                    fallbackIcon={category.icon}
                                                    onSelect={() => openEntry(entry.id, 'details')}
                                                />
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}

                    {termState.entries.length === 0 && (
                        <div className="pt-4 flex items-center justify-center">
                            <Badge variant="secondary" className="text-xs">
                                {t('terms.emptyAll')}
                            </Badge>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <Dialog
                open={createOpen}
                onOpenChange={(open) => {
                    setCreateOpen(open)
                    if (!open) setCreateError(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('terms.createTitle')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="term-title">{t('terms.fields.title')}</Label>
                            <Input
                                id="term-title"
                                value={createTitle}
                                placeholder={t('terms.titlePlaceholder')}
                                onChange={(e) => setCreateTitle(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreate()
                                }}
                            />
                            {createError && <div className="text-sm text-destructive">{createError}</div>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="term-category">{t('terms.fields.category')}</Label>
                            <select
                                id="term-category"
                                className="h-9 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                                value={createCategoryId}
                                onChange={(e) => setCreateCategoryId(e.target.value as TermCategoryId)}
                            >
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="term-subtitle">{t('terms.fields.subtitle')}</Label>
                            <Input
                                id="term-subtitle"
                                value={createSubtitle}
                                placeholder={t('terms.subtitlePlaceholder')}
                                onChange={(e) => setCreateSubtitle(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                            {tCommon('cancel')}
                        </Button>
                        <Button onClick={handleCreate}>{tCommon('create')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={archivedDialogOpen}
                onOpenChange={(open) => {
                    setArchivedDialogOpen(open)
                    if (!open) setArchivedRestoreSelection(new Set())
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('terms.archived.title')}</DialogTitle>
                    </DialogHeader>

                    {archivedEntries.length === 0 ? (
                        <div className="text-sm text-muted-foreground">{t('terms.archived.empty')}</div>
                    ) : (
                        <ScrollArea className="h-80 rounded-md border">
                            <div className="p-2 space-y-1">
                                {archivedEntries.map((entry) => {
                                    const titleKey = normalizeTermTitleKey(entry.title)
                                    const hasConflict = titleKey ? activeEntryTitleKeySet.has(titleKey) : false
                                    const checked = archivedRestoreSelection.has(entry.id)
                                    return (
                                        <div
                                            key={entry.id}
                                            className={cn(
                                                'flex items-center gap-2 rounded-md border px-3 py-2 transition-colors',
                                                'hover:bg-muted/40',
                                                hasConflict && 'opacity-60 hover:bg-transparent'
                                            )}
                                        >
                                            <label
                                                className={cn(
                                                    'flex min-w-0 flex-1 items-center gap-3 cursor-pointer',
                                                    hasConflict && 'cursor-not-allowed'
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4"
                                                    checked={checked}
                                                    disabled={hasConflict}
                                                    onChange={(e) => {
                                                        const nextChecked = e.target.checked
                                                        setArchivedRestoreSelection((prev) => {
                                                            const next = new Set(prev)
                                                            if (nextChecked) next.add(entry.id)
                                                            else next.delete(entry.id)
                                                            return next
                                                        })
                                                    }}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium truncate">{entry.title}</div>
                                                    {hasConflict && (
                                                        <div className="text-xs text-muted-foreground">
                                                            {t('terms.archived.conflict')}
                                                        </div>
                                                    )}
                                                </div>
                                            </label>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                                title={t('terms.archived.delete')}
                                                onClick={() => {
                                                    setArchivedRestoreSelection((prev) => {
                                                        if (!prev.has(entry.id)) return prev
                                                        const next = new Set(prev)
                                                        next.delete(entry.id)
                                                        return next
                                                    })
                                                    setDeleteTargetEntryId(entry.id)
                                                    setDeleteDialogOpen(true)
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )
                                })}
                            </div>
                        </ScrollArea>
                    )}

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setArchivedDialogOpen(false)}>
                            {tCommon('cancel')}
                        </Button>
                        <Button
                            disabled={archivedRestoreSelection.size === 0}
                            onClick={() => {
                                const selected = archivedEntries.filter((entry) => archivedRestoreSelection.has(entry.id))
                                const uniqueByTitle = new Set<string>()
                                const toRestore: string[] = []
                                for (const entry of selected) {
                                    const key = normalizeTermTitleKey(entry.title)
                                    if (!key) continue
                                    if (activeEntryTitleKeySet.has(key)) continue
                                    if (uniqueByTitle.has(key)) continue
                                    uniqueByTitle.add(key)
                                    toRestore.push(entry.id)
                                }
                                restoreArchivedEntries(toRestore)
                                setArchivedRestoreSelection(new Set())
                            }}
                        >
                            {t('terms.archived.restore')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={customCategoriesOpen}
                onOpenChange={(open) => {
                    setCustomCategoriesOpen(open)
                    if (!open) setCustomCategoryError(null)
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('terms.customCategories.title')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => openIconPicker({ kind: 'new' })}
                                title={t('terms.iconPicker.title')}
                                aria-label={t('terms.iconPicker.title')}
                            >
                                {renderIconSpec(newCustomCategoryIcon, 'h-4 w-4 text-muted-foreground')}
                            </Button>
                            <Input
                                value={customCategoryName}
                                onChange={(e) => {
                                    setCustomCategoryName(e.target.value)
                                    if (customCategoryError) setCustomCategoryError(null)
                                }}
                                placeholder={t('terms.customCategories.namePlaceholder')}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleAddCustomCategory()
                                }}
                            />
                            <Button onClick={handleAddCustomCategory}>{tCommon('create')}</Button>
                        </div>
                        {customCategoryError && <div className="text-sm text-destructive">{customCategoryError}</div>}

                        <div className="space-y-2">
                            {termState.customCategories.length === 0 ? (
                                <div className="text-sm text-muted-foreground">{t('terms.customCategories.empty')}</div>
                            ) : (
                                termState.customCategories.map((c) => {
                                    const count = entryCountsByCategoryId.get(c.id as TermCategoryId) ?? 0
                                    const canDelete = count === 0
                                    return (
                                        <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                                            <Button
                                                variant="outline"
                                                size="icon-sm"
                                                onClick={() => openIconPicker({ kind: 'existing', id: c.id })}
                                                title={t('terms.iconPicker.title')}
                                                aria-label={t('terms.iconPicker.title')}
                                            >
                                                {renderIconSpec(c.icon, 'h-4 w-4 text-muted-foreground')}
                                            </Button>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{c.label}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {t('terms.entryCount', { count })}
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={cn('h-8 w-8', !canDelete && 'opacity-50')}
                                                disabled={!canDelete}
                                                onClick={() => handleDeleteCustomCategory(c.id as TermCategoryId)}
                                                title={
                                                    canDelete
                                                        ? t('terms.customCategories.delete')
                                                        : t('terms.customCategories.cannotDeleteNonEmpty')
                                                }
                                                aria-label={t('terms.customCategories.delete')}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={presetCategoriesOpen} onOpenChange={setPresetCategoriesOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('terms.presetCategories.title')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-2">
                        {allPresetCategories.map((category) => {
                            const isEnabled = termState.enabledPresetCategoryIds.includes(category.id)
                            const count = entryCountsByCategoryId.get(category.id as TermCategoryId) ?? 0
                            const canDisable = count === 0
                            return (
                                <label
                                    key={category.id}
                                    className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={isEnabled}
                                        disabled={isEnabled && !canDisable}
                                        onChange={(e) => togglePresetCategory(category.id, e.target.checked)}
                                    />
                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background text-muted-foreground">
                                        {renderIconSpec(category.icon, 'h-4 w-4 text-muted-foreground')}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium truncate">{category.label}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {t('terms.entryCount', { count })}
                                        </div>
                                    </div>
                                    {isEnabled && !canDisable && (
                                        <div className="text-xs text-muted-foreground">
                                            {t('terms.presetCategories.cannotDisableNonEmpty')}
                                        </div>
                                    )}
                                </label>
                            )
                        })}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={customTemplatesOpen} onOpenChange={setCustomTemplatesOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('terms.customTemplates.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="text-sm text-muted-foreground">{t('terms.customTemplates.placeholder')}</div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCustomTemplatesOpen(false)}>
                            {tCommon('confirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={iconPickerOpen}
                onOpenChange={(open) => {
                    setIconPickerOpen(open)
                    if (!open) setIconPickerTarget(null)
                }}
            >
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{t('terms.iconPicker.title')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        <Input
                            value={iconPickerQuery}
                            onChange={(e) => setIconPickerQuery(e.target.value)}
                            placeholder={t('terms.iconPicker.searchPlaceholder')}
                        />

                        <ScrollArea className="h-80 rounded-md border">
                            <div className="p-3 grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-2">
                                {iconPickerPresets.map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        className="h-10 w-10 rounded-md border bg-background hover:bg-muted transition-colors flex items-center justify-center"
                                        onClick={() => applyPickedIcon({ type: 'lucide', name })}
                                        title={name}
                                    >
                                        <DynamicIcon name={name} className="h-5 w-5 text-muted-foreground" />
                                    </button>
                                ))}
                            </div>
                        </ScrollArea>

                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-muted-foreground">{t('terms.iconPicker.uploadHelp')}</div>
                            <input
                                ref={iconUploadRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0] ?? null
                                    e.target.value = ''
                                    try {
                                        await handleUploadIcon(file)
                                    } catch {
                                        // Ignore
                                    }
                                }}
                            />
                            <Button variant="outline" onClick={() => iconUploadRef.current?.click()} className="gap-2">
                                <ImagePlus className="h-4 w-4" />
                                {t('terms.iconPicker.upload')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {anchorRect && selectedEntry && selectedCategory && (
                <TermEntryFloatingPanel
                    key={selectedEntry.id}
                    novelId={novelId}
                    anchorRect={anchorRect}
                    entry={selectedEntry}
                    entries={termState.entries}
                    manuscriptChapters={chapters}
                    category={selectedCategory}
                    categories={categories}
                    allTags={allTags}
                    initialTab={panelInitialTab}
                    onNavigateToEntry={(entryId, tab) => openEntry(entryId, tab)}
                    onNavigateToManuscript={onNavigateToManuscript}
                    onNavigateToSnippet={onNavigateToSnippet}
                    onNavigateToOutline={onNavigateToOutline}
                    onClose={() => openEntry(null, 'details')}
                    onArchive={() => archiveEntry(selectedEntry.id)}
                    onDelete={() => {
                        setDeleteTargetEntryId(selectedEntry.id)
                        setDeleteDialogOpen(true)
                    }}
                    onAddRelation={(otherEntryId) => addRelation(selectedEntry.id, otherEntryId)}
                    onUpdateRelation={(relationId, patch) => updateRelation(selectedEntry.id, relationId, patch)}
                    onDeleteRelation={(relationId) => deleteRelation(selectedEntry.id, relationId)}
                    onUpdate={updateSelectedEntry}
                />
            )}

            <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                    setDeleteDialogOpen(open)
                    if (!open) setDeleteTargetEntryId(null)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('terms.panel.deleteConfirm', { title: deleteTargetEntry?.title ?? '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (!deleteTargetEntryId) return
                                deleteEntry(deleteTargetEntryId)
                                setDeleteDialogOpen(false)
                                setDeleteTargetEntryId(null)
                            }}
                        >
                            {t('terms.panel.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
