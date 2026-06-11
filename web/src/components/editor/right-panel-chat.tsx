'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Brain,
    Check,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Copy,
    Eye,
    GitBranch,
    Heart,
    ImagePlus,
    Loader2,
    MessageSquareText,
    Pencil,
    RotateCcw,
    Save,
    SendHorizonal,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react'
import { ModelGroupLogoIcon } from '@/components/ai/model-group-logo-icon'
import { AttachmentStrip } from '@/components/image/attachment-strip'
import { ImageThumbnails } from '@/components/image/image-thumbnails'
import { ImageViewerBoundary, ImageViewerExtraActionsProvider } from '@/components/image/image-viewer-dialog'
import { TermGalleryImportButton } from '@/components/editor/terms/term-gallery-import-button'
import { useImageAttachments, type ImageAttachmentError } from '@/components/image/use-image-attachments'
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PreviewInputCard } from '@/components/editor/prompt-inputs-editor/preview-input-card'
import { PreviewRenderedSection } from '@/components/editor/prompt-inputs-editor/preview-rendered-section'
import { useInputsEditorModel, type PersistedInputsEditorPreviewState } from '@/components/editor/prompt-inputs-editor/model'
import {
    useEditorChatStore,
    EDITOR_CHAT_FALLBACK_NOVEL_ID,
    type EditorChatMessage,
} from '@/components/editor/editor-chat-store'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { buildTermMentionMatcher, findMentionedTermIds } from '@/components/editor/terms/term-mentions-utils'
import type { TermEntry } from '@/components/editor/terms/types'
import type { ModelGroup } from '@/lib/ai-store'
import { promptApi, snippetApi, type Prompt, type PromptDefaultSelection } from '@/lib/api'
import { getAvailableModelAssignments, runModelGroupWithFallback, type ModelTokenUsage } from '@/lib/ai-runner'
import { isVisionCapableModelGroup } from '@/lib/ai-group-config'
import type { PromptMessage } from '@/lib/prompts'
import { analyzeChatPromptMessages } from '@/lib/prompt-template'
import { invalidateAiChatMenuDataCache, loadAiChatMenuData } from '@/lib/ai-chat-menu-data'
import { PROMPTS_CHANGED_EVENT } from '@/lib/prompt-events'
import { resolveTrackedTermIds } from '@/lib/term-template'
import { cn } from '@/lib/utils'
import { renderSimpleMarkdown } from '@/lib/simple-markdown'
import { plainTextToSnippetHtml } from '@/lib/snippet-html'

type RightPanelChatProps = {
    novelId?: string
    tweakOpen: boolean
    onTweakOpenChange: (open: boolean) => void
}

type PromptSelection =
    | { type: 'default' }
    | { type: 'prompt'; promptId: string }

type ChatRunStatus = 'idle' | 'running' | 'completed' | 'error'

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
    )
}

function isKeyboardEventComposing(event: { isComposing?: boolean; nativeEvent?: { isComposing?: boolean } }) {
    return Boolean(event.isComposing || event.nativeEvent?.isComposing)
}

function AssistantMarkdown({ content }: { content: string }) {
    const rendered = useMemo(() => renderSimpleMarkdown(content), [content])

    return (
        <div
            className={cn(
                'prose prose-sm min-w-0 max-w-full overflow-hidden break-words text-inherit [overflow-wrap:anywhere]',
                'prose-p:my-0 prose-headings:my-0 prose-ol:my-3 prose-ul:my-3 prose-li:my-1',
                'prose-pre:my-3 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-muted prose-pre:px-4 prose-pre:py-3',
                'prose-code:rounded prose-code:bg-muted/80 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.9em]',
                'prose-code:before:content-none prose-code:after:content-none',
                'prose-blockquote:my-3 prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4',
                'prose-a:text-primary prose-strong:text-inherit prose-headings:text-inherit',
                '[&_a]:break-all [&_a]:[overflow-wrap:anywhere]',
                '[&_code]:break-words [&_code]:[overflow-wrap:anywhere]',
                '[&_em]:break-words [&_em]:[overflow-wrap:anywhere]',
                '[&_li]:break-words [&_li]:[overflow-wrap:anywhere]',
                '[&_p]:break-words [&_p]:[overflow-wrap:anywhere]',
                '[&_strong]:break-words [&_strong]:[overflow-wrap:anywhere]'
            )}
        >
            <ImageViewerBoundary>{rendered}</ImageViewerBoundary>
        </div>
    )
}

function getPromptGroups(prompt: Prompt | null | undefined, groups: ModelGroup[] | null | undefined) {
    if (!prompt || !Array.isArray(groups)) return []
    const byId = new Map(groups.map((group) => [group.id, group]))
    return (prompt.modelGroupIds ?? [])
        .map((groupId) => byId.get(groupId) ?? null)
        .filter((group): group is ModelGroup => group !== null)
}

function hasRunnableGroup(groups: ModelGroup[]) {
    return groups.some((group) => getAvailableModelAssignments(group).length > 0)
}

function getPromptRunDisabledReason(prompt: Prompt | null | undefined, groups: ModelGroup[] | null | undefined) {
    if (!prompt) return 'missingPrompt' as const
    if (!analyzeChatPromptMessages(prompt.messages ?? []).valid) return 'invalidChatPrompt' as const
    if ((prompt.modelGroupIds ?? []).length === 0) return 'noModelBinding' as const

    const promptGroups = getPromptGroups(prompt, groups)
    if (promptGroups.length === 0) return 'missingModelGroup' as const
    if (!hasRunnableGroup(promptGroups)) return 'noValidModel' as const

    return null
}

function getDisabledReasonText(
    reason: NonNullable<ReturnType<typeof getPromptRunDisabledReason>>,
    tSceneOperation: ReturnType<typeof useTranslations>,
    tEditor: ReturnType<typeof useTranslations>
) {
    if (reason === 'invalidChatPrompt') return tEditor('infoPanel.chatPromptInvalid')
    return tSceneOperation(`disabledReasons.${reason}`)
}

function safeCopyLocalStorageItem(sourceKey: string | null, targetKey: string | null) {
    if (typeof window === 'undefined' || !sourceKey || !targetKey || sourceKey === targetKey) return

    try {
        const value = window.localStorage.getItem(sourceKey)
        if (!value) return
        window.localStorage.setItem(targetKey, value)
    } catch {
        // Ignore unavailable storage.
    }
}

