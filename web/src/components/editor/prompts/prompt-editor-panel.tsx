'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, GripVertical, History as HistoryIcon, MoreVertical, Plus, Sparkles, X, type LucideIcon } from 'lucide-react'
import { DndContext, closestCenter, type DragEndEvent, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { Prompt } from '@/lib/api'
import type { ModelGroup, ModelSet } from '@/lib/ai-store'
import type { PromptCategory, PromptMessage } from '@/lib/prompts'
import type { PromptTemplateRenderWarning } from '@/lib/prompt-template-render'
import { cn } from '@/lib/utils'
import { ModelGroupLogoIcon } from '@/components/ai/model-group-logo-icon'
import { InputsEditor } from '@/components/editor/inputs-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { PromptHistoryDialog } from '@/components/editor/prompts/prompt-history-dialog'
import { PromptTemplateEditor } from '@/components/editor/prompts/prompt-template-editor'
import { SortableMessageCard } from '@/components/editor/prompts/prompt-message-card'
import {
    coerceCategory,
    getPromptWarningMessage,
    type PromptDraft,
    type PromptEditorTab,
    type PromptTranslateFn,
} from '@/components/editor/prompts/middle-panel-prompts-shared'

type CategoryItem = {
    id: PromptCategory
    label: string
    Icon: LucideIcon
}

export function PromptEditorPanel({
    t,
    draft,
    error,
    editorTab,
    tabs,
    saveLabel,
    saveState,
    categories,
    isComponent,
    includeWarnings,
    includeUsages,
    categoryLabelById,
    categoryIconById,
    novelId,
    allPrompts,
    modelGroups,
    modelSets,
    modelGroupsLoading,
    modelSetsLoading,
    modelGroupsError,
    modelSetsError,
    systemMessage,
    additionalMessages,
    historyEnabled,
    historyOpen,
    historyCurrentValue,
    includeCallCopied,
    sensors,
    onSelectPrompt,
    onEditorTabChange,
    onClone,
    onDeletePrompt,
    onCopyPromptToClipboard,
    onExportPromptToJson,
    canPublishPresets,
    onOpenPublishDialog,
    readOnly,
    presetSourceRevision,
    presetUpdateAvailable,
    onClonePresetUpdate,
    onStartDraftNameEditing,
    onEndDraftNameEditing,
    onUpdateDraftName,
    onUpdateDraftDescription,
    onUpdateDraftCategory,
    onUpdateDraftNsfw,
    onUpdateDraftAllowLlmCall,
    onUpdateDraftAllowAgentCall,
    onUpdateDraftInputs,
    onAttachModelGroup,
    onAttachModelSet,
    onDetachModelSet,
    onDetachModelGroup,
    onSetPrimaryModelGroup,
    onUpdateSystemMessage,
    onCopySystemMessage,
    onUpdateComponentMessage,
    onCopyComponentMessage,
    onCopyIncludeCall,
    onSetHistoryOpen,
    onRestoreHistory,
    onAddMessage,
    onUpdateAdditionalMessage,
    onCopyMessage,
    onDeleteAdditionalMessage,
    onDragEnd,
}: {
    t: PromptTranslateFn
    draft: PromptDraft | null
    error: string | null
    editorTab: PromptEditorTab
    tabs: Array<{ id: PromptEditorTab; label: string; count?: number }>
    saveLabel: string
    saveState: 'idle' | 'saving' | 'saved' | 'error'
    categories: readonly CategoryItem[]
    isComponent: boolean
    includeWarnings: PromptTemplateRenderWarning[]
    includeUsages: { totalCalls: number; items: Array<{ prompt: Prompt; calls: number }> }
    categoryLabelById: Record<string, string>
    categoryIconById: Record<string, LucideIcon>
    novelId?: string
    allPrompts: Prompt[]
    modelGroups: ModelGroup[]
    modelSets: ModelSet[]
    modelGroupsLoading: boolean
    modelSetsLoading: boolean
    modelGroupsError: string | null
    modelSetsError: string | null
    systemMessage: PromptMessage | null
    additionalMessages: PromptMessage[]
    historyEnabled: boolean
    historyOpen: boolean
    historyCurrentValue: string
    includeCallCopied: boolean
    sensors: ReturnType<typeof useSensors>
    onSelectPrompt: (id: string) => void
    onEditorTabChange: (tab: PromptEditorTab) => void
    onClone: () => void | Promise<void>
    onDeletePrompt: () => void | Promise<void>
    onCopyPromptToClipboard: () => void | Promise<void>
    onExportPromptToJson: () => void | Promise<void>
    canPublishPresets: boolean
    onOpenPublishDialog: (mode: 'create' | 'overwrite') => void | Promise<void>
    readOnly: boolean
    presetSourceRevision: number | null
    presetUpdateAvailable: boolean
    onClonePresetUpdate: () => void | Promise<void>
    onStartDraftNameEditing: () => void
    onEndDraftNameEditing: () => void
    onUpdateDraftName: (value: string) => void
    onUpdateDraftDescription: (value: string) => void
    onUpdateDraftCategory: (category: PromptCategory) => void
    onUpdateDraftNsfw: (isNsfw: boolean) => void
    onUpdateDraftAllowLlmCall: (allowLlmCall: boolean) => void
    onUpdateDraftAllowAgentCall: (allowAgentCall: boolean) => void
    onUpdateDraftAgentCallMode: (agentCallMode: Prompt['agentCallMode']) => void
    onUpdateDraftInputs: (inputs: Prompt['inputs']) => void
    onAttachModelGroup: (groupId: string) => void
    onAttachModelSet: (setId: string) => void
    onDetachModelSet: (setId: string) => void
    onDetachModelGroup: (groupId: string) => void
    onSetPrimaryModelGroup: (groupId: string) => void
    onUpdateSystemMessage: (content: string) => void
    onCopySystemMessage: () => void | Promise<void>
    onUpdateComponentMessage: (content: string) => void
    onCopyComponentMessage: () => void | Promise<void>
    onCopyIncludeCall: () => void | Promise<void>
    onSetHistoryOpen: (open: boolean) => void
    onRestoreHistory: (value: string) => void
    onAddMessage: () => void
    onUpdateAdditionalMessage: (messageId: string, updates: Partial<Pick<PromptMessage, 'role' | 'content'>>) => void
    onCopyMessage: (messageId: string) => void | Promise<void>
    onDeleteAdditionalMessage: (messageId: string) => void
    onDragEnd: (event: DragEndEvent) => void
}) {
    const [activeEditorId, setActiveEditorId] = useState<string | null>(null)
    const [insertRequest, setInsertRequest] = useState<{ id: number; targetId: string; text: string } | null>(null)
    const [templateReferenceExpanded, setTemplateReferenceExpanded] = useState(false)
    const hasRestoredTemplateReferenceRef = useRef(false)
    const fallbackTargetId = isComponent ? 'component' : 'system'
    const validEditorIds = useMemo(() => {
        const ids = new Set<string>([fallbackTargetId])
        for (const message of additionalMessages) ids.add(message.id)
        return ids
    }, [additionalMessages, fallbackTargetId])
    const activeEditorIdCandidate = activeEditorId && validEditorIds.has(activeEditorId) ? activeEditorId : null
    const resolvedActiveEditorId = activeEditorIdCandidate ?? fallbackTargetId
    const templateReferenceStorageKey = useMemo(
        () => `editor_prompt_template_reference_expanded_${draft?.id ?? draft?.category ?? 'global'}`,
        [draft?.category, draft?.id]
    )

    useEffect(() => {
        if (typeof window === 'undefined') return
        hasRestoredTemplateReferenceRef.current = false
        try {
            const raw = window.localStorage.getItem(templateReferenceStorageKey)
            if (raw != null) setTemplateReferenceExpanded(raw === 'true')
        } catch {
            // Ignore invalid persisted state.
        } finally {
            hasRestoredTemplateReferenceRef.current = true
        }
    }, [templateReferenceStorageKey])

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (!hasRestoredTemplateReferenceRef.current) return
        window.localStorage.setItem(templateReferenceStorageKey, String(templateReferenceExpanded))
    }, [templateReferenceExpanded, templateReferenceStorageKey])

    const handleInsertTemplateSnippet = (text: string) => {
        const targetId = activeEditorIdCandidate ?? fallbackTargetId
        setInsertRequest({ id: Date.now(), targetId, text })
    }

    const templateReferenceItems = [
        { key: '{{ novel.language }}', description: t('editor.templateReference.novelLanguage') },
        { key: '{{ novel.outline }}', description: t('editor.templateReference.novelOutline') },
        { key: '{{ novel.outline.storysofar }}', description: t('editor.templateReference.novelOutlineStorySoFar') },
        { key: '{{ novel.outline.full }}', description: t('editor.templateReference.novelOutlineFull') },
        { key: '{{ instruction.text }}', description: t('editor.templateReference.instructionText') },
        { key: '{{ instruction.terms.text }}', description: t('editor.templateReference.instructionTermsText') },
        { key: '{{ instruction.terms.value }}', description: t('editor.templateReference.instructionTermsValue') },
        { key: '{% set wordsCloud = "不少于1000" %}', description: t('editor.templateReference.setVariable') },
        { key: '{{ ["a", "b", "c"] | random }}', description: t('editor.templateReference.randomChoice') },
        { key: '{{ roll("1d6") }}', description: t('editor.templateReference.rollDice') },
        { key: '{{ value | trim }}', description: t('editor.templateReference.trimValue') },
        { key: '{# 注释不会发送给模型 #}', description: t('editor.templateReference.comment') },
        { key: '{{ chat.userInput }}', description: t('editor.templateReference.chatUserInput') },
        { key: '{{ chat.userInput.terms.text }}', description: t('editor.templateReference.chatUserInputTermsText') },
        { key: '{{ chat.userInput.terms.value }}', description: t('editor.templateReference.chatUserInputTermsValue') },
        { key: '{{ chat.history }}', description: t('editor.templateReference.chatHistory') },
        { key: '{{ chat.history.terms.text }}', description: t('editor.templateReference.chatHistoryTermsText') },
        { key: '{{ chat.history.terms.value }}', description: t('editor.templateReference.chatHistoryTermsValue') },
        { key: '{{ scene.text }}', description: t('editor.templateReference.sceneText') },
        { key: '{{ scene.previousText }}', description: t('editor.templateReference.scenePreviousText') },
        { key: '{{ scene.followText }}', description: t('editor.templateReference.sceneFollowText') },
        { key: '{% if scene.hasPreviousText %}...{% endif %}', description: t('editor.templateReference.sceneHasPreviousText') },
        { key: '{{ scene.chapterOutline }}', description: t('editor.templateReference.sceneChapterOutline') },
        { key: '{{ scene.actOutline }}', description: t('editor.templateReference.sceneActOutline') },
        { key: '{% if scene.hasChapterOutline %}...{% endif %}', description: t('editor.templateReference.sceneHasChapterOutline') },
        { key: '{% if scene.hasActOutline %}...{% endif %}', description: t('editor.templateReference.sceneHasActOutline') },
        { key: '{{ inputs["角色"].text }}', description: t('editor.templateReference.inputText') },
        { key: '{{ inputs["角色"].value }}', description: t('editor.templateReference.inputValue') },
        { key: '{{ inputs["角色"].term.text }}', description: t('editor.templateReference.inputTermText') },
        { key: '{{ inputs["角色"].term.value }}', description: t('editor.templateReference.inputTermValue') },
        { key: '{{ inputs["角色"].termTag.text }}', description: t('editor.templateReference.inputTermTagText') },
        { key: '{{ inputs["角色"].termTag.value }}', description: t('editor.templateReference.inputTermTagValue') },
        { key: '{{ inputs["额外信息"].snippet.text }}', description: t('editor.templateReference.inputSnippetText') },
        { key: '{{ inputs["额外信息"].snippet.value }}', description: t('editor.templateReference.inputSnippetValue') },
        { key: '{{ inputs["额外信息"].fullNovel.text }}', description: t('editor.templateReference.inputFullNovelText') },
        { key: '{{ inputs["额外信息"].fullNovel.value }}', description: t('editor.templateReference.inputFullNovelValue') },
        { key: '{{ inputs["额外信息"].act.text }}', description: t('editor.templateReference.inputActText') },
        { key: '{{ inputs["额外信息"].act.value }}', description: t('editor.templateReference.inputActValue') },
        { key: '{{ inputs["额外信息"].chapter.text }}', description: t('editor.templateReference.inputChapterText') },
        { key: '{{ inputs["额外信息"].chapter.value }}', description: t('editor.templateReference.inputChapterValue') },
        { key: '{{ inputs["额外信息"].scene.text }}', description: t('editor.templateReference.inputSceneText') },
        { key: '{{ inputs["额外信息"].scene.value }}', description: t('editor.templateReference.inputSceneValue') },
        { key: '{{ inputs["额外信息"].actOutline.text }}', description: t('editor.templateReference.inputActOutlineText') },
        { key: '{{ inputs["额外信息"].actOutline.value }}', description: t('editor.templateReference.inputActOutlineValue') },
        { key: '{{ inputs["额外信息"].chapterOutline.text }}', description: t('editor.templateReference.inputChapterOutlineText') },
        { key: '{{ inputs["额外信息"].chapterOutline.value }}', description: t('editor.templateReference.inputChapterOutlineValue') },
        {
            key: '{% set terms = instruction.terms | union(inputs["角色"].term) %}',
            description: t('editor.templateReference.unionTerms'),
        },
        {
            key: '{% set terms = chat.userInput.terms | union(chat.history.terms) | union(inputs["额外信息"].term) | union(inputs["额外信息"].termTag) %}',
            description: t('editor.templateReference.chatUnionTerms'),
        },
        { key: '{% include "组件名" %}', description: t('editor.templateReference.includeComponent') },
    ]
    const attachedModelGroupIds = draft?.modelGroupIds ?? []
    const attachedModelSetIds = draft?.modelSetIds ?? []
    const availableModelGroups = useMemo(
        () => modelGroups.filter((group) => !attachedModelGroupIds.includes(group.id)),
        [attachedModelGroupIds, modelGroups]
    )
    const availableModelSets = useMemo(
        () => modelSets.filter((setItem) => !attachedModelSetIds.includes(setItem.id)),
        [attachedModelSetIds, modelSets]
    )
    const attachedModelSets = useMemo(
        () => attachedModelSetIds.map((setId) => modelSets.find((setItem) => setItem.id === setId) ?? { id: setId, name: setId, members: [] }),
        [attachedModelSetIds, modelSets]
    )
    const boundModelGroups = useMemo(
        () =>
            attachedModelGroupIds.map((groupId, index) => {
                const group = modelGroups.find((item) => item.id === groupId) ?? null
                return {
                    id: groupId,
                    group,
                    missing: !group,
                    isPrimary: index === 0,
                }
            }),
        [attachedModelGroupIds, modelGroups]
    )

    const handleNavigateToPromptAdvanced = ({ promptId, inputId }: { promptId: string; inputId?: string }) => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(
                'editor_prompt_input_navigation',
                JSON.stringify({
                    promptId,
                    inputId: inputId?.trim() || null,
                })
            )
        }
        onSelectPrompt(promptId)
        onEditorTabChange('advanced')
    }

    return (
        <section className="flex-1 min-w-0 flex flex-col">
            {!draft ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    {t('editor.emptyState')}
                </div>
            ) : (
                <div className="flex-1 min-w-0 overflow-auto p-5">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="shrink-0 text-sm font-medium">{t('editor.name')}</div>
                        <Input
                            value={draft.name}
                            disabled={readOnly}
                            onFocus={onStartDraftNameEditing}
                            onBlur={onEndDraftNameEditing}
                            onChange={(event) => onUpdateDraftName(event.target.value)}
                        />
                    </div>

                    {readOnly && (
                        <div className="mb-4 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-300">
                            <div>
                                {presetSourceRevision != null
                                    ? t('editor.presetReadOnlyNoticeVersioned', { revision: presetSourceRevision.toFixed(1) })
                                    : t('editor.presetReadOnlyNotice')}
                            </div>
                            {presetUpdateAvailable && (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="font-medium">{t('editor.presetUpdateAvailable')}</span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 border-amber-400/60 bg-background/60"
                                        onClick={() => void onClonePresetUpdate()}
                                    >
                                        <Sparkles className="h-3.5 w-3.5" />
                                        {t('editor.presetUpdateClone')}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {error}
                        </div>
                    )}

                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            {tabs.map((tab) => (
                                <Button
                                    key={tab.id}
                                    variant="ghost"
                                    size="sm"
                                    className={cn('px-2 rounded-none', editorTab === tab.id && 'border-b-2 border-primary')}
                                    onClick={() => onEditorTabChange(tab.id)}
                                >
                                    <span className="flex items-center gap-2">
                                        <span>{tab.label}</span>
                                        {tab.count ? (
                                            <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                                                {tab.count}
                                            </Badge>
                                        ) : null}
                                    </span>
                                </Button>
                            ))}
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                            {includeWarnings.length > 0 && (
                                <span
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                                    title={t('advanced.preview.warningsTitle')}
                                    aria-label={t('advanced.preview.warningsTitle')}
                                >
                                    <AlertTriangle className="h-4 w-4" />
                                </span>
                            )}
                            {saveLabel && (
                                <span className={cn('text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                                    {saveLabel}
                                </span>
                            )}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="icon-sm" title={t('actions.more')}>
                                        <MoreVertical className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {canPublishPresets && (
                                        <>
                                            <DropdownMenuItem onClick={() => void onOpenPublishDialog('create')}>
                                                {t('presets.publish.createMenu')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => void onOpenPublishDialog('overwrite')}>
                                                {t('presets.publish.overwriteMenu')}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                        </>
                                    )}
                                    <DropdownMenuItem onClick={() => void onClone()}>{t('actions.clonePrompt')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void onCopyPromptToClipboard()}>{t('actions.copyToClipboard')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void onExportPromptToJson()}>{t('actions.exportToJson')}</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive" onClick={() => void onDeletePrompt()}>
                                        {t('actions.deletePrompt')}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    <Separator className="mb-4" />

                    {/* Model bindings are user-local, not preset content — kept outside the read-only
                        fieldset so a preset-sourced prompt can still bind/unbind models in place. */}
                    {editorTab === 'general' && (
                        <div className="mb-4">
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
                                <div className="flex h-full flex-col space-y-3 rounded-xl border bg-card p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium">{t('general.modelGroups.title')}</div>
                                            <div className="text-xs text-muted-foreground">{t('general.modelGroups.hint')}</div>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-1"
                                                    disabled={modelGroupsLoading || availableModelGroups.length === 0}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                    {t('general.modelGroups.attach')}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="min-w-[260px]">
                                                {availableModelGroups.map((group) => (
                                                    <DropdownMenuItem key={group.id} onClick={() => onAttachModelGroup(group.id)}>
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <ModelGroupLogoIcon group={group} fallbackLabel={group.name} />
                                                            <span className="truncate">{group.name}</span>
                                                        </div>
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>

                                    {modelGroupsError && (
                                        <div className="text-sm text-destructive">{modelGroupsError}</div>
                                    )}

                                    {modelGroupsLoading && (
                                        <div className="text-sm text-muted-foreground">{t('general.modelGroups.loading')}</div>
                                    )}

                                    {boundModelGroups.length === 0 ? (
                                        <div className="text-sm text-muted-foreground">{t('general.modelGroups.empty')}</div>
                                    ) : (
                                        <div className="grid gap-2 lg:grid-cols-2">
                                            {boundModelGroups.map(({ id, group, missing, isPrimary }) => (
                                                <div key={id} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                                                    <div className="min-w-0 space-y-1">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <ModelGroupLogoIcon
                                                                group={group}
                                                                fallbackLabel={group?.name ?? id}
                                                                className="h-5 w-5 rounded-md"
                                                                imageClassName="h-5 w-5"
                                                            />
                                                            <div className="truncate text-sm font-medium">
                                                                {group?.name ?? id}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        {isPrimary ? (
                                                            <Badge variant="default" className="gap-1">
                                                                <Check className="h-3 w-3" />
                                                                {t('general.modelGroups.primary')}
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline">{t('general.modelGroups.candidate')}</Badge>
                                                        )}
                                                        {missing && <Badge variant="outline">{t('general.modelGroups.missing')}</Badge>}
                                                        {!isPrimary && (
                                                            <Button type="button" variant="outline" size="sm" onClick={() => onSetPrimaryModelGroup(id)}>
                                                                {t('general.modelGroups.setPrimary')}
                                                            </Button>
                                                        )}
                                                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDetachModelGroup(id)}>
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex h-full flex-col space-y-3 rounded-xl border bg-card p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium">{t('general.modelGroups.setsTitle')}</div>
                                            <div className="text-xs text-muted-foreground">{t('general.modelGroups.setsHint')}</div>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-1"
                                                    disabled={modelSetsLoading || availableModelSets.length === 0}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                    {t('general.modelGroups.attachSet')}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="min-w-[260px]">
                                                {availableModelSets.map((setItem) => (
                                                    <DropdownMenuItem key={setItem.id} onClick={() => onAttachModelSet(setItem.id)}>
                                                        <div className="flex w-full items-center justify-between gap-3">
                                                            <span className="truncate">{setItem.name}</span>
                                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                                {t('general.modelGroups.setMemberCount', { count: setItem.members?.length ?? 0 })}
                                                            </span>
                                                        </div>
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>

                                    {modelSetsError && (
                                        <div className="text-sm text-destructive">{modelSetsError}</div>
                                    )}

                                    {attachedModelSets.length === 0 ? (
                                        <div className="text-sm text-muted-foreground">{t('general.modelGroups.setsEmpty')}</div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {attachedModelSets.map((setItem) => (
                                                <Badge key={setItem.id} variant="secondary" className="h-8 gap-1 px-2 text-xs">
                                                    <span className="max-w-[220px] truncate">{setItem.name}</span>
                                                    <button
                                                        type="button"
                                                        className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                                                        onClick={() => onDetachModelSet(setItem.id)}
                                                        aria-label={t('general.modelGroups.detach')}
                                                        title={t('general.modelGroups.detach')}
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:opacity-60">
                    {editorTab === 'general' && (
                        <div className="space-y-4">
                            <div className="rounded-md border bg-card p-4 space-y-4">
                                <div className="text-sm font-medium">{t('general.settings.title')}</div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <div className="text-xs text-muted-foreground">{t('general.settings.type')}</div>
                                        <Select
                                            value={(() => {
                                                const current = coerceCategory(String(draft.category))
                                                if (current && current !== 'default' && current !== 'component') return current
                                                return 'scene_action'
                                            })()}
                                            onValueChange={(value) => {
                                                const next = coerceCategory(String(value))
                                                if (!next || next === 'default' || next === 'component') return
                                                onUpdateDraftCategory(next)
                                            }}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                                <SelectContent align="start">
                                                    {categories
                                                    .filter((category) => category.id !== 'default' && category.id !== 'component')
                                                    .map((option) => (
                                                        <SelectItem key={option.id} value={option.id}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-xs text-muted-foreground">{t('general.settings.moderation')}</div>
                                        <Select
                                            value={draft.isNsfw ? 'nsfw' : 'sfw'}
                                            onValueChange={(value) => onUpdateDraftNsfw(value === 'nsfw')}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent align="start">
                                                <SelectItem value="sfw">{t('general.settings.sfw')}</SelectItem>
                                                <SelectItem value="nsfw">{t('general.settings.nsfw')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {!isComponent && (
                                    <div className="space-y-3">
                                        <div className="text-xs text-muted-foreground">{t('general.settings.usage')}</div>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40">
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 accent-primary"
                                                    checked={draft.allowLlmCall === true}
                                                    onChange={(event) => onUpdateDraftAllowLlmCall(event.target.checked)}
                                                />
                                                <span className="min-w-0">
                                                    <span className="block font-medium">{t('general.settings.llmCall')}</span>
                                                    <span className="block text-xs text-muted-foreground">{t('general.settings.llmCallHint')}</span>
                                                </span>
                                            </label>

                                            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40">
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 accent-primary"
                                                    checked={draft.allowAgentCall === true}
                                                    onChange={(event) => onUpdateDraftAllowAgentCall(event.target.checked)}
                                                />
                                                <span className="min-w-0">
                                                    <span className="block font-medium">{t('general.settings.agentCall')}</span>
                                                    <span className="block text-xs text-muted-foreground">{t('general.settings.agentCallHint')}</span>
                                                </span>
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {editorTab === 'advanced' && (
                        <InputsEditor
                            inputDefinitions={draft.inputs ?? []}
                            disabled={false}
                            onInputDefinitionsChange={onUpdateDraftInputs}
                            messages={draft.messages}
                            promptId={draft.id}
                            promptCategory={String(draft.category)}
                            allPrompts={allPrompts}
                            novelId={novelId}
                            onNavigateToPromptAdvanced={handleNavigateToPromptAdvanced}
                        />
                    )}

                    {editorTab === 'usages' && (
                        <div className="space-y-4">
                            <div className="text-sm text-muted-foreground">{t('usages.intro')}</div>

                            {includeUsages.items.length === 0 ? (
                                <div className="text-sm text-muted-foreground">{t('usages.empty')}</div>
                            ) : (
                                <div className="space-y-2">
                                    {includeUsages.items.map(({ prompt, calls }) => {
                                        const category = coerceCategory(String(prompt.category))
                                        const label = category ? categoryLabelById[category] ?? String(prompt.category) : String(prompt.category)
                                        const Icon = category ? categoryIconById[category] ?? Sparkles : Sparkles

                                        return (
                                            <button
                                                key={prompt.id}
                                                type="button"
                                                className="w-full rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
                                                onClick={() => onSelectPrompt(prompt.id)}
                                            >
                                                <div className="flex items-center justify-between gap-4">
                                                    <div className="min-w-0 flex items-center gap-2">
                                                        <span className="min-w-0 truncate text-sm font-medium">{prompt.name}</span>
                                                        <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                                                            {t('usages.calls', { count: calls })}
                                                        </Badge>
                                                    </div>

                                                    <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Icon className="h-4 w-4" />
                                                        <span className="max-w-[180px] truncate">{label}</span>
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {editorTab === 'description' && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium">{t('editor.description')}</div>
                            <Textarea
                                value={draft.description ?? ''}
                                onChange={(event) => onUpdateDraftDescription(event.target.value)}
                                className="min-h-[240px] text-sm"
                                placeholder={t('editor.descriptionPlaceholder')}
                            />
                        </div>
                    )}

                    {editorTab === 'instructions' && (
                        <div className="space-y-6">
                            <div className="text-sm text-muted-foreground leading-relaxed">
                                {isComponent ? t('editor.componentIntro') : t('editor.multiMessageIntro')}
                            </div>

                            <div className="rounded-md border bg-muted/20 p-4 space-y-3">
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-between gap-3 text-left"
                                    onClick={() => setTemplateReferenceExpanded((prev) => !prev)}
                                >
                                    <div>
                                        <div className="text-sm font-medium">{t('editor.templateReference.title')}</div>
                                        <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{t('editor.templateReference.intro')}</div>
                                    </div>
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        {templateReferenceExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        {templateReferenceExpanded ? t('editor.templateReference.collapse') : t('editor.templateReference.expand')}
                                    </span>
                                </button>

                                {templateReferenceExpanded && (
                                    <div className="grid gap-2 md:grid-cols-2">
                                        {templateReferenceItems.map((item) => (
                                            <button
                                                key={item.key}
                                                type="button"
                                                className="rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50"
                                                onClick={() => handleInsertTemplateSnippet(item.key)}
                                            >
                                                <div className="font-mono text-xs text-sky-700 dark:text-sky-400 break-all">{item.key}</div>
                                                <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{item.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {includeWarnings.length > 0 && (
                                <div className="rounded-md border bg-yellow-50 px-3 py-3 text-sm text-yellow-900 space-y-2">
                                    <div className="font-medium">{t('advanced.preview.warningsTitle')}</div>
                                    <ul className="list-disc pl-5 text-xs text-yellow-900/80 space-y-1">
                                        {includeWarnings.map((warning) => (
                                            <li key={`${warning.type}:${warning.name}`}>{getPromptWarningMessage(warning, t)}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {!isComponent && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium">{t('editor.systemMessage')}</div>
                                        <Button variant="outline" size="sm" className="gap-1" onClick={() => void onCopySystemMessage()}>
                                            <Copy className="h-4 w-4" />
                                            {t('actions.copy')}
                                        </Button>
                                    </div>

                                    <PromptTemplateEditor
                                        value={systemMessage?.content ?? ''}
                                        onChange={onUpdateSystemMessage}
                                        className={cn(
                                            'h-[480px]',
                                            resolvedActiveEditorId === 'system' && 'ring-2 ring-primary/20 ring-offset-2 ring-offset-background'
                                        )}
                                        placeholder={t('editor.instructionsPlaceholder')}
                                        onEditorFocus={() => setActiveEditorId('system')}
                                        insertRequest={insertRequest?.targetId === 'system' ? { id: insertRequest.id, text: insertRequest.text } : null}
                                    />

                                    {historyEnabled && (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1"
                                                onClick={() => onSetHistoryOpen(true)}
                                            >
                                                <HistoryIcon className="h-4 w-4" />
                                                {t('actions.history')}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {isComponent ? (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium">{t('editor.message')}</div>
                                        <Button variant="outline" size="sm" className="gap-1" onClick={() => void onCopyComponentMessage()}>
                                            <Copy className="h-4 w-4" />
                                            {t('actions.copy')}
                                        </Button>
                                    </div>
                                    <PromptTemplateEditor
                                        value={draft.messages[0]?.content ?? ''}
                                        onChange={onUpdateComponentMessage}
                                        className={cn(
                                            'h-[630px]',
                                            resolvedActiveEditorId === 'component' &&
                                                'ring-2 ring-primary/20 ring-offset-2 ring-offset-background'
                                        )}
                                        placeholder={t('editor.instructionsPlaceholder')}
                                        onEditorFocus={() => setActiveEditorId('component')}
                                        insertRequest={insertRequest?.targetId === 'component' ? { id: insertRequest.id, text: insertRequest.text } : null}
                                    />

                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            size="sm"
                                            className={cn('gap-1 transition-colors', includeCallCopied && 'bg-emerald-600 hover:bg-emerald-600 text-white')}
                                            onClick={() => void onCopyIncludeCall()}
                                        >
                                            {includeCallCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                            {t('actions.copyIncludeCall')}
                                        </Button>

                                        {historyEnabled && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1"
                                                onClick={() => onSetHistoryOpen(true)}
                                            >
                                                <HistoryIcon className="h-4 w-4" />
                                                {t('actions.history')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium">{t('editor.messages')}</div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1"
                                            onClick={onAddMessage}
                                        >
                                            <Plus className="h-4 w-4" />
                                            {t('actions.addMessage')}
                                        </Button>
                                    </div>

                                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                                        <SortableContext items={additionalMessages.map((message) => message.id)} strategy={verticalListSortingStrategy}>
                                            <div className="space-y-3">
                                                {additionalMessages.map((message) => (
                                                    <SortableMessageCard
                                                        key={message.id}
                                                        message={message}
                                                        active={resolvedActiveEditorId === message.id}
                                                        onRoleChange={(role) => onUpdateAdditionalMessage(message.id, { role })}
                                                        onContentChange={(content) => onUpdateAdditionalMessage(message.id, { content })}
                                                        onCopy={() => void onCopyMessage(message.id)}
                                                        onDelete={() => onDeleteAdditionalMessage(message.id)}
                                                        t={t}
                                                        onEditorFocus={() => setActiveEditorId(message.id)}
                                                        insertRequest={insertRequest?.targetId === message.id ? { id: insertRequest.id, text: insertRequest.text } : null}
                                                    />
                                                ))}
                                            </div>
                                        </SortableContext>
                                    </DndContext>
                                </div>
                            )}
                        </div>
                    )}
                    </fieldset>

                    {historyEnabled && (
                        <PromptHistoryDialog
                            open={historyOpen}
                            onOpenChange={onSetHistoryOpen}
                            currentValue={historyCurrentValue}
                            historyItems={draft.history ?? []}
                            onRestore={onRestoreHistory}
                        />
                    )}
                </div>
            )}
        </section>
    )
}
