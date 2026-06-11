'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'
import { DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import {
    ApiError,
    DEFAULT_PROMPT_SELECTION_CATEGORIES,
    aiApi,
    promptApi,
    promptDefaultsApi,
    presetApi,
    type BuiltinPromptPreset,
    type DefaultPromptSelectionCategory,
    type Prompt,
    type PromptDefaultSelection,
} from '@/lib/api'
import type { ModelGroup, ModelSet } from '@/lib/ai-store'
import { getLlmBindableModelGroups } from '@/lib/model-bindings'
import { MODEL_SETS_CHANGED_EVENT } from '@/lib/model-set-events'
import { MODEL_GROUPS_CHANGED_EVENT } from '@/lib/model-group-events'
import { dispatchPromptsChangedEvent } from '@/lib/prompt-events'
import type { PromptCategory } from '@/lib/prompts'
import { cn } from '@/lib/utils'
import { PromptClipboardDialogs } from '@/components/editor/prompts/prompt-clipboard-dialogs'
import { PromptEditorPanel } from '@/components/editor/prompts/prompt-editor-panel'
import { PromptLibrarySidebar } from '@/components/editor/prompts/prompt-library-sidebar'
import { PromptPresetPublishDialog } from '@/components/editor/presets/prompt-preset-publish-dialog'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    buildComponentContentByNameKey,
    buildComponentPromptByNameKey,
    buildIncludeCallCounts,
    buildIncludeUsages,
    buildIncludeWarningsByPromptId,
    buildPromptCategories,
    buildPromptsByCategory,
    filterPromptsByQuery,
} from '@/components/editor/prompts/prompt-analysis'
import {
    getSaveLabel,
    normalizeKey,
    type PromptCategoryListItem,
} from '@/components/editor/prompts/middle-panel-prompts-shared'
import { usePromptClipboard } from '@/components/editor/prompts/use-prompt-clipboard'
import { usePromptDraftManager } from '@/components/editor/prompts/use-prompt-draft-manager'
import { usePromptViewState } from '@/components/editor/prompts/use-prompt-view-state'

type MiddlePanelPromptsProps = {
    novelId?: string
}