function normalizeBlock(block: string) {
    return block.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

function splitContentBlocks(text: string) {
    return (text ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n+/u)
        .map((block) => block.trim())
        .filter(Boolean)
}

function dedupeRenderedUserContent(params: {
    fullContent: string
    protectedBlock: string
    historyMessages: Array<Pick<EditorChatMessage, 'role' | 'content' | 'sentContent'>>
}) {
    const fullContent = params.fullContent.trim()
    if (!fullContent) return ''

    const seen = new Set<string>()
    for (const message of params.historyMessages) {
        if (message.role !== 'user') continue
        const sentContent = (message.sentContent ?? message.content ?? '').trim()
        if (!sentContent) continue
        for (const block of splitContentBlocks(sentContent)) {
            const normalized = normalizeBlock(block)
            if (normalized) seen.add(normalized)
        }
    }

    if (seen.size === 0) return fullContent

    const protectedBlock = normalizeBlock(params.protectedBlock)
    const nextBlocks = splitContentBlocks(fullContent).filter((block) => {
        const normalized = normalizeBlock(block)
        if (!normalized) return false
        if (protectedBlock && normalized === protectedBlock) return true
        return !seen.has(normalized)
    })

    return nextBlocks.join('\n\n').trim()
}

function buildChatPromptMessages(params: {
    prompt: Prompt | null
    historyMessages: Array<Pick<EditorChatMessage, 'id' | 'role' | 'content' | 'sentContent'>>
}) {
    const promptMessages = params.prompt?.messages ?? []
    if (promptMessages.length === 0) return []

    const prefixMessages = promptMessages.slice(0, -1)
    const lastUserMessage = promptMessages[promptMessages.length - 1] ?? null

    return [
        ...prefixMessages,
        ...params.historyMessages.map(
            (message): PromptMessage => ({
                id: `chat_history_${message.id}`,
                role: message.role,
                content: message.role === 'user' ? message.sentContent ?? message.content : message.content,
            })
        ),
        ...(lastUserMessage ? [lastUserMessage] : []),
    ]
}

function buildStoredChatPromptMessages(params: {
    prompt: Prompt | null
    historyMessages: Array<Pick<EditorChatMessage, 'id' | 'role' | 'content' | 'sentContent' | 'attachments'>>
}) {
    const promptMessages = params.prompt?.messages ?? []
    const prefixMessages = promptMessages.slice(0, Math.max(0, promptMessages.length - 1))
    // Image-only history messages have empty text (the image lives in attachments)
    // and must survive the empty-text filter.
    const attachmentMessageIds = new Set(
        params.historyMessages
            .filter((message) => message.attachments.length > 0)
            .map((message) => `chat_history_${message.id}`)
    )

    return [
        ...prefixMessages,
        ...params.historyMessages.map(
            (message): PromptMessage => ({
                id: `chat_history_${message.id}`,
                role: message.role,
                content: message.role === 'user' ? message.sentContent ?? message.content : message.content,
            })
        ),
    ].filter((message) => message.content.trim() || attachmentMessageIds.has(message.id))
}

function normalizeUsageToken(value: number | undefined) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function toStoredTokenUsage(usage: ModelTokenUsage | undefined) {
    const promptTokens = normalizeUsageToken(usage?.inputTokens)
    const completionTokens = normalizeUsageToken(usage?.outputTokens)
    const totalTokens = normalizeUsageToken(
        usage?.totalTokens ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : undefined)
    )
    return { promptTokens, completionTokens, totalTokens }
}

function serializePersistedInputState(state: PersistedInputsEditorPreviewState | null | undefined) {
    return JSON.stringify(state ?? null)
}

function parsePersistedInputStateJson(json: string) {
    return JSON.parse(json) as PersistedInputsEditorPreviewState | null
}

