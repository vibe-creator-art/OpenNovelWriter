'use client'

import { AlertTriangle, ChevronDown, ChevronRight, Clipboard, FileJson, Filter, Link2, Plus, Search, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react'

import { DEFAULT_PROMPT_SELECTION_CATEGORIES, type Prompt } from '@/lib/api'
import type { BuiltinPromptPreset } from '@/lib/api'
import type { PromptCategory } from '@/lib/prompts'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PromptPresetLibrarySection } from '@/components/editor/presets/prompt-preset-library-section'
import { coerceCategory, type PromptTranslateFn } from '@/components/editor/prompts/middle-panel-prompts-shared'

type CategoryItem = {
    id: PromptCategory
    label: string
    Icon: LucideIcon
}

export function PromptLibrarySidebar({
    t,
    error,
    searchQuery,
    onSearchQueryChange,
    categories,
    promptsByCategory,
    expandedCategories,
    activeCategory,
    selectedPromptId,
    includeCallCountsByComponentName,
    includeWarningsByPromptId,
    categoryIconById,
    onSetActiveCategory,
    onToggleCategory,
    onSelectPrompt,
    onCreatePrompt,
    onOpenClipboardImport,
    onOpenJsonImport,
    builtinPresets,
    builtinPresetsLoading,
    builtinPresetsError,
    cloningPresetId,
    cloningAllPresets,
    cloneConflictNames,
    cloneOverwriteConfirmOpen,
    onClonePreset,
    onCloneAllPresets,
    onCloneOverwriteConfirmOpenChange,
    onConfirmCloneOverwrite,
}: {
    t: PromptTranslateFn
    error: string | null
    searchQuery: string
    onSearchQueryChange: (value: string) => void
    categories: readonly CategoryItem[]
    promptsByCategory: Record<PromptCategory, Prompt[]>
    expandedCategories: Record<PromptCategory, boolean>
    activeCategory: PromptCategory
    selectedPromptId: string | null
    includeCallCountsByComponentName: Map<string, number>
    includeWarningsByPromptId: Map<string, unknown[]>
    categoryIconById: Record<string, LucideIcon>
    onSetActiveCategory: (category: PromptCategory) => void
    onToggleCategory: (category: PromptCategory) => void
    onSelectPrompt: (id: string) => void
    onCreatePrompt: (category?: PromptCategory) => void | Promise<void>
    onOpenClipboardImport: () => void | Promise<void>
    onOpenJsonImport: () => void
    builtinPresets: BuiltinPromptPreset[]
    builtinPresetsLoading: boolean
    builtinPresetsError: string | null
    cloningPresetId: string | null
    cloningAllPresets: boolean
    cloneConflictNames: string[]
    cloneOverwriteConfirmOpen: boolean
    onClonePreset: (presetId: string, overwriteExisting?: boolean) => void | Promise<void>
    onCloneAllPresets: () => void | Promise<void>
    onCloneOverwriteConfirmOpenChange: (open: boolean) => void
    onConfirmCloneOverwrite: () => void | Promise<void>
}) {
    return (
        <section className="w-[340px] shrink-0 border-r bg-card flex flex-col">
            <div className="border-b p-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(event) => onSearchQueryChange(event.target.value)}
                            placeholder={t('library.searchPlaceholder')}
                            className="pl-8"
                        />
                    </div>
                    <Button variant="outline" size="icon-sm" title={t('library.filter')}>
                        <Filter className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1">
                                <Plus className="h-4 w-4" />
                                {t('actions.new')}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                            <DropdownMenuItem
                                onClick={() => void onOpenClipboardImport()}
                                className="items-start gap-3 py-2"
                            >
                                <Clipboard className="mt-0.5" />
                                <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">{t('actions.importFromClipboard')}</span>
                                    <span className="text-xs text-muted-foreground">{t('clipboard.import.description')}</span>
                                </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onOpenJsonImport} className="items-start gap-3 py-2">
                                <FileJson className="mt-0.5" />
                                <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">{t('actions.importFromJson')}</span>
                                    <span className="text-xs text-muted-foreground">{t('clipboard.import.description')}</span>
                                </div>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {categories.filter((category) => category.id !== 'default').map((category) => (
                                <DropdownMenuItem key={category.id} onClick={() => void onCreatePrompt(category.id)}>
                                    <category.Icon />
                                    {category.label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {error && <div className="border-b px-3 py-2 text-sm text-destructive">{error}</div>}

            <PromptPresetLibrarySection
                t={t}
                presets={builtinPresets}
                loading={builtinPresetsLoading}
                error={builtinPresetsError}
                cloningPresetId={cloningPresetId}
                cloningAll={cloningAllPresets}
                cloneConflictNames={cloneConflictNames}
                cloneOverwriteConfirmOpen={cloneOverwriteConfirmOpen}
                onClonePreset={onClonePreset}
                onCloneAllPresets={onCloneAllPresets}
                onCloneOverwriteConfirmOpenChange={onCloneOverwriteConfirmOpenChange}
                onConfirmCloneOverwrite={onConfirmCloneOverwrite}
            />

            <ScrollArea className="flex-1">
                <div className="py-2">
                    {categories.map((category) => {
                        const id = category.id
                        const isDefaultsCategory = id === 'default'
                        const count = isDefaultsCategory ? DEFAULT_PROMPT_SELECTION_CATEGORIES.length : promptsByCategory[id].length
                        const expanded = isDefaultsCategory ? false : expandedCategories[id]
                        const CategoryIcon = category.Icon ?? Sparkles

                        return (
                            <div key={id} className="mb-1">
                                <div
                                    className={cn(
                                        'w-full flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors',
                                        activeCategory === id ? 'bg-muted text-foreground' : 'hover:bg-muted'
                                    )}
                                >
                                    <button
                                        type="button"
                                        className="flex-1 px-3 py-2 flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                        onClick={() => {
                                            onSetActiveCategory(id)
                                            if (!isDefaultsCategory) onToggleCategory(id)
                                        }}
                                    >
                                        {isDefaultsCategory ? (
                                            <span className="h-4 w-4" />
                                        ) : expanded ? (
                                            <ChevronDown className="h-4 w-4" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4" />
                                        )}
                                        <CategoryIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{category.label}</span>
                                        <span className="ml-auto text-xs text-muted-foreground">{t('library.entries', { count })}</span>
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className={cn('mr-2', isDefaultsCategory && 'invisible')}
                                        onClick={() => void onCreatePrompt(id)}
                                        title={t('actions.newInCategory')}
                                        disabled={isDefaultsCategory}
                                    >
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>

                                {expanded && (
                                    <div className="px-2 pb-2">
                                        {count === 0 ? (
                                            <div className="px-2 py-2 text-xs text-muted-foreground">{t('library.empty')}</div>
                                        ) : (
                                            promptsByCategory[id].map((prompt) => {
                                                const isActive = prompt.id === selectedPromptId
                                                const Icon = categoryIconById[id] ?? Sparkles
                                                const promptCategory = coerceCategory(String(prompt.category))
                                                const includeCalls =
                                                    promptCategory === 'component'
                                                        ? includeCallCountsByComponentName.get((prompt.name ?? '').trim().toLowerCase()) ?? 0
                                                        : 0
                                                const includeWarnings = includeWarningsByPromptId.get(prompt.id) ?? []
                                                const hasIncludeErrors = includeWarnings.length > 0
                                                const isNsfw = prompt.isNsfw === true
                                                const definedInputsCount = prompt.inputs?.length ?? 0

                                                return (
                                                    <button
                                                        key={prompt.id}
                                                        type="button"
                                                        className={cn(
                                                            'group relative mb-1 w-full overflow-hidden rounded-xl border px-2 py-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 focus-visible:ring-offset-1',
                                                            isActive ? 'border-primary/40 bg-muted' : 'border-border hover:border-sky-200/60 hover:bg-muted'
                                                        )}
                                                        onClick={() => onSelectPrompt(prompt.id)}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors">
                                                                <Icon className="h-4 w-4" />
                                                            </span>
                                                            <span
                                                                className={cn(
                                                                    'flex-1 truncate text-sm',
                                                                    prompt.sourcePresetId && 'italic text-muted-foreground'
                                                                )}
                                                            >
                                                                {prompt.name?.trim() ? prompt.name : t('library.untitled')}
                                                            </span>
                                                            <div className="shrink-0 flex items-center gap-1">
                                                                {hasIncludeErrors && (
                                                                    <span
                                                                        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                                                                        title={t('advanced.preview.warningsTitle')}
                                                                        aria-label={t('advanced.preview.warningsTitle')}
                                                                        >
                                                                            <AlertTriangle className="h-3.5 w-3.5" />
                                                                        </span>
                                                                    )}
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="h-5 px-2 text-[11px] font-normal tabular-nums flex items-center gap-1"
                                                                    title={t('library.metrics.inputs', { count: definedInputsCount })}
                                                                >
                                                                    <SlidersHorizontal className="h-3 w-3" />
                                                                    {definedInputsCount}
                                                                </Badge>
                                                                {promptCategory === 'component' && (
                                                                    <Badge
                                                                        variant="secondary"
                                                                        className="h-5 px-2 text-[11px] font-normal tabular-nums flex items-center gap-1"
                                                                        title={t('library.metrics.calls', { count: includeCalls })}
                                                                    >
                                                                        <Link2 className="h-3 w-3" />
                                                                        {includeCalls}
                                                                    </Badge>
                                                                )}
                                                                {isNsfw && (
                                                                    <Badge
                                                                        variant="destructive"
                                                                        className="h-5 px-2 text-[11px] font-normal"
                                                                        title={t('badges.nsfw')}
                                                                    >
                                                                        {t('badges.nsfw')}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </button>
                                                )
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </ScrollArea>
        </section>
    )
}