export function MiddlePanelPrompts({ novelId }: MiddlePanelPromptsProps) {
    const t = useTranslations('prompts')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [prompts, setPrompts] = useState<Prompt[]>([])
    const [defaultSelections, setDefaultSelections] = useState<Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>>>({})
    const [defaultSelectionsLoading, setDefaultSelectionsLoading] = useState(true)
    const [defaultSelectionsError, setDefaultSelectionsError] = useState<string | null>(null)
    const [defaultSelectionsSaving, setDefaultSelectionsSaving] = useState<DefaultPromptSelectionCategory | null>(null)
    const [modelGroups, setModelGroups] = useState<ModelGroup[]>([])
    const [modelSets, setModelSets] = useState<ModelSet[]>([])
    const [modelGroupsLoading, setModelGroupsLoading] = useState(false)
    const [modelSetsLoading, setModelSetsLoading] = useState(false)
    const [modelGroupsError, setModelGroupsError] = useState<string | null>(null)
    const [modelSetsError, setModelSetsError] = useState<string | null>(null)
    const [builtinPresets, setBuiltinPresets] = useState<BuiltinPromptPreset[]>([])
    const [builtinPresetsLoading, setBuiltinPresetsLoading] = useState(true)
    const [builtinPresetsError, setBuiltinPresetsError] = useState<string | null>(null)
    const [presetAuthoringEnabled, setPresetAuthoringEnabled] = useState(false)
    const [cloningPresetId, setCloningPresetId] = useState<string | null>(null)
    const [cloneOverwritePresetId, setCloneOverwritePresetId] = useState<string | null>(null)
    const [cloneConflictNames, setCloneConflictNames] = useState<string[]>([])
    const [cloneOverwriteConfirmOpen, setCloneOverwriteConfirmOpen] = useState(false)
    const [publishDialogOpen, setPublishDialogOpen] = useState(false)
    const [publishDialogMode, setPublishDialogMode] = useState<'create' | 'overwrite'>('create')
    const [publishPresetName, setPublishPresetName] = useState('')
    const [publishDescription, setPublishDescription] = useState('')
    const [publishOverwritePresetId, setPublishOverwritePresetId] = useState('')
    const [publishBusy, setPublishBusy] = useState(false)
    const [publishError, setPublishError] = useState<string | null>(null)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [includeCallCopied, setIncludeCallCopied] = useState(false)
    const includeCallCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const {
        selectedPromptId,
        setSelectedPromptId,
        activeCategory,
        setActiveCategory,
        expandedCategories,
        setExpandedCategories,
        searchQuery,
        setSearchQuery,
        editorTab,
        setEditorTab,
        toggleCategory,
    } = usePromptViewState(novelId)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const loadPrompts = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const { prompts: list } = await promptApi.list()
            setPrompts(list)
            setSelectedPromptId((prevSelected) => {
                if (prevSelected && list.some((item) => item.id === prevSelected)) return prevSelected
                return null
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load prompts'
            setError(message)
        } finally {
            setLoading(false)
        }
    }, [setSelectedPromptId])

    useEffect(() => {
        void loadPrompts()
    }, [loadPrompts])

    const loadDefaultSelections = useCallback(async () => {
        setDefaultSelectionsLoading(true)
        setDefaultSelectionsError(null)
        try {
            const { defaults } = await promptDefaultsApi.get()
            setDefaultSelections(defaults)
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load default prompts'
            setDefaultSelectionsError(message)
        } finally {
            setDefaultSelectionsLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadDefaultSelections()
    }, [loadDefaultSelections])

    const loadBuiltinPresets = useCallback(async () => {
        setBuiltinPresetsLoading(true)
        setBuiltinPresetsError(null)
        try {
            const { authoringEnabled, presets } = await presetApi.list()
            setPresetAuthoringEnabled(authoringEnabled)
            setBuiltinPresets(presets)
            setPublishOverwritePresetId((prev) => {
                if (prev && presets.some((preset) => preset.presetId === prev)) return prev
                return presets[0]?.presetId ?? ''
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load presets'
            setBuiltinPresetsError(message)
        } finally {
            setBuiltinPresetsLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadBuiltinPresets()
    }, [loadBuiltinPresets])

    useEffect(() => {
        let cancelled = false

        const loadModelGroups = async () => {
            setModelGroupsLoading(true)
            setModelGroupsError(null)
            try {
                const { groups } = await aiApi.listGroups()
                if (cancelled) return
                setModelGroups(getLlmBindableModelGroups(groups ?? []))
            } catch (err) {
                if (cancelled) return
                const message = err instanceof Error ? err.message : 'Failed to load model groups'
                setModelGroupsError(message)
            } finally {
                if (!cancelled) setModelGroupsLoading(false)
            }
        }

        void loadModelGroups()

        const handleModelGroupsChanged = () => {
            void loadModelGroups()
        }

        window.addEventListener(MODEL_GROUPS_CHANGED_EVENT, handleModelGroupsChanged)
        return () => {
            cancelled = true
            window.removeEventListener(MODEL_GROUPS_CHANGED_EVENT, handleModelGroupsChanged)
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        const loadModelSets = async () => {
            setModelSetsLoading(true)
            setModelSetsError(null)
            try {
                const { sets } = await aiApi.listModelSets()
                if (cancelled) return
                setModelSets(sets ?? [])
            } catch (err) {
                if (cancelled) return
                const message = err instanceof Error ? err.message : 'Failed to load model sets'
                setModelSetsError(message)
            } finally {
                if (!cancelled) setModelSetsLoading(false)
            }
        }

        void loadModelSets()

        const handleModelSetsChanged = () => {
            void loadModelSets()
        }

        window.addEventListener(MODEL_SETS_CHANGED_EVENT, handleModelSetsChanged)
        return () => {
            cancelled = true
            window.removeEventListener(MODEL_SETS_CHANGED_EVENT, handleModelSetsChanged)
        }
    }, [])

    const {
        draft,
        saveState,
        isComponent,
        systemMessage,
        additionalMessages,
        historyEnabled,
        historyCurrentValue,
        handleStartDraftNameEditing,
        handleEndDraftNameEditing,
        handleUpdateDraftName,
        handleUpdateDraftDescription,
        handleUpdateDraftCategory,
        handleUpdateDraftNsfw,
        handleUpdateDraftAllowLlmCall,
        handleUpdateDraftAllowAgentCall,
        handleUpdateDraftAgentCallMode,
        handleUpdateDraftInputs,
        handleAttachModelGroup,
        handleAttachModelSet,
        handleDetachModelSet,
        handleDetachModelGroup,
        handleSetPrimaryModelGroup,
        handleUpdateSystemMessage,
        handleUpdateComponentMessage,
        handleAddMessage,
        handleUpdateAdditionalMessage,
        handleDeleteAdditionalMessage,
        handleCopyMessage,
        handleDragEnd,
    } = usePromptDraftManager({
        prompts,
        modelGroups,
        modelSets,
        selectedPromptId,
        setPrompts,
        setError,
        setActiveCategory,
        setEditorTab,
        onPromptChanged: dispatchPromptsChangedEvent,
        t,
    })

    const selectedPrompt = useMemo(
        () => prompts.find((prompt) => prompt.id === selectedPromptId) ?? null,
        [prompts, selectedPromptId]
    )

    useEffect(() => {
        setHistoryOpen(false)
        setIncludeCallCopied(false)
    }, [draft?.id])

    useEffect(() => {
        return () => {
            if (includeCallCopiedTimerRef.current) clearTimeout(includeCallCopiedTimerRef.current)
        }
    }, [])

    const flashIncludeCallCopied = useCallback(() => {
        setIncludeCallCopied(true)
        if (includeCallCopiedTimerRef.current) clearTimeout(includeCallCopiedTimerRef.current)
        includeCallCopiedTimerRef.current = setTimeout(() => {
            setIncludeCallCopied(false)
            includeCallCopiedTimerRef.current = null
        }, 1200)
    }, [])

    const categories = useMemo(() => buildPromptCategories(t), [t])

    const categoryLabelById = useMemo(
        () => Object.fromEntries(categories.map((category) => [category.id, category.label])) as Record<string, string>,
        [categories]
    )

    const categoryIconById = useMemo(
        () => Object.fromEntries(categories.map((category) => [category.id, category.Icon])) as Record<string, PromptCategoryListItem['Icon']>,
        [categories]
    )

    const defaultSelectionRows = useMemo(
        () =>
            DEFAULT_PROMPT_SELECTION_CATEGORIES.map((category) => ({
                id: category,
                label: categoryLabelById[category] ?? category,
                Icon: categoryIconById[category],
            })),
        [categoryIconById, categoryLabelById]
    )

    const normalizedQuery = searchQuery.trim().toLowerCase()
    const filteredPrompts = useMemo(() => filterPromptsByQuery(prompts, normalizedQuery), [normalizedQuery, prompts])
    const promptsByCategory = useMemo(() => buildPromptsByCategory(filteredPrompts), [filteredPrompts])
    const llmCallablePromptsByCategory = useMemo(() => {
        const result: Record<DefaultPromptSelectionCategory, Prompt[]> = {
            scene_continuation: [],
            scene_action: [],
            text_replacement: [],
            ai_chat: [],
        }

        for (const prompt of prompts) {
            if (prompt.allowLlmCall !== true) continue
            const category = prompt.category as DefaultPromptSelectionCategory
            if (!DEFAULT_PROMPT_SELECTION_CATEGORIES.includes(category)) continue
            result[category].push(prompt)
        }

        for (const category of DEFAULT_PROMPT_SELECTION_CATEGORIES) {
            result[category].sort(
                (left, right) =>
                    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
                    right.updatedAt.localeCompare(left.updatedAt)
            )
        }

        return result
    }, [prompts])
    const includeCallCountsByComponentName = useMemo(() => buildIncludeCallCounts(prompts), [prompts])
    const componentContentByNameKey = useMemo(() => buildComponentContentByNameKey(prompts, draft), [draft, prompts])
    const componentPromptByNameKey = useMemo(() => buildComponentPromptByNameKey(prompts, draft), [draft, prompts])
    const includeWarningsByPromptId = useMemo(
        () => buildIncludeWarningsByPromptId(prompts, draft, componentContentByNameKey),
        [componentContentByNameKey, draft, prompts]
    )

    const draftId = draft?.id ?? null
    const draftName = (draft?.name ?? '').trim()
    const includeUsages = useMemo(
        () => buildIncludeUsages({ draftId, draftName, isComponent, prompts }),
        [draftId, draftName, isComponent, prompts]
    )

    const {
        clipboardExportOpen,
        setClipboardExportOpen,
        clipboardExportFormat,
        setClipboardExportFormat,
        clipboardExportBusy,
        clipboardExportError,
        setClipboardExportError,
        clipboardImportOpen,
        setClipboardImportOpen,
        clipboardImportText,
        setClipboardImportText,
        clipboardImportBundle,
        clipboardImportMode,
        setClipboardImportMode,
        clipboardImportBusy,
        clipboardImportError,
        clipboardImportOverwriteConfirmOpen,
        setClipboardImportOverwriteConfirmOpen,
        clipboardImportConflictNames,
        promptBundleJsonImportInputRef,
        clipboardExportAnalysis,
        clipboardImportAnalysis,
        performClipboardExport,
        handleCopyPromptToClipboard,
        handleExportPromptToJson,
        handleOpenClipboardImport,
        handleParseClipboardImport,
        handleOpenJsonImport,
        handleJsonImportFileSelected,
        handleRunClipboardImport,
        handleConfirmClipboardImportOverwrite,
        handleResetClipboardImportDialog,
        handleBackFromClipboardImportPreview,
    } = usePromptClipboard({
        prompts,
        draft,
        setPrompts,
        setError,
        setActiveCategory,
        setExpandedCategories,
        setSelectedPromptId,
        componentContentByNameKey,
        componentPromptByNameKey,
        onPromptChanged: dispatchPromptsChangedEvent,
        t,
    })

    const handleCreate = useCallback(async (category?: PromptCategory) => {
        const nextCategory = category ?? activeCategory ?? 'scene_continuation'
        try {
            setError(null)
            const { prompt } = await promptApi.create({
                name: t('actions.newPromptName'),
                category: nextCategory,
            })
            setPrompts((prev) => [prompt, ...prev])
            setExpandedCategories((prev) => ({ ...prev, [nextCategory]: true }))
            setSelectedPromptId(prompt.id)
            dispatchPromptsChangedEvent()
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.createFailed')}: ${detail}` : t('errors.createFailed'))
        }
    }, [activeCategory, setExpandedCategories, setSelectedPromptId, t])

    const handleClone = useCallback(async () => {
        if (!selectedPrompt) return
        try {
            setError(null)
            const { prompt } = await promptApi.clone(selectedPrompt.id)
            const clonedCategory = prompt.category as PromptCategory
            setPrompts((prev) => [prompt, ...prev])
            if (clonedCategory) {
                setExpandedCategories((prev) => ({ ...prev, [clonedCategory]: true }))
                setActiveCategory(clonedCategory)
            }
            setSelectedPromptId(prompt.id)
            dispatchPromptsChangedEvent()
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.cloneFailed')}: ${detail}` : t('errors.cloneFailed'))
        }
    }, [selectedPrompt, setActiveCategory, setExpandedCategories, setSelectedPromptId, t])

    const handleDeletePrompt = useCallback(async () => {
        if (!selectedPrompt) return
        try {
            setError(null)
            await promptApi.delete(selectedPrompt.id)
            setPrompts((prev) => prev.filter((prompt) => prompt.id !== selectedPrompt.id))
            setSelectedPromptId((prevSelected) => {
                if (prevSelected !== selectedPrompt.id) return prevSelected
                const remaining = prompts.filter((prompt) => prompt.id !== selectedPrompt.id)
                return remaining[0]?.id ?? null
            })
            dispatchPromptsChangedEvent()
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.deleteFailed')}: ${detail}` : t('errors.deleteFailed'))
        }
    }, [prompts, selectedPrompt, setSelectedPromptId, t])

    const handleClonePreset = useCallback(async (presetId: string, overwriteExisting = false) => {
        setCloningPresetId(presetId)
        setBuiltinPresetsError(null)
        try {
            const { prompts: importedPrompts } = await presetApi.clone(presetId, { overwriteExisting })
            const importedIds = new Set(importedPrompts.map((prompt) => prompt.id))
            setPrompts((prev) => [...importedPrompts, ...prev.filter((prompt) => !importedIds.has(prompt.id))])
            dispatchPromptsChangedEvent()

            const preset = builtinPresets.find((item) => item.presetId === presetId) ?? null
            const entryKey = normalizeKey(preset?.entryPromptName ?? importedPrompts[0]?.name ?? '')
            const entryPrompt = importedPrompts.find((prompt) => normalizeKey(prompt.name ?? '') === entryKey) ?? importedPrompts[0] ?? null
            if (entryPrompt) {
                const category = entryPrompt.category as PromptCategory
                if (category) {
                    setExpandedCategories((prev) => ({ ...prev, [category]: true }))
                    setActiveCategory(category)
                }
                setSelectedPromptId(entryPrompt.id)
            }

            setCloneOverwriteConfirmOpen(false)
            setCloneOverwritePresetId(null)
            setCloneConflictNames([])
        } catch (err) {
            if (err instanceof ApiError) {
                const data = err.data as { code?: unknown; names?: unknown } | undefined
                const names = Array.isArray(data?.names)
                    ? data.names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
                    : []

                if (err.status === 409 && data?.code === 'PROMPT_NAME_ALREADY_EXISTS' && names.length > 0 && !overwriteExisting) {
                    setCloneOverwritePresetId(presetId)
                    setCloneConflictNames(names)
                    setCloneOverwriteConfirmOpen(true)
                    return
                }
            }

            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setBuiltinPresetsError(detail || t('presets.errors.cloneFailed'))
        } finally {
            setCloningPresetId((prev) => (prev === presetId ? null : prev))
        }
    }, [builtinPresets, setActiveCategory, setExpandedCategories, setSelectedPromptId, t])

    const handleConfirmCloneOverwrite = useCallback(async () => {
        if (!cloneOverwritePresetId) return
        await handleClonePreset(cloneOverwritePresetId, true)
    }, [cloneOverwritePresetId, handleClonePreset])

    const handleOpenPublishDialog = useCallback((mode: 'create' | 'overwrite') => {
        if (!draft) return

        const promptName = (draft.name ?? '').trim() || t('actions.newPromptName')
        const matchingPreset = builtinPresets.find((preset) => {
            const key = normalizeKey(promptName)
            return normalizeKey(preset.entryPromptName) === key || normalizeKey(preset.name) === key
        }) ?? builtinPresets[0] ?? null

        setPublishDialogMode(mode)
        setPublishPresetName(mode === 'overwrite' ? matchingPreset?.name ?? promptName : promptName)
        setPublishDescription(mode === 'overwrite' ? matchingPreset?.description ?? draft.description ?? '' : draft.description ?? '')
        setPublishOverwritePresetId(matchingPreset?.presetId ?? builtinPresets[0]?.presetId ?? '')
        setPublishError(null)
        setPublishDialogOpen(true)
    }, [builtinPresets, draft, t])

    const handlePublishDialogOpenChange = useCallback((open: boolean) => {
        setPublishDialogOpen(open)
        if (!open) setPublishError(null)
    }, [])

    const handleSubmitPublishDialog = useCallback(async () => {
        if (!draft) return

        setPublishBusy(true)
        setPublishError(null)
        try {
            const description = publishDescription.trim() ? publishDescription.trim() : null
            if (publishDialogMode === 'create') {
                await presetApi.publish({
                    promptId: draft.id,
                    name: publishPresetName,
                    description,
                })
            } else {
                if (!publishOverwritePresetId) {
                    throw new Error(t('presets.errors.selectPreset'))
                }
                await presetApi.update(publishOverwritePresetId, {
                    promptId: draft.id,
                    name: publishPresetName,
                    description,
                })
            }

            await loadBuiltinPresets()
            setPublishDialogOpen(false)
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setPublishError(detail || t('presets.errors.publishFailed'))
        } finally {
            setPublishBusy(false)
        }
    }, [draft, loadBuiltinPresets, publishDescription, publishDialogMode, publishOverwritePresetId, publishPresetName, t])

    const handleSetDefaultSelection = useCallback(async (category: DefaultPromptSelectionCategory, selection: PromptDefaultSelection | null) => {
        setDefaultSelectionsSaving(category)
        setDefaultSelectionsError(null)
        try {
            const { defaults } = await promptDefaultsApi.set(category, selection)
            setDefaultSelections(defaults)
            dispatchPromptsChangedEvent()
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setDefaultSelectionsError(detail || t('errors.defaultSelectionFailed'))
        } finally {
            setDefaultSelectionsSaving((prev) => (prev === category ? null : prev))
        }
    }, [t])

    const includeWarnings = useMemo(
        () => (draft ? includeWarningsByPromptId.get(draft.id) ?? [] : []),
        [draft, includeWarningsByPromptId]
    )

    const handleCopyText = useCallback(async (value: string) => {
        try {
            await navigator.clipboard.writeText(value)
        } catch (err) {
            console.error(err)
        }
    }, [])

    const handleCopySystemMessage = useCallback(async () => {
        await handleCopyText(systemMessage?.content ?? '')
    }, [handleCopyText, systemMessage?.content])

    const handleCopyComponentMessage = useCallback(async () => {
        await handleCopyText(draft?.messages[0]?.content ?? '')
    }, [draft?.messages, handleCopyText])

    const handleCopyIncludeCall = useCallback(async () => {
        const name = (draft?.name ?? '').trim()
        const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const call = `{% include "${escaped}" %}`

        try {
            await navigator.clipboard.writeText(call)
            flashIncludeCallCopied()
        } catch (err) {
            console.error(err)
        }
    }, [draft?.name, flashIncludeCallCopied])

    const handlePasteClipboardImportText = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText()
            setClipboardImportText(text)
        } catch (err) {
            console.error(err)
        }
    }, [setClipboardImportText])

    const saveLabel = useMemo(() => getSaveLabel(t, saveState), [saveState, t])
    const inputsCount = draft?.inputs?.length ?? 0

    const tabs = useMemo(() => {
        if (!draft) return []
        if (isComponent) {
            return [
                { id: 'instructions' as const, label: t('tabs.instructions') },
                { id: 'advanced' as const, label: t('tabs.advanced'), count: inputsCount },
                { id: 'description' as const, label: t('tabs.description') },
                { id: 'usages' as const, label: t('tabs.usages'), count: includeUsages.totalCalls },
            ]
        }
        return [
            { id: 'general' as const, label: t('tabs.general') },
            { id: 'instructions' as const, label: t('tabs.instructions') },
            { id: 'advanced' as const, label: t('tabs.advanced') },
            { id: 'description' as const, label: t('tabs.description') },
        ]
    }, [draft, includeUsages.totalCalls, inputsCount, isComponent, t])

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                {t('status.loading')}
            </div>
        )
    }

    return (
        <>
            <div className="h-full flex">
                <PromptLibrarySidebar
                    t={t}
                    error={error}
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    categories={categories}
                    promptsByCategory={promptsByCategory}
                    expandedCategories={expandedCategories}
                    activeCategory={activeCategory}
                    selectedPromptId={selectedPromptId}
                    includeCallCountsByComponentName={includeCallCountsByComponentName}
                    includeWarningsByPromptId={includeWarningsByPromptId}
                    categoryIconById={categoryIconById}
                    onSetActiveCategory={setActiveCategory}
                    onToggleCategory={toggleCategory}
                    onSelectPrompt={setSelectedPromptId}
                    onCreatePrompt={(category) => void handleCreate(category)}
                    onOpenClipboardImport={() => void handleOpenClipboardImport()}
                    onOpenJsonImport={handleOpenJsonImport}
                    builtinPresets={builtinPresets}
                    builtinPresetsLoading={builtinPresetsLoading}
                    builtinPresetsError={builtinPresetsError}
                    cloningPresetId={cloningPresetId}
                    cloneConflictNames={cloneConflictNames}
                    cloneOverwriteConfirmOpen={cloneOverwriteConfirmOpen}
                    onClonePreset={(presetId, overwriteExisting) => void handleClonePreset(presetId, overwriteExisting)}
                    onCloneOverwriteConfirmOpenChange={setCloneOverwriteConfirmOpen}
                    onConfirmCloneOverwrite={() => void handleConfirmCloneOverwrite()}
                />

                {activeCategory === 'default' ? (
                    <section className="flex-1 min-w-0 overflow-auto p-5">
                        <div className="mb-4">
                            <div className="text-lg font-semibold">{t('defaults.title')}</div>
                            <div className="mt-1 text-sm text-muted-foreground">{t('defaults.hint')}</div>
                        </div>

                        {defaultSelectionsError && (
                            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                {defaultSelectionsError}
                            </div>
                        )}

                        <div className="overflow-hidden rounded-lg border">
                            <div className="grid grid-cols-[200px_minmax(0,1fr)_80px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                                <div>{t('defaults.type')}</div>
                                <div>{t('defaults.prompt')}</div>
                                <div className="text-right">{t('defaults.reset')}</div>
                            </div>

                            <div className="divide-y">
                                {defaultSelectionRows.map((row) => {
                                    const selection = defaultSelections[row.id] ?? null
                                    const options = llmCallablePromptsByCategory[row.id] ?? []
                                    const selectedPromptId = typeof selection?.promptId === 'string' ? selection.promptId : null
                                    const selectedPrompt = options.find((prompt) => prompt.id === selectedPromptId) ?? null
                                    const isSaving = defaultSelectionsSaving === row.id

                                    return (
                                        <div
                                            key={row.id}
                                            className="grid grid-cols-[200px_minmax(0,1fr)_80px] items-center gap-3 px-4 py-3"
                                        >
                                            <div className="flex min-w-0 items-center gap-2">
                                                <row.Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                <div className="truncate text-sm font-medium">{row.label}</div>
                                            </div>

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        type="button"
                                                        disabled={defaultSelectionsLoading || isSaving}
                                                        className={cn(
                                                            'border-input focus-visible:border-ring focus-visible:ring-ring/50 flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50'
                                                        )}
                                                    >
                                                        <span className="min-w-0 flex-1 truncate text-left">
                                                            {selectedPrompt?.name ?? t('defaults.none')}
                                                        </span>
                                                        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                                                    </button>
                                                </DropdownMenuTrigger>

                                                <DropdownMenuContent align="start" className="min-w-[280px]">
                                                    <DropdownMenuItem onSelect={() => void handleSetDefaultSelection(row.id, null)}>
                                                        <div className="flex w-full items-center justify-between gap-2">
                                                            <span className="min-w-0 truncate">{t('defaults.none')}</span>
                                                            {!selectedPrompt && <Check className="h-4 w-4 opacity-70" />}
                                                        </div>
                                                    </DropdownMenuItem>

                                                    {options.length > 0 && <DropdownMenuSeparator />}

                                                    {options.map((option) => {
                                                        const isSelected = selectedPrompt?.id === option.id
                                                        return (
                                                            <DropdownMenuItem
                                                                key={option.id}
                                                                onSelect={() => void handleSetDefaultSelection(row.id, { promptId: option.id })}
                                                            >
                                                                <div className="flex w-full items-center justify-between gap-3">
                                                                    <span className="min-w-0 truncate">{option.name}</span>
                                                                    {isSelected && <Check className="h-4 w-4 shrink-0 opacity-70" />}
                                                                </div>
                                                            </DropdownMenuItem>
                                                        )
                                                    })}
                                                </DropdownMenuContent>
                                            </DropdownMenu>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="justify-self-end"
                                                disabled={defaultSelectionsLoading || isSaving || !selectedPrompt}
                                                onClick={() => void handleSetDefaultSelection(row.id, null)}
                                            >
                                                {t('defaults.reset')}
                                            </Button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </section>
                ) : (
                    <PromptEditorPanel
                        t={t}
                        draft={draft}
                        error={error}
                        editorTab={editorTab}
                        tabs={tabs}
                        saveLabel={saveLabel}
                        saveState={saveState}
                        categories={categories}
                        isComponent={isComponent}
                        includeWarnings={includeWarnings}
                        includeUsages={includeUsages}
                        categoryLabelById={categoryLabelById}
                        categoryIconById={categoryIconById}
                        novelId={novelId}
                        allPrompts={prompts}
                        modelGroups={modelGroups}
                        modelSets={modelSets}
                        modelGroupsLoading={modelGroupsLoading}
                        modelSetsLoading={modelSetsLoading}
                        modelGroupsError={modelGroupsError}
                        modelSetsError={modelSetsError}
                        systemMessage={systemMessage}
                        additionalMessages={additionalMessages}
                        historyEnabled={historyEnabled}
                        historyOpen={historyOpen}
                        historyCurrentValue={historyCurrentValue}
                        includeCallCopied={includeCallCopied}
                        sensors={sensors}
                        onSelectPrompt={setSelectedPromptId}
                        onEditorTabChange={setEditorTab}
                        onClone={() => void handleClone()}
                        onDeletePrompt={() => void handleDeletePrompt()}
                        onCopyPromptToClipboard={() => void handleCopyPromptToClipboard()}
                        onExportPromptToJson={() => void handleExportPromptToJson()}
                        canPublishPresets={presetAuthoringEnabled}
                        onOpenPublishDialog={(mode) => void handleOpenPublishDialog(mode)}
                        onStartDraftNameEditing={handleStartDraftNameEditing}
                        onEndDraftNameEditing={handleEndDraftNameEditing}
                        onUpdateDraftName={handleUpdateDraftName}
                        onUpdateDraftDescription={handleUpdateDraftDescription}
                        onUpdateDraftCategory={(category) => {
                            setExpandedCategories((prev) => ({ ...prev, [category]: true }))
                            handleUpdateDraftCategory(category)
                        }}
                        onUpdateDraftNsfw={handleUpdateDraftNsfw}
                        onUpdateDraftAllowLlmCall={handleUpdateDraftAllowLlmCall}
                        onUpdateDraftAllowAgentCall={handleUpdateDraftAllowAgentCall}
                        onUpdateDraftAgentCallMode={handleUpdateDraftAgentCallMode}
                        onUpdateDraftInputs={handleUpdateDraftInputs}
                        onAttachModelGroup={handleAttachModelGroup}
                        onAttachModelSet={handleAttachModelSet}
                        onDetachModelSet={handleDetachModelSet}
                        onDetachModelGroup={handleDetachModelGroup}
                        onSetPrimaryModelGroup={handleSetPrimaryModelGroup}
                        onUpdateSystemMessage={handleUpdateSystemMessage}
                        onCopySystemMessage={() => void handleCopySystemMessage()}
                        onUpdateComponentMessage={handleUpdateComponentMessage}
                        onCopyComponentMessage={() => void handleCopyComponentMessage()}
                        onCopyIncludeCall={() => void handleCopyIncludeCall()}
                        onSetHistoryOpen={setHistoryOpen}
                        onRestoreHistory={(value) => {
                            if (isComponent) {
                                handleUpdateComponentMessage(value)
                                return
                            }
                            handleUpdateSystemMessage(value)
                        }}
                        onAddMessage={handleAddMessage}
                        onUpdateAdditionalMessage={handleUpdateAdditionalMessage}
                        onCopyMessage={(messageId) => void handleCopyMessage(messageId)}
                        onDeleteAdditionalMessage={handleDeleteAdditionalMessage}
                        onDragEnd={handleDragEnd as (event: DragEndEvent) => void}
                    />
                )}
            </div>

            <PromptClipboardDialogs
                t={t}
                clipboardExportOpen={clipboardExportOpen}
                clipboardExportFormat={clipboardExportFormat}
                clipboardExportBusy={clipboardExportBusy}
                clipboardExportError={clipboardExportError}
                clipboardExportAnalysis={clipboardExportAnalysis}
                clipboardImportOpen={clipboardImportOpen}
                clipboardImportText={clipboardImportText}
                clipboardImportBundle={clipboardImportBundle}
                clipboardImportMode={clipboardImportMode}
                clipboardImportBusy={clipboardImportBusy}
                clipboardImportError={clipboardImportError}
                clipboardImportOverwriteConfirmOpen={clipboardImportOverwriteConfirmOpen}
                clipboardImportConflictNames={clipboardImportConflictNames}
                clipboardImportAnalysis={clipboardImportAnalysis}
                promptBundleJsonImportInputRef={promptBundleJsonImportInputRef}
                onClipboardExportOpenChange={setClipboardExportOpen}
                onClipboardExportFormatChange={setClipboardExportFormat}
                onClearClipboardExportError={() => setClipboardExportError(null)}
                onPerformClipboardExport={(format) => void performClipboardExport(format)}
                onClipboardImportOpenChange={setClipboardImportOpen}
                onClipboardImportTextChange={setClipboardImportText}
                onClipboardImportModeChange={setClipboardImportMode}
                onResetClipboardImportDialog={handleResetClipboardImportDialog}
                onBackFromClipboardImportPreview={handleBackFromClipboardImportPreview}
                onPasteClipboardImportText={() => void handlePasteClipboardImportText()}
                onParseClipboardImport={handleParseClipboardImport}
                onRunClipboardImport={() => void handleRunClipboardImport()}
                onConfirmClipboardImportOverwrite={() => void handleConfirmClipboardImportOverwrite()}
                onClipboardImportOverwriteConfirmOpenChange={setClipboardImportOverwriteConfirmOpen}
                onJsonImportFileSelected={(event) => void handleJsonImportFileSelected(event)}
            />

            <PromptPresetPublishDialog
                t={t}
                open={publishDialogOpen}
                mode={publishDialogMode}
                presets={builtinPresets}
                presetName={publishPresetName}
                description={publishDescription}
                overwritePresetId={publishOverwritePresetId}
                busy={publishBusy}
                error={publishError}
                onOpenChange={handlePublishDialogOpenChange}
                onPresetNameChange={setPublishPresetName}
                onDescriptionChange={setPublishDescription}
                onOverwritePresetIdChange={(presetId) => {
                    const preset = builtinPresets.find((item) => item.presetId === presetId) ?? null
                    setPublishOverwritePresetId(presetId)
                    if (preset) {
                        setPublishPresetName(preset.name)
                        setPublishDescription(preset.description ?? '')
                    }
                }}
                onSubmit={() => void handleSubmitPublishDialog()}
            />
        </>
    )
}