export function RightPanelChat({ novelId, tweakOpen, onTweakOpenChange }: RightPanelChatProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const tPrompts = useTranslations('prompts')
    const tSceneOperation = useTranslations('editor.sceneOperation')
    const novelKey = novelId?.trim() || EDITOR_CHAT_FALLBACK_NOVEL_ID
    const session = useEditorChatStore((state) => state.sessionsByNovel[novelKey])
    const createConversation = useEditorChatStore((state) => state.createConversation)
    const updateSessionDraft = useEditorChatStore((state) => state.updateSessionDraft)
    const updateConversation = useEditorChatStore((state) => state.updateConversation)
    const updateConversationDraft = useEditorChatStore((state) => state.updateConversationDraft)
    const appendMessage = useEditorChatStore((state) => state.appendMessage)
    const updateMessage = useEditorChatStore((state) => state.updateMessage)
    const deleteMessages = useEditorChatStore((state) => state.deleteMessages)
    const cloneConversation = useEditorChatStore((state) => state.cloneConversation)
    const deleteConversation = useEditorChatStore((state) => state.deleteConversation)
    const loadConversations = useEditorChatStore((state) => state.loadConversations)

    const conversations = session?.conversations ?? []
    const selectedChatId = session?.selectedChatId ?? null
    const selectedConversation = conversations.find((conversation) => conversation.id === selectedChatId) ?? null
    const draft = selectedConversation?.draftContent ?? session?.draftContent ?? ''
    const [promptSelection, setPromptSelection] = useState<PromptSelection>({ type: 'default' })
    const [prompts, setPrompts] = useState<Prompt[] | null>(null)
    const [defaults, setDefaults] = useState<Partial<Record<'ai_chat', PromptDefaultSelection>> | null>(null)
    const [groups, setGroups] = useState<ModelGroup[] | null>(null)
    const [componentPrompts, setComponentPrompts] = useState<Prompt[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [runError, setRunError] = useState<string | null>(null)
    const [generating, setGenerating] = useState(false)
    const [selectedGroupId, setSelectedGroupId] = useState('')
    const [tweakTab, setTweakTab] = useState<'tweak' | 'preview'>('tweak')
    const [resultText, setResultText] = useState('')
    const [reasoningText, setReasoningText] = useState('')
    const [reasoningExpanded, setReasoningExpanded] = useState(false)
    const [runStatus, setRunStatus] = useState<ChatRunStatus>('idle')
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [editingContent, setEditingContent] = useState('')
    const [messageActionBusy, setMessageActionBusy] = useState(false)
    const [lockedUserInput, setLockedUserInput] = useState<string | null>(null)
    const [lockedUserTermIds, setLockedUserTermIds] = useState<string[]>([])
    const [lockedHistoryMessages, setLockedHistoryMessages] = useState<
        Array<Pick<EditorChatMessage, 'id' | 'role' | 'content' | 'sentContent' | 'termIds'>> | null
    >(null)
    const [attachmentHint, setAttachmentHint] = useState<string | null>(null)
    const generateAbortRef = useRef<AbortController | null>(null)
    const attachmentHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const latestInputStateRef = useRef<PersistedInputsEditorPreviewState | null>(null)
    const persistedInputStateJsonRef = useRef<string | null>(null)
    const persistInputStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const termEntries = useStoredTermEntries(novelId)

    useEffect(() => {
        void loadConversations(novelId)
    }, [loadConversations, novelId])

    useEffect(() => {
        setSelectionMode(false)
        setSelectedMessageIds([])
        setEditingMessageId(null)
        setEditingContent('')
    }, [selectedConversation?.id])

    const selectedConversationInputStateJson = useMemo(
        () => serializePersistedInputState(selectedConversation?.inputState as PersistedInputsEditorPreviewState | null | undefined),
        [selectedConversation?.inputState]
    )

    useEffect(() => {
        latestInputStateRef.current = parsePersistedInputStateJson(selectedConversationInputStateJson)
        persistedInputStateJsonRef.current = selectedConversationInputStateJson
        if (persistInputStateTimerRef.current) {
            clearTimeout(persistInputStateTimerRef.current)
            persistInputStateTimerRef.current = null
        }
    }, [selectedConversation?.id, selectedConversationInputStateJson])

    const clearRunState = useCallback(() => {
        setRunError(null)
        setResultText('')
        setReasoningText('')
        setReasoningExpanded(false)
        setRunStatus('idle')
        setLockedUserInput(null)
        setLockedUserTermIds([])
        setLockedHistoryMessages(null)
        setTweakTab('tweak')
    }, [])

    useEffect(() => {
        return () => {
            generateAbortRef.current?.abort()
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        async function load(options?: { force?: boolean }) {
            if (options?.force) invalidateAiChatMenuDataCache()
            setLoadError(null)
            try {
                const [menuData, components] = await Promise.all([
                    loadAiChatMenuData(),
                    promptApi.list({ category: 'component' }).then((result) => result.prompts ?? []),
                ])
                if (cancelled) return

                setPrompts(menuData.prompts)
                setDefaults({ ai_chat: menuData.defaults.ai_chat })
                setGroups(menuData.groups)
                setComponentPrompts(components)
            } catch (error) {
                console.error('Failed to load ai chat prompts:', error)
                if (cancelled) return
                setLoadError(error instanceof Error ? error.message : String(error))
                setPrompts([])
                setDefaults({})
                setGroups([])
                setComponentPrompts([])
            }
        }

        void load({ force: true })

        const handlePromptsChanged = () => {
            void load({ force: true })
        }

        window.addEventListener(PROMPTS_CHANGED_EVENT, handlePromptsChanged)

        return () => {
            cancelled = true
            window.removeEventListener(PROMPTS_CHANGED_EVENT, handlePromptsChanged)
        }
    }, [])

    const defaultSelection = (defaults?.ai_chat ?? null) as PromptDefaultSelection | null
    const defaultPrompt =
        defaultSelection?.promptId && Array.isArray(prompts)
            ? prompts.find((prompt) => prompt.id === defaultSelection.promptId) ?? null
            : null
    const persistedPromptId = selectedConversation?.promptId ?? session?.draftPromptId ?? null

    useEffect(() => {
        if (persistedPromptId) {
            setPromptSelection({ type: 'prompt', promptId: persistedPromptId })
        } else {
            setPromptSelection({ type: 'default' })
        }
    }, [persistedPromptId, selectedConversation?.id])

    const selectedPrompt = useMemo(() => {
        if (!Array.isArray(prompts) || prompts.length === 0) return null
        if (promptSelection.type === 'default') {
            return defaultPrompt ?? prompts[0] ?? null
        }
        return prompts.find((prompt) => prompt.id === promptSelection.promptId) ?? defaultPrompt ?? prompts[0] ?? null
    }, [defaultPrompt, promptSelection, prompts])

    const isUsingDefaultPrompt = promptSelection.type === 'default' && !!defaultPrompt
    const otherPrompts = useMemo(() => {
        if (!Array.isArray(prompts)) return []
        const excludedIds = new Set<string>()
        if (defaultSelection?.promptId) excludedIds.add(defaultSelection.promptId)
        if (promptSelection.type === 'prompt') excludedIds.add(promptSelection.promptId)
        return prompts.filter((prompt) => !excludedIds.has(prompt.id))
    }, [defaultSelection?.promptId, promptSelection, prompts])

    const activePrompt = selectedConversation?.promptSnapshot ?? selectedPrompt
    const promptLocked = Boolean(selectedConversation?.promptSnapshot || selectedConversation?.messages.length)
    const promptGroups = useMemo(() => getPromptGroups(activePrompt, groups), [activePrompt, groups])
    const runnableGroups = useMemo(
        () => promptGroups.filter((group) => getAvailableModelAssignments(group).length > 0),
        [promptGroups]
    )
    const persistedGroupId = selectedConversation?.selectedGroupId ?? session?.draftSelectedGroupId ?? ''
    const selectedGroup = useMemo(
        () =>
            runnableGroups.find((group) => group.id === selectedGroupId) ??
            runnableGroups.find((group) => group.id === persistedGroupId) ??
            runnableGroups[0] ??
            promptGroups.find((group) => group.id === selectedGroupId) ??
            promptGroups.find((group) => group.id === persistedGroupId) ??
            promptGroups[0] ??
            null,
        [persistedGroupId, promptGroups, runnableGroups, selectedGroupId]
    )

    useEffect(() => {
        const nextGroupId = selectedGroup?.id ?? ''
        if (selectedGroupId === nextGroupId) return
        setSelectedGroupId(nextGroupId)
    }, [selectedGroup?.id, selectedGroupId])

    // Effective capability: manual override when set, otherwise auto-detection over the
    // group's model ids — mirrors what the settings UI shows for the group.
    const visionBlocked = Boolean(selectedGroup && !isVisionCapableModelGroup(selectedGroup))

    const showAttachmentHint = useCallback((hint: string) => {
        if (attachmentHintTimerRef.current) clearTimeout(attachmentHintTimerRef.current)
        setAttachmentHint(hint)
        attachmentHintTimerRef.current = setTimeout(() => {
            attachmentHintTimerRef.current = null
            setAttachmentHint(null)
        }, 5000)
    }, [])

    const handleAttachmentError = useCallback(
        (error: ImageAttachmentError) => {
            const key = (
                {
                    type: 'attachmentErrorType',
                    size: 'attachmentErrorSize',
                    count: 'attachmentErrorCount',
                    disabled: 'attachmentErrorVision',
                    upload: 'attachmentErrorUpload',
                } as const
            )[error]
            showAttachmentHint(t(`infoPanel.${key}`))
        },
        [showAttachmentHint, t]
    )

    const imageAttachments = useImageAttachments({ disabled: visionBlocked, onError: handleAttachmentError })

    const conversationHasImages = useMemo(
        () => (selectedConversation?.messages ?? []).some((message) => message.attachments.length > 0),
        [selectedConversation?.messages]
    )

    useEffect(() => {
        clearRunState()
    }, [activePrompt?.id, clearRunState, selectedConversation?.id])

    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry])), [termEntries])
    const termMentionMatcher = useMemo(() => buildTermMentionMatcher(termEntries), [termEntries])
    const detectedTermIds = useMemo(() => findMentionedTermIds(draft, termMentionMatcher), [draft, termMentionMatcher])
    const detectedTermEntries = useMemo(() => {
        const usedEntries = [...detectedTermIds]
            .map((id) => termEntriesById.get(id) ?? null)
            .filter((entry): entry is TermEntry => entry !== null)

        usedEntries.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
        return usedEntries
    }, [detectedTermIds, termEntriesById])
    const previewUserInput = lockedUserInput ?? draft
    const previewUserInputTermIds = useMemo(
        () =>
            resolveTrackedTermIds({
                mentionedTermIds: lockedUserInput !== null ? lockedUserTermIds : [...detectedTermIds],
                termsById: termEntriesById,
            }),
        [detectedTermIds, lockedUserInput, lockedUserTermIds, termEntriesById]
    )
    const previewHistoryMessages = useMemo(() => {
        const sourceMessages = lockedHistoryMessages ?? selectedConversation?.messages ?? []
        return sourceMessages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sentContent: message.sentContent,
            termIds: message.termIds,
        }))
    }, [lockedHistoryMessages, selectedConversation?.messages])
    const previewMessages = useMemo(
        () =>
            buildChatPromptMessages({
                prompt: activePrompt,
                historyMessages: previewHistoryMessages,
            }),
        [activePrompt, previewHistoryMessages]
    )
    const previewChatHistoryText = useMemo(
        () =>
            previewHistoryMessages
                .map((message) => message.content.trim())
                .filter(Boolean)
                .join('\n\n')
                .trim(),
        [previewHistoryMessages]
    )
    const previewChatHistoryTermIds = useMemo(
        () =>
            resolveTrackedTermIds({
                mentionedTermIds: [],
                termsById: termEntriesById,
            }),
        [termEntriesById]
    )

    const previewStateStorageKey = useMemo(
        () => `onw.editor.chat.preview.${novelKey}.${selectedConversation?.id ?? 'draft'}.${activePrompt?.id ?? 'prompt'}`,
        [activePrompt?.id, novelKey, selectedConversation?.id]
    )

    const persistPreviewState = useCallback(
        (state: PersistedInputsEditorPreviewState) => {
            latestInputStateRef.current = state
            const conversationId = selectedConversation?.id
            if (!conversationId) return

            const nextJson = serializePersistedInputState(state)
            if (nextJson === persistedInputStateJsonRef.current) return

            if (persistInputStateTimerRef.current) clearTimeout(persistInputStateTimerRef.current)
            persistInputStateTimerRef.current = setTimeout(() => {
                persistInputStateTimerRef.current = null
                const stateToPersist = latestInputStateRef.current
                const stateJson = serializePersistedInputState(stateToPersist)
                if (stateJson === persistedInputStateJsonRef.current) return

                persistedInputStateJsonRef.current = stateJson
                void updateConversation(novelId, conversationId, { inputState: stateToPersist }).catch((error) => {
                    console.error('Failed to save ai chat input state:', error)
                })
            }, 500)
        },
        [novelId, selectedConversation?.id, updateConversation]
    )

    const model = useInputsEditorModel({
        inputDefinitions: activePrompt?.inputs ?? [],
        disabled: generating,
        onInputDefinitionsChange: () => undefined,
        messages: previewMessages,
        promptId: activePrompt?.id,
        promptCategory: String(activePrompt?.category ?? 'ai_chat'),
        allPrompts: componentPrompts ?? undefined,
        novelId,
        previewStateStorageKey,
        persistedPreviewState: selectedConversation?.inputState as PersistedInputsEditorPreviewState | null | undefined,
        onPreviewStatePersist: persistPreviewState,
        chatUserInput: previewUserInput,
        chatUserInputTerms: previewUserInputTermIds,
        chatHistoryText: previewChatHistoryText,
        chatHistoryTerms: previewChatHistoryTermIds,
    })

    // Image-only messages (a generated image, or an upload sent without text) have
    // empty text — the image lives in attachments. They must survive the empty-text
    // filter or follow-up edits lose their canvas.
    const attachmentMessageIds = useMemo(
        () =>
            new Set(
                (selectedConversation?.messages ?? [])
                    .filter((message) => message.attachments.length > 0)
                    .map((message) => `chat_history_${message.id}`)
            ),
        [selectedConversation?.messages]
    )
    const renderedMessages = useMemo(
        () =>
            model.renderedMessages
                .map((message) => ({ id: message.id, role: message.role, content: message.content }))
                .filter((message) => message.content.trim() || attachmentMessageIds.has(message.id)),
        [attachmentMessageIds, model.renderedMessages]
    )
    const clearContentSelectionPreviewState = model.setContentSelectionPreviewStateByInputId
    const promptDisabledReason = getPromptRunDisabledReason(activePrompt, groups)
    const missingRequired = model.missingRequiredInputNames.length > 0
    const canGenerate =
        !generating &&
        !missingRequired &&
        !promptDisabledReason &&
        Boolean(activePrompt) &&
        Boolean(selectedGroup) &&
        getAvailableModelAssignments(selectedGroup).length > 0 &&
        renderedMessages.length > 0
    const hasRetainedRunState = Boolean(resultText) || Boolean(reasoningText) || Boolean(runError) || lockedUserInput !== null
    const showRunState = generating || hasRetainedRunState
    const showTerminateButton = generating || generateAbortRef.current !== null
    const selectedMessageIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds])
    const selectedMessages = useMemo(() => {
        if (!selectedConversation) return []
        return selectedConversation.messages.filter((message) => selectedMessageIdSet.has(message.id))
    }, [selectedConversation, selectedMessageIdSet])
    const runHint = missingRequired
        ? tPrompts('advanced.preview.missingRequiredBadge', {
              names: model.missingRequiredInputNames.join(', '),
          })
        : promptDisabledReason
          ? getDisabledReasonText(promptDisabledReason, tSceneOperation, t)
          : ''

    useEffect(() => {
        if (!tweakOpen || !showRunState) return
        setTweakTab('preview')
    }, [showRunState, tweakOpen])

    useEffect(() => {
        if (generating || tweakOpen || !hasRetainedRunState) return
        clearRunState()
    }, [clearRunState, generating, hasRetainedRunState, tweakOpen])

    const handleSelectPrompt = useCallback(
        (selection: PromptSelection) => {
            setRunError(null)
            if (promptLocked) return
            setPromptSelection(selection)
            const promptId = selection.type === 'prompt' ? selection.promptId : null
            if (selectedConversation) {
                updateConversation(novelId, selectedConversation.id, { promptId })
                return
            }
            updateSessionDraft(novelId, { draftPromptId: promptId })
        },
        [novelId, promptLocked, selectedConversation, updateConversation, updateSessionDraft]
    )

    const handleSelectGroup = useCallback(
        (groupId: string) => {
            setSelectedGroupId(groupId)
            if (selectedConversation) {
                updateConversation(novelId, selectedConversation.id, { selectedGroupId: groupId })
                return
            }
            updateSessionDraft(novelId, { draftSelectedGroupId: groupId })
        },
        [novelId, selectedConversation, updateConversation, updateSessionDraft]
    )

    const handleCreateConversation = useCallback(async () => {
        const promptId = promptSelection.type === 'prompt' ? activePrompt?.id ?? null : null
        const conversationId = await createConversation(novelId, {
            promptId,
            selectedGroupId: selectedGroup?.id ?? null,
            inputState: latestInputStateRef.current,
        })
        if (activePrompt) {
            safeCopyLocalStorageItem(
                `onw.editor.chat.preview.${novelKey}.draft.${activePrompt.id}`,
                `onw.editor.chat.preview.${novelKey}.${conversationId}.${activePrompt.id}`
            )
        }
        return conversationId
    }, [activePrompt, createConversation, novelId, novelKey, promptSelection.type, selectedGroup?.id])

    const handleEnsureConversation = useCallback(async () => {
        if (selectedConversation) return selectedConversation.id
        return await handleCreateConversation()
    }, [handleCreateConversation, selectedConversation])

    const handleOpenTweak = useCallback(() => {
        if (showRunState) {
            setTweakTab('preview')
        }
        onTweakOpenChange(true)
    }, [onTweakOpenChange, showRunState])

    const handleTweakOpenChange = useCallback(
        (open: boolean) => {
            onTweakOpenChange(open)
            if (!open && !generating) {
                clearRunState()
            }
        },
        [clearRunState, generating, onTweakOpenChange]
    )

    const handleTerminate = useCallback(() => {
        const controller = generateAbortRef.current
        generateAbortRef.current = null
        controller?.abort()
        setGenerating(false)
        clearRunState()
    }, [clearRunState])

    const handleCopyMessages = useCallback(
        async (messageIds: string[]) => {
            const messages = selectedConversation?.messages ?? []
            const idSet = new Set(messageIds)
            const text = messages
                .filter((message) => idSet.has(message.id))
                .map((message) => message.content.trim())
                .filter(Boolean)
                .join('\n\n')
            if (!text) return
            await navigator.clipboard?.writeText(text)
        },
        [selectedConversation?.messages]
    )

    const handleSaveMessagesToSnippet = useCallback(
        async (messageIds: string[]) => {
            const normalizedNovelId = novelId?.trim()
            if (!normalizedNovelId) return
            const messages = selectedConversation?.messages ?? []
            const idSet = new Set(messageIds)
            const text = messages
                .filter((message) => idSet.has(message.id))
                .map((message) => message.content.trim())
                .filter(Boolean)
                .join('\n\n')
            if (!text.trim()) return

            const firstLine = text.trim().split(/\r?\n/u)[0]?.trim() ?? ''
            const title = firstLine ? firstLine.slice(0, 28) : t('infoPanel.chatSnippetTitle')
            setMessageActionBusy(true)
            try {
                await snippetApi.create(normalizedNovelId, {
                    title,
                    content: plainTextToSnippetHtml(text),
                    pinned: false,
                })
            } catch (error) {
                console.error('Failed to save chat message to snippet:', error)
                setRunError(error instanceof Error ? error.message : String(error))
            } finally {
                setMessageActionBusy(false)
            }
        },
        [novelId, selectedConversation?.messages, t]
    )

    const handleDeleteMessageIds = useCallback(
        async (messageIds: string[]) => {
            if (!selectedConversation) return
            const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))]
            if (ids.length === 0) return
            const messageIdSet = new Set(selectedConversation.messages.map((message) => message.id))
            const ownedIds = ids.filter((id) => messageIdSet.has(id))
            if (ownedIds.length === 0) return

            setMessageActionBusy(true)
            try {
                if (ownedIds.length >= selectedConversation.messages.length) {
                    await deleteConversation(novelId, selectedConversation.id)
                } else {
                    await deleteMessages(novelId, selectedConversation.id, ownedIds)
                }
                setSelectedMessageIds((current) => current.filter((id) => !ownedIds.includes(id)))
                if (ownedIds.length >= selectedConversation.messages.length) {
                    setSelectionMode(false)
                    setSelectedMessageIds([])
                }
            } catch (error) {
                console.error('Failed to delete chat messages:', error)
                setRunError(error instanceof Error ? error.message : String(error))
            } finally {
                setMessageActionBusy(false)
            }
        },
        [deleteConversation, deleteMessages, novelId, selectedConversation]
    )

    const handleSaveEdit = useCallback(async () => {
        if (!selectedConversation || !editingMessageId) return
        setMessageActionBusy(true)
        try {
            await updateMessage(novelId, selectedConversation.id, editingMessageId, editingContent)
            setEditingMessageId(null)
            setEditingContent('')
        } catch (error) {
            console.error('Failed to update chat message:', error)
            setRunError(error instanceof Error ? error.message : String(error))
        } finally {
            setMessageActionBusy(false)
        }
    }, [editingContent, editingMessageId, novelId, selectedConversation, updateMessage])

    const handleCreateBranch = useCallback(
        async (messageId: string) => {
            if (!selectedConversation) return
            setMessageActionBusy(true)
            try {
                await cloneConversation(novelId, selectedConversation.id, { throughMessageId: messageId })
            } catch (error) {
                console.error('Failed to branch chat:', error)
                setRunError(error instanceof Error ? error.message : String(error))
            } finally {
                setMessageActionBusy(false)
            }
        },
        [cloneConversation, novelId, selectedConversation]
    )

    const handleRetryMessage = useCallback(
        async (messageId: string) => {
            if (!selectedConversation || !selectedGroup || generating || messageActionBusy) return
            const messages = selectedConversation.messages
            const messageIndex = messages.findIndex((message) => message.id === messageId)
            if (messageIndex < 0) return

            let userIndex = messageIndex
            if (messages[messageIndex]?.role === 'assistant') {
                userIndex = -1
                for (let index = messageIndex - 1; index >= 0; index -= 1) {
                    if (messages[index]?.role !== 'user') continue
                    userIndex = index
                    break
                }
            }
            if (userIndex < 0) return

            const historyMessages = messages.slice(0, userIndex + 1).map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                sentContent: message.sentContent,
                attachments: message.attachments,
            }))
            const historyImagesById = new Map(
                messages
                    .slice(0, userIndex + 1)
                    .filter((message) => message.attachments.length > 0)
                    .map((message) => [`chat_history_${message.id}`, message.attachments])
            )
            const requestMessages = buildStoredChatPromptMessages({
                prompt: selectedConversation.promptSnapshot ?? activePrompt,
                historyMessages,
            }).map((message) => {
                const images = visionBlocked ? undefined : historyImagesById.get(message.id)
                return { role: message.role, content: message.content, ...(images ? { images } : {}) }
            })
            if (requestMessages.length === 0) return

            const deleteIds = messages.slice(userIndex + 1).map((message) => message.id)
            setGenerating(true)
            setMessageActionBusy(true)
            setRunError(null)
            setResultText('')
            setReasoningText('')
            setReasoningExpanded(false)
            setRunStatus('running')
            setLockedUserInput(messages[userIndex]?.content ?? '')
            setLockedUserTermIds(messages[userIndex]?.termIds ?? [])
            setLockedHistoryMessages(messages.slice(0, userIndex))
            setTweakTab('preview')

            generateAbortRef.current?.abort()
            const controller = new AbortController()
            generateAbortRef.current = controller
            let assistantReply = ''

            try {
                if (deleteIds.length > 0) {
                    await deleteMessages(novelId, selectedConversation.id, deleteIds)
                }

                const result = await runModelGroupWithFallback({
                    group: selectedGroup,
                    input: {
                        stream: true,
                        temperature: selectedGroup.settings.temperature ?? undefined,
                        maxTokens: selectedGroup.settings.maxTokens ?? undefined,
                        messages: requestMessages,
                    },
                    signal: controller.signal,
                    onTextDelta: (delta) => {
                        assistantReply += delta
                        setResultText((current) => `${current}${delta}`)
                    },
                    onReasoningDelta: (delta) => {
                        setReasoningText((current) => `${current}${delta}`)
                    },
                })

                if (controller.signal.aborted || generateAbortRef.current !== controller) return

                assistantReply = (result.text || assistantReply).trim()
                setResultText(assistantReply)
                setReasoningText(result.reasoningText ?? '')
                setRunStatus('completed')

                if (!assistantReply) {
                    setRunError(t('infoPanel.chatModelNoResponse'))
                    return
                }

                await appendMessage(novelId, selectedConversation.id, {
                    role: 'assistant',
                    content: assistantReply,
                    ...toStoredTokenUsage(result.usage),
                })
            } catch (error) {
                if (!isAbortError(error)) {
                    console.error('Failed to retry ai chat prompt:', error)
                    setRunError(error instanceof Error ? error.message : String(error))
                    setRunStatus('error')
                }
            } finally {
                if (generateAbortRef.current === controller) {
                    generateAbortRef.current = null
                }
                setGenerating(false)
                setMessageActionBusy(false)
            }
        },
        [
            activePrompt,
            appendMessage,
            deleteMessages,
            generating,
            messageActionBusy,
            novelId,
            selectedConversation,
            selectedGroup,
            t,
            visionBlocked,
        ]
    )

    const handleSend = useCallback(async () => {
        const content = draft.trim()
        if (!content || !canGenerate || !selectedGroup || imageAttachments.uploading) return
        const attachments = imageAttachments.readyUrls

        const conversationId = await handleEnsureConversation()
        const historyMessages = selectedConversation?.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sentContent: message.sentContent,
            termIds: message.termIds,
        })) ?? []
        // History messages keep their images across turns (chat APIs are stateless).
        // Assistant attachments are generated images — they must be resent too, or
        // a follow-up edit ("change the hair color") has no canvas to start from.
        // Skipped when the current model can't take vision input — then text only.
        const historyImagesById = new Map(
            (selectedConversation?.messages ?? [])
                .filter((message) => message.attachments.length > 0)
                .map((message) => [message.id, message.attachments])
        )
        const requestMessages = renderedMessages.map((message) => {
            const historyId = message.id.startsWith('chat_history_') ? message.id.slice('chat_history_'.length) : null
            const images = historyId && !visionBlocked ? historyImagesById.get(historyId) : undefined
            return { role: message.role, content: message.content, ...(images ? { images } : {}) }
        })
        let fullRenderedUserContent = ''
        let sentUserContent = ''
        for (let index = requestMessages.length - 1; index >= 0; index -= 1) {
            if (requestMessages[index]?.role !== 'user') continue
            fullRenderedUserContent = requestMessages[index].content
            sentUserContent = dedupeRenderedUserContent({
                fullContent: fullRenderedUserContent,
                protectedBlock: model.renderedChatUserInputBlock,
                historyMessages,
            })
            requestMessages[index] = {
                ...requestMessages[index],
                content: sentUserContent || content,
                ...(attachments.length > 0 && !visionBlocked ? { images: attachments } : {}),
            }
            break
        }

        if (activePrompt && !selectedConversation?.promptSnapshot) {
            await updateConversation(novelId, conversationId, {
                promptId: activePrompt.id,
                promptSnapshot: activePrompt,
                inputState: latestInputStateRef.current,
            })
        }

        updateConversationDraft(novelId, conversationId, '')
        imageAttachments.clear()
        await appendMessage(novelId, conversationId, {
            role: 'user',
            content,
            sentContent: sentUserContent || content,
            fullRenderedContent: fullRenderedUserContent || sentUserContent || content,
            termIds: [...detectedTermIds],
            attachments,
        })
        const clearedInputState: PersistedInputsEditorPreviewState = {
            ...(latestInputStateRef.current ?? {}),
            contentSelectionPreviewStateByInputId: {},
        }
        latestInputStateRef.current = clearedInputState
        clearContentSelectionPreviewState({})
        void updateConversation(novelId, conversationId, { inputState: clearedInputState }).catch((error) => {
            console.error('Failed to clear ai chat input selections:', error)
        })
        setGenerating(true)
        setRunError(null)
        setResultText('')
        setReasoningText('')
        setReasoningExpanded(false)
        setRunStatus('running')
        setLockedUserInput(content)
        setLockedUserTermIds([...detectedTermIds])
        setLockedHistoryMessages(historyMessages)
        setTweakTab('preview')

        generateAbortRef.current?.abort()
        const controller = new AbortController()
        generateAbortRef.current = controller

        let assistantReply = ''

        try {
            const result = await runModelGroupWithFallback({
                group: selectedGroup,
                input: {
                    stream: true,
                    temperature: selectedGroup.settings.temperature ?? undefined,
                    maxTokens: selectedGroup.settings.maxTokens ?? undefined,
                    messages: requestMessages,
                },
                signal: controller.signal,
                onTextDelta: (delta) => {
                    assistantReply += delta
                    setResultText((current) => `${current}${delta}`)
                },
                onReasoningDelta: (delta) => {
                    setReasoningText((current) => `${current}${delta}`)
                },
            })

            if (controller.signal.aborted || generateAbortRef.current !== controller) return

            assistantReply = (result.text || assistantReply).trim()
            setResultText(assistantReply)
            setReasoningText(result.reasoningText ?? '')
            setRunStatus('completed')

            if (!assistantReply) {
                setRunError(t('infoPanel.chatModelNoResponse'))
                return
            }

            await appendMessage(novelId, conversationId, {
                role: 'assistant',
                content: assistantReply,
                ...toStoredTokenUsage(result.usage),
            })
        } catch (error) {
            if (!isAbortError(error)) {
                console.error('Failed to run ai chat prompt:', error)
                setRunError(error instanceof Error ? error.message : String(error))
                setRunStatus('error')
            }
        } finally {
            if (generateAbortRef.current === controller) {
                generateAbortRef.current = null
            }
            setGenerating(false)
        }
    }, [
        appendMessage,
        canGenerate,
        clearContentSelectionPreviewState,
        detectedTermIds,
        draft,
        handleEnsureConversation,
        imageAttachments,
        visionBlocked,
        activePrompt,
        novelId,
        model.renderedChatUserInputBlock,
        renderedMessages,
        selectedConversation?.messages,
        selectedConversation?.promptSnapshot,
        selectedGroup,
        t,
        updateConversation,
        updateConversationDraft,
    ])

    return (
        <ImageViewerExtraActionsProvider render={(src) => <TermGalleryImportButton novelId={novelId} src={src} />}>
        <div className="relative flex h-full min-h-0 flex-col bg-background">
            <Dialog open={tweakOpen} onOpenChange={handleTweakOpenChange}>
                <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4">
                            <DialogTitle className="text-xl">{t('infoPanel.chatTweak')}</DialogTitle>
                            {(loadError || runError) && (
                                <div className="truncate text-sm text-destructive">{loadError || runError}</div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 border-b">
                            <button
                                type="button"
                                className={cn(
                                    'inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                                    tweakTab === 'tweak'
                                        ? 'border-foreground text-foreground'
                                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                                )}
                                onClick={() => setTweakTab('tweak')}
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                {tPrompts('advanced.inputs.title')}
                            </button>
                            <button
                                type="button"
                                className={cn(
                                    'inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                                    tweakTab === 'preview'
                                        ? 'border-foreground text-foreground'
                                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                                )}
                                onClick={() => setTweakTab('preview')}
                            >
                                <Eye className="h-4 w-4" />
                                {tPrompts('advanced.preview.title')}
                            </button>
                        </div>

                        {tweakTab === 'tweak' ? (
                            <div className="rounded-md border bg-card p-4 space-y-4">
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">{t('infoPanel.chatPromptLabel')}</div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                type="button"
                                                disabled={generating || promptLocked}
                                                className={cn(
                                                    'flex w-full items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-left',
                                                    'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                                                    (generating || promptLocked) && 'cursor-not-allowed opacity-60'
                                                )}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-medium">
                                                        {activePrompt?.name?.trim() || t('infoPanel.chatPromptEmpty')}
                                                    </div>
                                                    <div className="truncate text-xs text-muted-foreground">
                                                        {promptGroups.length} {tSceneOperation('modelGroups')}
                                                    </div>
                                                </div>
                                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="min-w-[18rem]">
                                            <DropdownMenuItem
                                                disabled={promptLocked || !defaultPrompt || !!getPromptRunDisabledReason(defaultPrompt, groups)}
                                                className={cn('items-start py-2', isUsingDefaultPrompt && 'bg-muted')}
                                                onSelect={() => handleSelectPrompt({ type: 'default' })}
                                            >
                                                <div className="flex flex-col gap-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <Heart className="h-4 w-4 text-muted-foreground" />
                                                        <span>{t('scene.useDefaultPrompt')}</span>
                                                    </div>
                                                    <div className="pl-6 text-xs text-muted-foreground">
                                                        {defaultPrompt?.name?.trim() || tPrompts('defaults.none')}
                                                    </div>
                                                </div>
                                            </DropdownMenuItem>

                                            <DropdownMenuSeparator />

                                            {prompts === null ? (
                                                <DropdownMenuItem disabled>{tPrompts('status.loading')}</DropdownMenuItem>
                                            ) : prompts.length === 0 ? (
                                                <DropdownMenuItem disabled>{t('infoPanel.chatPromptEmpty')}</DropdownMenuItem>
                                            ) : (
                                                <>
                                                    {promptSelection.type === 'prompt' && selectedPrompt && (
                                                        <DropdownMenuItem
                                                            disabled={promptLocked || !!getPromptRunDisabledReason(selectedPrompt, groups)}
                                                            className="bg-muted"
                                                            onSelect={() => handleSelectPrompt({ type: 'prompt', promptId: selectedPrompt.id })}
                                                        >
                                                            {selectedPrompt.name}
                                                        </DropdownMenuItem>
                                                    )}

                                                    {promptSelection.type === 'prompt' && selectedPrompt && otherPrompts.length > 0 && <DropdownMenuSeparator />}

                                                    {otherPrompts.map((prompt) => {
                                                        const disabledReason = getPromptRunDisabledReason(prompt, groups)
                                                        return (
                                                            <DropdownMenuItem
                                                                key={prompt.id}
                                                                disabled={promptLocked || !!disabledReason}
                                                                className={cn('items-start', disabledReason && 'text-muted-foreground')}
                                                                onSelect={() => handleSelectPrompt({ type: 'prompt', promptId: prompt.id })}
                                                            >
                                                                <span className="flex min-w-0 flex-col gap-0.5">
                                                                    <span className="truncate">{prompt.name}</span>
                                                                    {disabledReason && (
                                                                        <span className="text-xs text-muted-foreground">
                                                                            {getDisabledReasonText(disabledReason, tSceneOperation, t)}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </DropdownMenuItem>
                                                        )
                                                    })}
                                                </>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    {promptLocked && (
                                        <div className="text-xs text-muted-foreground">
                                            {t('infoPanel.chatPromptLocked')}
                                        </div>
                                    )}
                                </div>

                                {model.previewInputs.length === 0 ? (
                                    <div className="rounded-md border bg-muted/20 px-3 py-6 text-sm text-muted-foreground text-center">
                                        {tPrompts('advanced.inputs.empty')}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {model.previewInputs.map((input) => (
                                            <PreviewInputCard key={input.id} input={input} model={model} />
                                        ))}
                                    </div>
                                )}

                                <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-2">
                                    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                                        <Sparkles className="h-4 w-4" />
                                        {tSceneOperation('runModelGroups')}
                                    </div>
                                    {promptGroups.length === 0 ? (
                                        <div className="text-sm text-muted-foreground">{runHint || tSceneOperation('disabledReasons.noModelBinding')}</div>
                                    ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                            {promptGroups.map((group) => {
                                                const isSelected = selectedGroup?.id === group.id
                                                const availableAssignments = getAvailableModelAssignments(group)
                                                const disabled = generating || availableAssignments.length === 0
                                                return (
                                                    <Button
                                                        key={group.id}
                                                        type="button"
                                                        size="sm"
                                                        variant={isSelected ? 'default' : 'outline'}
                                                        disabled={disabled}
                                                        className="h-9 gap-2 px-3"
                                                        onClick={() => handleSelectGroup(group.id)}
                                                    >
                                                        {isSelected && <Check className="h-4 w-4" />}
                                                        <ModelGroupLogoIcon
                                                            group={group}
                                                            fallbackLabel={group.name}
                                                            className="h-5 w-5 rounded-md"
                                                            imageClassName="h-5 w-5"
                                                        />
                                                        <span className="max-w-[14rem] truncate">{group.name}</span>
                                                        {availableAssignments.length === 0 && (
                                                            <span className="text-[11px] opacity-80">{tSceneOperation('noAssignments')}</span>
                                                        )}
                                                    </Button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>

                                {runHint && <div className="text-xs text-muted-foreground">{runHint}</div>}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <PreviewRenderedSection model={model} showInputs={false} />

                                {showRunState && (
                                    <div className="rounded-md border bg-card p-4">
                                        <div className="space-y-2">
                                            <div className="text-sm font-medium">{tSceneOperation('modelOutput')}</div>
                                            {resultText.trim() ? (
                                                <div className="max-h-[360px] overflow-y-auto rounded-md border bg-background/80 px-3 py-3 text-sm whitespace-pre-wrap">
                                                    {resultText}
                                                </div>
                                            ) : (
                                                <div className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
                                                    {generating
                                                        ? tSceneOperation('resultWaiting')
                                                        : tSceneOperation('resultEmpty')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {showRunState && (
                                    <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-2">
                                        <div className="flex items-center justify-between gap-3 text-sm">
                                            <span className="font-medium">{tSceneOperation('modelResponse')}</span>
                                            {generating && (
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    {tSceneOperation('running')}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between gap-3 text-xs">
                                            <span className="font-medium truncate">{activePrompt?.name?.trim() || t('infoPanel.chatPromptEmpty')}</span>
                                            <span className="text-muted-foreground">
                                                {runStatus === 'completed'
                                                    ? tSceneOperation('runStepCompleted')
                                                    : runStatus === 'error'
                                                      ? tSceneOperation('runStepFailed')
                                                      : runStatus === 'running'
                                                        ? tSceneOperation('runStepRunning')
                                                        : tSceneOperation('runStarting')}
                                            </span>
                                        </div>

                                        {reasoningText.trim() && (
                                            <div className="space-y-1">
                                                <button
                                                    type="button"
                                                    className="w-full flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs text-left"
                                                    onClick={() => setReasoningExpanded((current) => !current)}
                                                >
                                                    <span className="inline-flex items-center gap-2 min-w-0">
                                                        <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                        <span className="font-medium truncate">
                                                            {tSceneOperation('reasoningSummary')}
                                                        </span>
                                                    </span>
                                                    {reasoningExpanded ? (
                                                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    )}
                                                </button>
                                                {reasoningExpanded && (
                                                    <div className="rounded-md border bg-background/80 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                                                        {reasoningText}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {resultText.trim() ? (
                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                                                {resultText}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">{tSceneOperation('runStarting')}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                            {showTerminateButton && (
                                <Button type="button" variant="outline" onClick={handleTerminate}>
                                    {tSceneOperation('terminate')}
                                </Button>
                            )}
                            <Button type="button" variant="outline" onClick={() => handleTweakOpenChange(false)}>
                                {t('infoPanel.chatTweakDone')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={editingMessageId !== null} onOpenChange={(open) => {
                if (open) return
                setEditingMessageId(null)
                setEditingContent('')
            }}>
                <DialogContent className="sm:max-w-xl">
                    <div className="space-y-4">
                        <DialogTitle>{tCommon('edit')}</DialogTitle>
                        <AutoResizeTextarea
                            autoResize={false}
                            value={editingContent}
                            onChange={(event) => setEditingContent(event.target.value)}
                            className="min-h-40 max-h-72 overflow-y-auto text-sm"
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setEditingMessageId(null)
                                    setEditingContent('')
                                }}
                            >
                                {tCommon('cancel')}
                            </Button>
                            <Button type="button" onClick={() => void handleSaveEdit()} disabled={messageActionBusy}>
                                {messageActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {tCommon('save')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-3 px-3 py-3">
                    {selectedConversation?.messages.length ? (
                        selectedConversation.messages.map((message) => {
                            const isUser = message.role === 'user'
                            const selected = selectedMessageIdSet.has(message.id)
                            const promptTokens =
                                typeof message.promptTokens === 'number' ? message.promptTokens : null
                            const completionTokens =
                                typeof message.completionTokens === 'number' ? message.completionTokens : null
                            const storedTotalTokens =
                                typeof message.totalTokens === 'number' ? message.totalTokens : null
                            const tokenTotal =
                                storedTotalTokens ??
                                (promptTokens !== null && completionTokens !== null
                                    ? promptTokens + completionTokens
                                    : null)
                            const showTokenUsage =
                                !isUser &&
                                (tokenTotal !== null || promptTokens !== null || completionTokens !== null)
                            return (
                                <div
                                    key={message.id}
                                    className={cn(
                                        'group flex items-start gap-2 rounded-2xl p-2 transition-colors',
                                        selectionMode && 'cursor-pointer hover:bg-muted/30',
                                        selected && 'bg-emerald-500/10 ring-1 ring-emerald-500/30'
                                    )}
                                    onClick={() => {
                                        if (!selectionMode) return
                                        setSelectedMessageIds((current) =>
                                            current.includes(message.id)
                                                ? current.filter((id) => id !== message.id)
                                            : [...current, message.id]
                                        )
                                    }}
                                >
                                    {selectionMode && (
                                        <button
                                            type="button"
                                            className={cn(
                                                'mt-1 h-5 w-5 shrink-0 rounded-md border transition-colors',
                                                selected
                                                    ? 'border-emerald-500 bg-emerald-500 shadow-sm shadow-emerald-500/25'
                                                    : 'border-muted-foreground/40 bg-background hover:border-emerald-500/70'
                                            )}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                setSelectedMessageIds((current) =>
                                                    current.includes(message.id)
                                                        ? current.filter((id) => id !== message.id)
                                                        : [...current, message.id]
                                                )
                                            }}
                                            title={t('infoPanel.chatSelectMessage')}
                                            aria-pressed={selected}
                                        />
                                    )}
                                    <div className={cn('flex min-w-0 flex-1 gap-2', isUser ? 'justify-end' : 'justify-start')}>
                                        {!isUser && (
                                            <Avatar className="mt-1 h-6 w-6">
                                                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                                                    AI
                                                </AvatarFallback>
                                            </Avatar>
                                        )}

                                        <div className={cn('flex max-w-[85%] flex-col gap-1.5', isUser && 'items-end')}>
                                            <div
                                                className={cn(
                                                    'rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm',
                                                    isUser ? 'bg-foreground text-background' : 'border bg-card text-foreground',
                                                    selected && !isUser && 'border-emerald-500/40',
                                                    selected && isUser && 'ring-2 ring-emerald-500/40'
                                                )}
                                            >
                                                <ImageThumbnails
                                                    urls={message.attachments}
                                                    className={cn(message.content.trim() && 'mb-1.5')}
                                                />
                                                {isUser ? (
                                                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                                                ) : (
                                                    <AssistantMarkdown content={message.content} />
                                                )}
                                            </div>

                                            {showTokenUsage && (
                                                <div className="self-end px-1 text-[11px] text-muted-foreground">
                                                    Tokens: {tokenTotal ?? '-'}
                                                    {promptTokens !== null ? ` ↑${promptTokens}` : ''}
                                                    {completionTokens !== null ? ` ↓${completionTokens}` : ''}
                                                </div>
                                            )}

                                            <div
                                                className={cn(
                                                    'flex items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                                                    selectionMode && 'opacity-100'
                                                )}
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-muted-foreground"
                                                    title={t('infoPanel.chatCopyMessage')}
                                                    onClick={() => void handleCopyMessages([message.id])}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-muted-foreground"
                                                    title={t('infoPanel.chatRetryMessage')}
                                                    disabled={generating || messageActionBusy || !selectedGroup}
                                                    onClick={() => void handleRetryMessage(message.id)}
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </Button>
                                                {!isUser && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 w-7 p-0 text-muted-foreground"
                                                        title={t('infoPanel.chatBranchMessage')}
                                                        disabled={messageActionBusy}
                                                        onClick={() => void handleCreateBranch(message.id)}
                                                    >
                                                        <GitBranch className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-muted-foreground"
                                                    title={tCommon('edit')}
                                                    disabled={messageActionBusy}
                                                    onClick={() => {
                                                        setEditingMessageId(message.id)
                                                        setEditingContent(message.content)
                                                    }}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                {!isUser && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 w-7 p-0 text-muted-foreground"
                                                        title={t('infoPanel.chatSaveToSnippet')}
                                                        disabled={messageActionBusy || !novelId?.trim()}
                                                        onClick={() => void handleSaveMessagesToSnippet([message.id])}
                                                    >
                                                        <Save className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                    title={tCommon('delete')}
                                                    disabled={messageActionBusy}
                                                    onClick={() => void handleDeleteMessageIds([message.id])}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 w-7 p-0 text-muted-foreground"
                                                    title={t('infoPanel.chatMultiSelect')}
                                                    onClick={() => {
                                                        setSelectionMode(true)
                                                        setSelectedMessageIds((current) =>
                                                            current.includes(message.id) ? current : [...current, message.id]
                                                        )
                                                    }}
                                                >
                                                    <CheckSquare className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        {isUser && (
                                            <Avatar className="mt-1 h-6 w-6">
                                                <AvatarFallback className="bg-muted text-[10px] font-semibold text-foreground">
                                                    U
                                                </AvatarFallback>
                                            </Avatar>
                                        )}
                                    </div>
                                </div>
                            )
                        })
                    ) : (
                        <div className="flex min-h-[7rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/10 px-4 py-5 text-center">
                            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <MessageSquareText className="h-5 w-5" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-sm font-medium">{t('infoPanel.chatStartTitle')}</div>
                                <div className="text-xs leading-5 text-muted-foreground">
                                    {t('infoPanel.chatStartDescription')}
                                </div>
                            </div>
                            {!selectedConversation && (
                                <Button type="button" variant="outline" onClick={() => void handleCreateConversation()}>
                                    {t('infoPanel.chatCreate')}
                                </Button>
                            )}
                        </div>
                    )}

                    {generating && (
                        <div className="flex gap-2 justify-start">
                            <Avatar className="mt-1 h-6 w-6">
                                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                                    AI
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>{t('infoPanel.chatGenerating')}</span>
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>

            {selectionMode && selectedMessages.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-32 z-10 flex justify-center px-4">
                    <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border bg-background px-3 py-2 text-sm shadow-lg">
                        <span className="text-muted-foreground">
                            {t('infoPanel.chatSelectedMessages', { count: selectedMessages.length })}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title={t('infoPanel.chatSaveToSnippet')}
                            disabled={messageActionBusy || !novelId?.trim()}
                            onClick={() => void handleSaveMessagesToSnippet(selectedMessages.map((message) => message.id))}
                        >
                            <Save className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title={t('infoPanel.chatCopyMessage')}
                            onClick={() => void handleCopyMessages(selectedMessages.map((message) => message.id))}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            title={tCommon('delete')}
                            disabled={messageActionBusy}
                            onClick={() => void handleDeleteMessageIds(selectedMessages.map((message) => message.id))}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title={tCommon('cancel')}
                            onClick={() => {
                                setSelectionMode(false)
                                setSelectedMessageIds([])
                            }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <div className="border-t bg-background px-3 py-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1 px-1">
                        {detectedTermEntries.map((entry) => {
                            const colorId = getTermEntryColorId(entry.color)
                            const colorClasses = getTermEntryColorClasses(colorId)
                            const hasCustomColor = colorId !== 'black'

                            return (
                                <Badge
                                    key={entry.id}
                                    variant="outline"
                                    className={cn(
                                        'gap-1 font-medium',
                                        colorClasses.subtleBg,
                                        colorClasses.subtleBorder,
                                        entry.archived && 'opacity-60'
                                    )}
                                >
                                    <span className={cn('leading-none', hasCustomColor && colorClasses.text)}>
                                        {entry.title}
                                    </span>
                                </Badge>
                            )
                        })}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2 rounded-xl px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                        onClick={handleOpenTweak}
                    >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
                        {t('infoPanel.chatTweak')}
                    </Button>
                </div>
                <div
                    className="rounded-2xl border bg-card p-2 shadow-sm"
                    onDrop={imageAttachments.handleDrop}
                    onDragOver={imageAttachments.handleDragOver}
                >
                    {(loadError || runError || runHint || attachmentHint) && (
                        <div className={cn('mb-2 text-[11px]', loadError || runError ? 'text-destructive' : 'text-muted-foreground')}>
                            {loadError || runError || runHint || attachmentHint}
                        </div>
                    )}
                    {visionBlocked && (conversationHasImages || imageAttachments.items.length > 0) && (
                        <div className="mb-2 text-[11px] text-muted-foreground">
                            {t('infoPanel.attachmentVisionStripped')}
                        </div>
                    )}
                    <AttachmentStrip items={imageAttachments.items} onRemove={imageAttachments.removeItem} className="mb-2 px-1" />
                    <AutoResizeTextarea
                        autoResize={false}
                        value={draft}
                        onChange={(event) => {
                            const nextDraft = event.target.value
                            if (selectedConversation) {
                                updateConversationDraft(novelId, selectedConversation.id, nextDraft)
                                return
                            }
                            updateSessionDraft(novelId, { draftContent: nextDraft })
                        }}
                        maxLength={4000}
                        placeholder={t('infoPanel.chatComposerPlaceholder')}
                        className="h-28 max-h-28 overflow-y-auto border-0 bg-transparent px-1 py-1 text-sm shadow-none focus-visible:ring-0"
                        onPaste={imageAttachments.handlePaste}
                        onKeyDown={(event) => {
                            if (isKeyboardEventComposing(event)) return
                            if (event.key !== 'Enter' || event.shiftKey) return
                            event.preventDefault()
                            void handleSend()
                        }}
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                imageAttachments.addFiles(Array.from(event.target.files ?? []))
                                event.target.value = ''
                            }}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 rounded-xl p-0 text-muted-foreground"
                            title={visionBlocked ? t('infoPanel.attachmentErrorVision') : t('infoPanel.attachmentAdd')}
                            disabled={visionBlocked}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <ImagePlus className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="gap-1.5 rounded-xl px-3"
                            onClick={() => void handleSend()}
                            disabled={!draft.trim() || !canGenerate || imageAttachments.uploading}
                        >
                            {generating || imageAttachments.uploading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <SendHorizonal className="h-3.5 w-3.5" />
                            )}
                            {t('infoPanel.chatSend')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
        </ImageViewerExtraActionsProvider>
    )
}
