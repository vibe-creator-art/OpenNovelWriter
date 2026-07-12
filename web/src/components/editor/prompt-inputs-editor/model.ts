'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
    ContentSelectionTarget,
    PromptCheckboxInputDefinition,
    PromptContentSelectionInputDefinition,
    PromptCustomInputDefinition,
    PromptDropdownOption,
    PromptInputDefinition,
} from '@/lib/prompt-inputs'
import {
    createPromptCheckboxInput,
    createPromptContentSelectionInput,
    createPromptDropdownOption,
    createPromptInput,
} from '@/lib/prompt-inputs'
import type { PromptMessage } from '@/lib/prompts'
import {
    actApi,
    labelApi,
    novelApi,
    outlineApi,
    snippetApi,
    type Act,
    type ChapterWithScenes,
    type NovelLabel,
    type OutlineSummary,
    type Prompt,
    type Snippet,
} from '@/lib/api'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { useTermEntriesStore } from '@/components/editor/terms/term-entries-store'
import {
    buildPreviewSceneOptions,
    buildMultiSelectionLabel,
    buildSingleSelectionLabel,
    getChapterDisplayLabel,
    getChapterTitleSeparator,
    htmlToText,
    isCheckboxInput,
    isContentSelectionInput,
    isCustomInput,
    sortOptionsAlpha,
} from '@/components/editor/prompt-inputs-editor/utils'
import { renderTermTemplateText, renderTermTemplateValue } from '@/lib/term-template'
import type {
    AllowedSettingsOpenState,
    ContentSelectionPreviewState,
    CustomPreviewState,
    InputId,
    OptionId,
    TermPickerCategoryFilter,
} from '@/components/editor/prompt-inputs-editor/types'
import { type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { countChatUserInputReferencesInText, extractStringArgCallsFromMessages } from '@/lib/prompt-template'
import { buildNovelOutlineTexts } from '@/lib/novel-outline'
import { NOVEL_OUTLINE_DATA_CHANGED_EVENT, type NovelOutlineDataChangedDetail } from '@/lib/novel-outline-events'
import { renderPromptTemplateMessages, renderPromptTemplateText, type PromptTemplateRenderWarning } from '@/lib/prompt-template-render'
import { getContentSelectionTemplateItems } from '@/lib/content-selection-template'
import { findPreviousSceneContent } from '@/lib/scene-continuation'

const EMPTY_OPTIONS: PromptDropdownOption[] = []
const EMPTY_MESSAGES: PromptMessage[] = []
const EMPTY_CHAPTERS: ChapterWithScenes[] = []

type IncludedComponentPrompt = {
    name: string
    prompt: Prompt
}

type ImportedPromptInput = {
    input: PromptInputDefinition
    sourcePrompt: {
        id: string
        name: string
    }
}

export type PersistedInputsEditorPreviewState = {
    customPreviewStateByInputId?: Record<string, CustomPreviewState>
    contentSelectionPreviewStateByInputId?: Record<string, ContentSelectionPreviewState>
    checkboxPreviewCheckedByInputId?: Record<string, boolean>
    previewSceneIdOverride?: string | null
}

type InputsEditorPreviewState = {
    customPreviewStateByInputId: Record<string, CustomPreviewState>
    contentSelectionPreviewStateByInputId: Record<string, ContentSelectionPreviewState>
    checkboxPreviewCheckedByInputId: Record<string, boolean>
    previewSceneIdOverride: string | null
}

const VOLATILE_PREVIEW_STATE_STORAGE_KEY = '__volatile__'
const PROMPT_INPUT_NAVIGATION_KEY = 'editor_prompt_input_navigation'

function normalizeKey(value: string) {
    return value.trim().toLowerCase()
}

function makeUniqueInputName(params: {
    baseName: string
    inputs: PromptInputDefinition[]
    excludeId?: string | null
}) {
    const baseName = params.baseName.trim()
    if (!baseName) return ''

    const used = new Set(
        params.inputs
            .filter((input) => input.id !== params.excludeId)
            .map((input) => normalizeKey(input.name))
            .filter(Boolean)
    )

    if (!used.has(normalizeKey(baseName))) return baseName

    let index = 2
    while (used.has(normalizeKey(`${baseName} ${index}`))) {
        index += 1
    }
    return `${baseName} ${index}`
}

type SceneContinuationHtmlSplit = { beforeHtml: string; afterHtml: string }

function splitSceneHtmlBySceneContinuationPanelId(
    sceneHtml: string,
    panelId: string
): SceneContinuationHtmlSplit | null {
    const html = sceneHtml ?? ''
    const id = (panelId ?? '').trim()
    if (!html || !id) return null

    if (typeof window !== 'undefined') {
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html')
            const candidates = Array.from(doc.querySelectorAll('onw-scene-continuation[data-panel-id]'))
            const element =
                candidates.find((el) => String(el.getAttribute('data-panel-id') ?? '') === id) ?? null
            if (!element) return null

            const body = doc.body

            const beforeRange = doc.createRange()
            beforeRange.setStart(body, 0)
            beforeRange.setEndBefore(element)
            const beforeContainer = doc.createElement('div')
            beforeContainer.append(beforeRange.cloneContents())

            const afterRange = doc.createRange()
            afterRange.setStartAfter(element)
            afterRange.setEnd(body, body.childNodes.length)
            const afterContainer = doc.createElement('div')
            afterContainer.append(afterRange.cloneContents())

            return { beforeHtml: beforeContainer.innerHTML, afterHtml: afterContainer.innerHTML }
        } catch {
            // Fall back to string-based splitting.
        }
    }

    const attrIndex = html.indexOf(`data-panel-id="${id}"`)
    if (attrIndex < 0) return null
    const tagStart = html.lastIndexOf('<onw-scene-continuation', attrIndex)
    if (tagStart < 0) return null
    const openEnd = html.indexOf('>', attrIndex)
    if (openEnd < 0) return null

    const closeTag = '</onw-scene-continuation>'
    const closeIndex = html.indexOf(closeTag, openEnd)
    const tagEnd = closeIndex >= 0 ? closeIndex + closeTag.length : openEnd + 1

    return { beforeHtml: html.slice(0, tagStart), afterHtml: html.slice(tagEnd) }
}

function collectIncludedComponentPrompts(params: {
    rootMessages: PromptMessage[]
    resolveComponentByNameKey: (nameKey: string) => Prompt | null
    maxDepth?: number
}) {
    const maxDepth = params.maxDepth ?? 5
    const included: IncludedComponentPrompt[] = []
    const invalidIncludes: string[] = []
    const seen = new Set<string>()

    const walk = (messages: PromptMessage[], depth: number, stack: string[]) => {
        if (depth > maxDepth) return
        const includeNames = extractStringArgCallsFromMessages(messages ?? EMPTY_MESSAGES, 'include')
        if (includeNames.length === 0) return

        for (const rawName of includeNames) {
            const key = normalizeKey(rawName)
            if (!key) continue

            if (stack.includes(key)) {
                invalidIncludes.push(rawName)
                continue
            }

            const prompt = params.resolveComponentByNameKey(key)
            if (!prompt) {
                invalidIncludes.push(rawName)
                continue
            }

            if (!seen.has(key)) {
                seen.add(key)
                included.push({ name: prompt.name, prompt })
            }

            walk(prompt.messages ?? EMPTY_MESSAGES, depth + 1, [...stack, key])
        }
    }

    walk(params.rootMessages ?? EMPTY_MESSAGES, 0, [])

    const invalidUnique: string[] = []
    const invalidSeen = new Set<string>()
    for (const raw of invalidIncludes) {
        const key = normalizeKey(raw)
        if (!key || invalidSeen.has(key)) continue
        invalidSeen.add(key)
        invalidUnique.push(raw.trim())
    }

    return { included, invalidIncludes: invalidUnique }
}

function safeGetLocalStorage(key: string): string | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetLocalStorage(key: string, value: string) {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(key, value)
    } catch {
        // ignore
    }
}

function safeRemoveLocalStorage(key: string) {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.removeItem(key)
    } catch {
        // ignore
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function coerceCustomPreviewState(value: unknown): CustomPreviewState | null {
    if (!isRecord(value)) return null
    const dropdownOptionIds = Array.isArray(value.dropdownOptionIds)
        ? value.dropdownOptionIds.filter((item): item is string => typeof item === 'string')
        : null
    const text = typeof value.text === 'string' ? value.text : null
    if (!dropdownOptionIds || text === null) return null
    return { dropdownOptionIds, text }
}

function coerceContentSelectionPreviewState(value: unknown): ContentSelectionPreviewState | null {
    if (!isRecord(value) || !Array.isArray(value.selections)) return null
    return {
        selections: value.selections.filter(
            (selection): selection is ContentSelectionTarget => isRecord(selection) && typeof selection.kind === 'string'
        ),
    }
}

function coerceBooleanRecord(value: unknown): Record<string, boolean> | null {
    if (!isRecord(value)) return null
    const next: Record<string, boolean> = {}
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === 'boolean') next[key] = raw
    }
    return next
}

function coerceCustomPreviewStateRecord(value: unknown): Record<string, CustomPreviewState> | null {
    if (!isRecord(value)) return null
    const next: Record<string, CustomPreviewState> = {}
    for (const [key, raw] of Object.entries(value)) {
        const coerced = coerceCustomPreviewState(raw)
        if (coerced) next[key] = coerced
    }
    return next
}

function coerceContentSelectionPreviewStateRecord(value: unknown): Record<string, ContentSelectionPreviewState> | null {
    if (!isRecord(value)) return null
    const next: Record<string, ContentSelectionPreviewState> = {}
    for (const [key, raw] of Object.entries(value)) {
        const coerced = coerceContentSelectionPreviewState(raw)
        if (coerced) next[key] = coerced
    }
    return next
}

function loadPersistedInputsEditorPreviewState(storageKey: string | null | undefined): PersistedInputsEditorPreviewState | null {
    const key = storageKey?.trim()
    if (!key) return null

    const raw = safeGetLocalStorage(key)
    if (!raw) return null

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (!isRecord(parsed)) return null

        return {
            customPreviewStateByInputId: coerceCustomPreviewStateRecord(parsed.customPreviewStateByInputId) ?? undefined,
            contentSelectionPreviewStateByInputId:
                coerceContentSelectionPreviewStateRecord(parsed.contentSelectionPreviewStateByInputId) ?? undefined,
            checkboxPreviewCheckedByInputId: coerceBooleanRecord(parsed.checkboxPreviewCheckedByInputId) ?? undefined,
            previewSceneIdOverride:
                typeof parsed.previewSceneIdOverride === 'string' && parsed.previewSceneIdOverride.trim()
                    ? parsed.previewSceneIdOverride
                    : null,
        }
    } catch {
        return null
    }
}

function normalizePersistedInputsEditorPreviewState(
    state: PersistedInputsEditorPreviewState | null | undefined
): InputsEditorPreviewState {
    return {
        customPreviewStateByInputId: state?.customPreviewStateByInputId ?? {},
        contentSelectionPreviewStateByInputId: state?.contentSelectionPreviewStateByInputId ?? {},
        checkboxPreviewCheckedByInputId: state?.checkboxPreviewCheckedByInputId ?? {},
        previewSceneIdOverride: state?.previewSceneIdOverride ?? null,
    }
}

function resolveNextState<T>(action: SetStateAction<T>, current: T): T {
    return typeof action === 'function' ? (action as (prev: T) => T)(current) : action
}

function splitPromptBlocks(text: string) {
    return (text ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n+/u)
        .map((block) => block.trim())
        .filter(Boolean)
}


export type InputsEditorProps = {
    inputDefinitions: PromptInputDefinition[]
    disabled: boolean
    onInputDefinitionsChange: (next: PromptInputDefinition[]) => void
    messages: PromptMessage[]
    promptId?: string
    promptCategory?: string
    allPrompts?: Prompt[]
    novelId?: string
    chapters?: ChapterWithScenes[]
    acts?: { number: number; title: string | null; summary?: string | null }[]
    sceneContinuationPanelId?: string | null
    previewStateStorageKey?: string | null
    persistedPreviewState?: PersistedInputsEditorPreviewState | null
    onPreviewStatePersist?: ((state: PersistedInputsEditorPreviewState) => void) | null
    instructionTerms?: string[] | null
    instructionText?: string | null
    chatUserInput?: string | null
    chatUserInputTerms?: string[] | null
    chatHistoryText?: string | null
    chatHistoryTerms?: string[] | null
    onNavigateToPromptAdvanced?: ((params: { promptId: string; inputId?: string }) => void) | null
}

export type InputsEditorValue =
    | { kind: 'custom'; dropdownOptionIds: string[]; text: string }
    | { kind: 'content_selection'; selections: ContentSelectionPreviewState['selections'] }
    | { kind: 'checkbox'; checked: boolean }

export type InputsEditorValueMap = Record<string, InputsEditorValue>

export function useInputsEditorModel({
    inputDefinitions: value,
    disabled,
    onInputDefinitionsChange: onChange,
    messages,
    promptId,
    promptCategory,
    allPrompts,
    novelId,
    chapters,
    acts,
    sceneContinuationPanelId,
    previewStateStorageKey,
    persistedPreviewState,
    onPreviewStatePersist,
    instructionTerms,
    instructionText,
    chatUserInput,
    chatUserInputTerms,
    chatHistoryText,
    chatHistoryTerms,
    onNavigateToPromptAdvanced,
}: InputsEditorProps) {
    const locale = useLocale()
    const t = useTranslations('prompts')
    const tTerms = useTranslations('editor.terms')
    const termEntries = useStoredTermEntries(novelId)
    const termEntriesMeta = useTermEntriesStore((s) => (novelId ? s.metaByNovelId[novelId] : undefined))
    const normalizedPreviewStateStorageKey = previewStateStorageKey?.trim() || null
    const activePreviewStateStorageKey = normalizedPreviewStateStorageKey ?? VOLATILE_PREVIEW_STATE_STORAGE_KEY
    const normalizedPersistedPreviewState = useMemo(
        () => normalizePersistedInputsEditorPreviewState(persistedPreviewState),
        [persistedPreviewState]
    )
    const [novelLanguage, setNovelLanguage] = useState<string | null>(null)
    const [novelOutlineCollapsesChapters, setNovelOutlineCollapsesChapters] = useState(true)
    const [novelChapters, setNovelChapters] = useState<ChapterWithScenes[]>([])
    const novelLanguageLoadTokenRef = useRef(0)
    const [novelActs, setNovelActs] = useState<Act[]>([])
    const novelActsLoadTokenRef = useRef(0)
    // Bumped when act/scene titles or summaries change elsewhere so the fetched copies of
    // acts/chapters below re-pull instead of serving stale outline data in the preview.
    const [novelDataRefreshNonce, setNovelDataRefreshNonce] = useState(0)
    const [selectedInputId, setSelectedInputId] = useState<InputId | null>(() => value[0]?.id ?? null)
    const [editingOptionId, setEditingOptionId] = useState<OptionId | null>(null)
    const [previewStateByStorageKey, setPreviewStateByStorageKey] = useState<Record<string, InputsEditorPreviewState>>(
        () => ({
            [activePreviewStateStorageKey]: normalizePersistedInputsEditorPreviewState(
                persistedPreviewState ?? loadPersistedInputsEditorPreviewState(normalizedPreviewStateStorageKey)
            ),
        })
    )
    const [allowedSettingsOpenByInputId, setAllowedSettingsOpenByInputId] = useState<
        Record<string, AllowedSettingsOpenState>
    >({})
    const [snippetPickerQuery, setSnippetPickerQuery] = useState('')
    const [snippetPickerSnippets, setSnippetPickerSnippets] = useState<Snippet[]>([])
    const [snippetPickerLoading, setSnippetPickerLoading] = useState(false)
    const [snippetPickerError, setSnippetPickerError] = useState<string | null>(null)
    const snippetPickerLoadTokenRef = useRef(0)
    const snippetPickerNovelIdRef = useRef<string | null>(null)
    const [termPickerQuery, setTermPickerQuery] = useState('')
    const [termPickerCategory, setTermPickerCategory] = useState<TermPickerCategoryFilter>('all')
    const [labelPickerQuery, setLabelPickerQuery] = useState('')
    const [labelPickerLabels, setLabelPickerLabels] = useState<NovelLabel[]>([])
    const [labelPickerLoading, setLabelPickerLoading] = useState(false)
    const [labelPickerError, setLabelPickerError] = useState<string | null>(null)
    const labelPickerLoadTokenRef = useRef(0)
    const labelPickerNovelIdRef = useRef<string | null>(null)
    const [outlinePickerQuery, setOutlinePickerQuery] = useState('')
    const [outlinePickerOutlines, setOutlinePickerOutlines] = useState<OutlineSummary[]>([])
    const [outlinePickerLoading, setOutlinePickerLoading] = useState(false)
    const [outlinePickerError, setOutlinePickerError] = useState<string | null>(null)
    const outlinePickerLoadTokenRef = useRef(0)
    const outlinePickerNovelIdRef = useRef<string | null>(null)
    // On-demand cache of detail-outline (细纲) HTML content keyed by outline id. Only the
    // outlines actually referenced (current chapter/act + picked selections) are fetched.
    const [outlineContentById, setOutlineContentById] = useState<Record<string, string>>({})
    const outlineContentLoadingRef = useRef<Set<string>>(new Set())
    const [termTagPickerQuery, setTermTagPickerQuery] = useState('')
    const currentPreviewState = useMemo(
        () =>
            previewStateByStorageKey[activePreviewStateStorageKey] ??
            normalizePersistedInputsEditorPreviewState(
                persistedPreviewState ?? loadPersistedInputsEditorPreviewState(normalizedPreviewStateStorageKey)
            ),
        [activePreviewStateStorageKey, normalizedPreviewStateStorageKey, persistedPreviewState, previewStateByStorageKey]
    )
    const updatePreviewState = useCallback(
        (updater: (prev: InputsEditorPreviewState) => InputsEditorPreviewState) => {
            setPreviewStateByStorageKey((prev) => {
                const current =
                    prev[activePreviewStateStorageKey] ??
                    normalizePersistedInputsEditorPreviewState(
                        persistedPreviewState ?? loadPersistedInputsEditorPreviewState(normalizedPreviewStateStorageKey)
                    )
                const next = updater(current)
                if (next === current) return prev
                return {
                    ...prev,
                    [activePreviewStateStorageKey]: next,
                }
            })
        },
        [activePreviewStateStorageKey, normalizedPreviewStateStorageKey, persistedPreviewState]
    )
    const customPreviewStateByInputId = currentPreviewState.customPreviewStateByInputId
    const contentSelectionPreviewStateByInputId = currentPreviewState.contentSelectionPreviewStateByInputId
    const checkboxPreviewCheckedByInputId = currentPreviewState.checkboxPreviewCheckedByInputId
    const previewSceneIdOverride = currentPreviewState.previewSceneIdOverride
    const setCustomPreviewStateByInputId: Dispatch<SetStateAction<Record<string, CustomPreviewState>>> = useCallback(
        (value) => {
            updatePreviewState((prev) => ({
                ...prev,
                customPreviewStateByInputId: resolveNextState(value, prev.customPreviewStateByInputId),
            }))
        },
        [updatePreviewState]
    )
    const setContentSelectionPreviewStateByInputId: Dispatch<
        SetStateAction<Record<string, ContentSelectionPreviewState>>
    > = useCallback(
        (value) => {
            updatePreviewState((prev) => ({
                ...prev,
                contentSelectionPreviewStateByInputId: resolveNextState(value, prev.contentSelectionPreviewStateByInputId),
            }))
        },
        [updatePreviewState]
    )
    const setCheckboxPreviewCheckedByInputId: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
        (value) => {
            updatePreviewState((prev) => ({
                ...prev,
                checkboxPreviewCheckedByInputId: resolveNextState(value, prev.checkboxPreviewCheckedByInputId),
            }))
        },
        [updatePreviewState]
    )
    const inputTypeStashRef = useRef<
        Record<
            string,
            {
                custom?: PromptCustomInputDefinition
                contentSelection?: PromptContentSelectionInputDefinition
                checkbox?: PromptCheckboxInputDefinition
            }
        >
    >({})
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    useEffect(() => {
        if (persistedPreviewState === undefined) return
        setPreviewStateByStorageKey((prev) => ({
            ...prev,
            [activePreviewStateStorageKey]: normalizedPersistedPreviewState,
        }))
    }, [activePreviewStateStorageKey, normalizedPersistedPreviewState, persistedPreviewState])

    useEffect(() => {
        onPreviewStatePersist?.({
            customPreviewStateByInputId,
            contentSelectionPreviewStateByInputId,
            checkboxPreviewCheckedByInputId,
            previewSceneIdOverride,
        })
    }, [
        checkboxPreviewCheckedByInputId,
        contentSelectionPreviewStateByInputId,
        customPreviewStateByInputId,
        onPreviewStatePersist,
        previewSceneIdOverride,
    ])

    useEffect(() => {
        if (!normalizedPreviewStateStorageKey) return

        safeSetLocalStorage(
            normalizedPreviewStateStorageKey,
            JSON.stringify({
                customPreviewStateByInputId,
                contentSelectionPreviewStateByInputId,
                checkboxPreviewCheckedByInputId,
                previewSceneIdOverride,
            } satisfies PersistedInputsEditorPreviewState)
        )
    }, [
        checkboxPreviewCheckedByInputId,
        contentSelectionPreviewStateByInputId,
        customPreviewStateByInputId,
        normalizedPreviewStateStorageKey,
        previewSceneIdOverride,
    ])

    useEffect(() => {
        if (!novelId) {
            novelLanguageLoadTokenRef.current += 1
            return
        }

        const token = ++novelLanguageLoadTokenRef.current
        novelApi
            .get(novelId)
            .then((novel) => {
                if (novelLanguageLoadTokenRef.current !== token) return
                setNovelLanguage(novel.language ?? null)
                setNovelOutlineCollapsesChapters(novel.outlineActSummaryCollapsesChapters ?? true)
                setNovelChapters(novel.chapters ?? [])
            })
            .catch((e) => {
                console.error('Failed to load novel metadata for prompt preview:', e)
                if (novelLanguageLoadTokenRef.current !== token) return
                setNovelLanguage(null)
                setNovelOutlineCollapsesChapters(true)
                setNovelChapters([])
            })
    }, [novelId, novelDataRefreshNonce])

    useEffect(() => {
        if (!novelId) {
            novelActsLoadTokenRef.current += 1
            return
        }

        const token = ++novelActsLoadTokenRef.current
        actApi
            .list(novelId)
            .then((items) => {
                if (novelActsLoadTokenRef.current !== token) return
                setNovelActs(items)
            })
            .catch((e) => {
                console.error('Failed to load acts for prompt preview:', e)
                if (novelActsLoadTokenRef.current !== token) return
                setNovelActs([])
            })
    }, [novelId, novelDataRefreshNonce])

    useEffect(() => {
        if (!novelId) return
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<NovelOutlineDataChangedDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            setNovelDataRefreshNonce((nonce) => nonce + 1)
        }
        window.addEventListener(NOVEL_OUTLINE_DATA_CHANGED_EVENT, handler as EventListener)
        return () => window.removeEventListener(NOVEL_OUTLINE_DATA_CHANGED_EVENT, handler as EventListener)
    }, [novelId])

    // Eagerly load lightweight outline summaries (no content) so the detail-outline macro and
    // picked-outline rendering can map chapter/act → outline id without waiting for the picker.
    // Shares the picker's load token + ref so the lazy `ensureOutlinesLoaded` reuses this data.
    useEffect(() => {
        if (!novelId) {
            outlinePickerLoadTokenRef.current += 1
            setOutlineContentById({})
            outlineContentLoadingRef.current.clear()
            return
        }

        const token = ++outlinePickerLoadTokenRef.current
        outlineApi
            .list(novelId)
            .then((items) => {
                if (outlinePickerLoadTokenRef.current !== token) return
                setOutlinePickerOutlines(items)
                outlinePickerNovelIdRef.current = novelId
                // Drop cached content so edited outlines re-fetch on the next render pass.
                setOutlineContentById({})
                outlineContentLoadingRef.current.clear()
            })
            .catch((e) => {
                if (outlinePickerLoadTokenRef.current !== token) return
                console.error('Failed to load outlines for prompt preview:', e)
            })
    }, [novelId, novelDataRefreshNonce])

    const effectiveNovelLanguage = novelId ? novelLanguage : null
    const isComponentPrompt = useMemo(() => normalizeKey(promptCategory ?? '') === 'component', [promptCategory])

    const componentPromptsByNameKey = useMemo(() => {
        const map = new Map<string, Prompt>()
        const list = Array.isArray(allPrompts) ? allPrompts : []
        for (const prompt of list) {
            if (normalizeKey(String(prompt.category ?? '')) !== 'component') continue
            const key = normalizeKey(prompt.name ?? '')
            if (!key || map.has(key)) continue
            map.set(key, prompt)
        }
        return map
    }, [allPrompts])

    const includeInfo = useMemo(() => {
        return collectIncludedComponentPrompts({
            rootMessages: messages ?? EMPTY_MESSAGES,
            resolveComponentByNameKey: (nameKey) => {
                const found = componentPromptsByNameKey.get(nameKey) ?? null
                if (found && promptId && found.id === promptId) return null
                return found
            },
        })
    }, [componentPromptsByNameKey, messages, promptId])

    const includedComponents = includeInfo.included
    const invalidIncludes = includeInfo.invalidIncludes

    const importedInputs = useMemo<ImportedPromptInput[]>(() => {
        const items: ImportedPromptInput[] = []
        for (const component of includedComponents) {
            const prompt = component.prompt
            const sourcePrompt = { id: prompt.id, name: prompt.name }
            for (const input of prompt.inputs ?? []) {
                items.push({ input, sourcePrompt })
            }
        }
        return items
    }, [includedComponents])

    const inputEntryById = useMemo(() => {
        const map = new Map<
            string,
            { input: PromptInputDefinition; origin: 'local' | 'imported'; sourcePrompt: ImportedPromptInput['sourcePrompt'] | null }
        >()
        for (const input of value) {
            map.set(input.id, { input, origin: 'local', sourcePrompt: null })
        }
        for (const imported of importedInputs) {
            if (map.has(imported.input.id)) continue
            map.set(imported.input.id, { input: imported.input, origin: 'imported', sourcePrompt: imported.sourcePrompt })
        }
        return map
    }, [importedInputs, value])

    const effectiveSelectedInputId = useMemo(() => {
        if (selectedInputId && inputEntryById.has(selectedInputId)) return selectedInputId
        return value[0]?.id ?? importedInputs[0]?.input.id ?? null
    }, [importedInputs, inputEntryById, selectedInputId, value])
    const allowedSettingsOpen = useMemo(() => {
        if (!effectiveSelectedInputId) return { text: false, dropdown: false }
        return allowedSettingsOpenByInputId[effectiveSelectedInputId] ?? { text: false, dropdown: false }
    }, [allowedSettingsOpenByInputId, effectiveSelectedInputId])

    const updateAllowedSettingsOpen = useCallback(
        (updater: (prev: AllowedSettingsOpenState) => AllowedSettingsOpenState) => {
            if (!effectiveSelectedInputId) return
            setAllowedSettingsOpenByInputId((prev) => {
                const current = prev[effectiveSelectedInputId] ?? { text: false, dropdown: false }
                const next = updater(current)
                return { ...prev, [effectiveSelectedInputId]: next }
            })
        },
        [effectiveSelectedInputId]
    )
    const textSettingsOpen = allowedSettingsOpen.text
    const dropdownSettingsOpen = allowedSettingsOpen.dropdown

    const selectedInputEntry = useMemo(() => {
        if (!effectiveSelectedInputId) return null
        return inputEntryById.get(effectiveSelectedInputId) ?? null
    }, [effectiveSelectedInputId, inputEntryById])

    const selectedInput = selectedInputEntry?.input ?? null
    const selectedInputOrigin = selectedInputEntry?.origin ?? 'local'
    const selectedInputSourcePrompt = selectedInputEntry?.sourcePrompt ?? null
    const selectedInputReadOnly = selectedInputOrigin === 'imported'

    const customInput = selectedInput && isCustomInput(selectedInput) ? selectedInput : null
    const contentSelectionInput = selectedInput && isContentSelectionInput(selectedInput) ? selectedInput : null
    const checkboxInput = selectedInput && isCheckboxInput(selectedInput) ? selectedInput : null

    const dropdownOptions = customInput?.custom.dropdown.options ?? EMPTY_OPTIONS
    const dropdownEnabled = customInput?.custom.dropdown.enabled ?? false
    const dropdownDisplay = customInput?.custom.dropdown.display ?? 'chips'
    const textEnabled = customInput?.custom.text.enabled ?? false
    const chapterTitleSeparator = useMemo(() => getChapterTitleSeparator(t), [t])

    const ensureSnippetsLoaded = useCallback(
        ({ resetQuery = false }: { resetQuery?: boolean } = {}) => {
            if (resetQuery) setSnippetPickerQuery('')

            if (!novelId) {
                snippetPickerNovelIdRef.current = null
                setSnippetPickerSnippets([])
                setSnippetPickerLoading(false)
                setSnippetPickerError(t('advanced.contentSelection.snippetPicker.noNovel'))
                return
            }

            const novelChanged = snippetPickerNovelIdRef.current !== novelId
            const hasData = snippetPickerSnippets.length > 0
            if (!novelChanged && hasData && !snippetPickerError) return

            snippetPickerNovelIdRef.current = novelId
            if (novelChanged) setSnippetPickerSnippets([])

            const token = ++snippetPickerLoadTokenRef.current
            setSnippetPickerLoading(true)
            setSnippetPickerError(null)

            snippetApi
                .list(novelId)
                .then((items) => {
                    if (snippetPickerLoadTokenRef.current !== token) return
                    setSnippetPickerSnippets(items)
                })
                .catch((e) => {
                    console.error('Failed to load snippets:', e)
                    if (snippetPickerLoadTokenRef.current !== token) return
                    setSnippetPickerError(t('advanced.contentSelection.snippetPicker.loadError'))
                })
                .finally(() => {
                    if (snippetPickerLoadTokenRef.current !== token) return
                    setSnippetPickerLoading(false)
                })
        },
        [novelId, snippetPickerError, snippetPickerSnippets.length, t]
    )

    const ensureLabelsLoaded = useCallback(
        ({ resetQuery = false }: { resetQuery?: boolean } = {}) => {
            if (resetQuery) setLabelPickerQuery('')

            if (!novelId) {
                labelPickerNovelIdRef.current = null
                setLabelPickerLabels([])
                setLabelPickerLoading(false)
                setLabelPickerError(t('advanced.contentSelection.labelPicker.noNovel'))
                return
            }

            const novelChanged = labelPickerNovelIdRef.current !== novelId
            const hasData = labelPickerLabels.length > 0
            if (!novelChanged && hasData && !labelPickerError) return

            labelPickerNovelIdRef.current = novelId
            if (novelChanged) setLabelPickerLabels([])

            const token = ++labelPickerLoadTokenRef.current
            setLabelPickerLoading(true)
            setLabelPickerError(null)

            labelApi
                .list(novelId)
                .then((items) => {
                    if (labelPickerLoadTokenRef.current !== token) return
                    setLabelPickerLabels(items)
                })
                .catch((e) => {
                    console.error('Failed to load labels:', e)
                    if (labelPickerLoadTokenRef.current !== token) return
                    setLabelPickerError(t('advanced.contentSelection.labelPicker.loadError'))
                })
                .finally(() => {
                    if (labelPickerLoadTokenRef.current !== token) return
                    setLabelPickerLoading(false)
                })
        },
        [labelPickerError, labelPickerLabels.length, labelPickerLoadTokenRef, novelId, t]
    )

    const ensureOutlinesLoaded = useCallback(
        ({ resetQuery = false }: { resetQuery?: boolean } = {}) => {
            if (resetQuery) setOutlinePickerQuery('')

            if (!novelId) {
                outlinePickerNovelIdRef.current = null
                setOutlinePickerOutlines([])
                setOutlinePickerLoading(false)
                setOutlinePickerError(t('advanced.contentSelection.outlinePicker.noNovel'))
                return
            }

            const novelChanged = outlinePickerNovelIdRef.current !== novelId
            const hasData = outlinePickerOutlines.length > 0
            if (!novelChanged && hasData && !outlinePickerError) return

            outlinePickerNovelIdRef.current = novelId
            if (novelChanged) setOutlinePickerOutlines([])

            const token = ++outlinePickerLoadTokenRef.current
            setOutlinePickerLoading(true)
            setOutlinePickerError(null)

            outlineApi
                .list(novelId)
                .then((items) => {
                    if (outlinePickerLoadTokenRef.current !== token) return
                    setOutlinePickerOutlines(items)
                })
                .catch((e) => {
                    console.error('Failed to load outlines:', e)
                    if (outlinePickerLoadTokenRef.current !== token) return
                    setOutlinePickerError(t('advanced.contentSelection.outlinePicker.loadError'))
                })
                .finally(() => {
                    if (outlinePickerLoadTokenRef.current !== token) return
                    setOutlinePickerLoading(false)
                })
        },
        [novelId, outlinePickerError, outlinePickerOutlines.length, t]
    )

    const selectInput = useCallback((id: InputId | null) => {
        setSelectedInputId(id)
        setEditingOptionId(null)
    }, [])

    const updateSelectedInput = useCallback(
        (updater: (prev: PromptInputDefinition) => PromptInputDefinition) => {
            if (!selectedInput) return
            if (selectedInputReadOnly) return
            onChange(value.map((item) => (item.id === selectedInput.id ? updater(item) : item)))
        },
        [onChange, selectedInput, selectedInputReadOnly, value]
    )

    const handleSetSelectedInputType = useCallback(
        (nextType: PromptInputDefinition['type']) => {
            if (!selectedInput) return
            setEditingOptionId(null)
            updateSelectedInput((prev) => {
                if (prev.type === nextType) return prev
                const stash = inputTypeStashRef.current[prev.id] ?? {}
                if (prev.type === 'custom') stash.custom = prev
                if (prev.type === 'content_selection') stash.contentSelection = prev
                if (prev.type === 'checkbox') stash.checkbox = prev
                inputTypeStashRef.current[prev.id] = stash

                if (nextType === 'custom') {
                    const stored = stash.custom
                    const fresh = createPromptInput()
                    const base = stored?.type === 'custom' ? stored : fresh.type === 'custom' ? fresh : prev
                    if (base.type !== 'custom') return prev
                    return {
                        ...base,
                        id: prev.id,
                        name: prev.name,
                        description: prev.description,
                        required: prev.required,
                        collapsed: prev.collapsed,
                    }
                }

                if (nextType === 'content_selection') {
                    const stored = stash.contentSelection
                    const base = stored?.type === 'content_selection' ? stored : createPromptContentSelectionInput()
                    return {
                        ...base,
                        id: prev.id,
                        name: prev.name,
                        description: prev.description,
                        required: prev.required,
                        collapsed: prev.collapsed,
                    }
                }

                const stored = stash.checkbox
                const base = stored?.type === 'checkbox' ? stored : createPromptCheckboxInput()
                return {
                    ...base,
                    id: prev.id,
                    name: prev.name,
                    description: prev.description,
                    required: prev.required,
                    collapsed: prev.collapsed,
                }
            })
        },
        [selectedInput, updateSelectedInput]
    )

    const updateOption = useCallback(
        (optionId: string, updater: (prev: PromptDropdownOption) => PromptDropdownOption) => {
            if (!selectedInput || selectedInput.type !== 'custom') return
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        dropdown: {
                            ...prev.custom.dropdown,
                            options: prev.custom.dropdown.options.map((opt) => (opt.id === optionId ? updater(opt) : opt)),
                        },
                    },
                }
            })
        },
        [selectedInput, updateSelectedInput]
    )

    const isInputNameDuplicate = useCallback(
        (name: string, excludeId?: string | null) => {
            const key = normalizeKey(name)
            if (!key) return false
            return value.some((input) => input.id !== excludeId && normalizeKey(input.name) === key)
        },
        [value]
    )

    const commitInputName = useCallback(
        (inputId: string, rawName: string) => {
            const current = value.find((item) => item.id === inputId) ?? null
            if (!current) return false
            if (rawName === current.name) return true
            if (isInputNameDuplicate(rawName, inputId)) return false

            onChange(
                value.map((item) => {
                    if (item.id !== inputId) return item

                    if (item.type === 'content_selection') {
                        const displayName = item.contentSelection.displayName
                        const shouldResetDisplayName =
                            displayName.trim().length > 0 && displayName.trim() === item.name.trim()
                        return {
                            ...item,
                            name: rawName,
                            contentSelection: shouldResetDisplayName
                                ? { ...item.contentSelection, displayName: '' }
                                : item.contentSelection,
                        }
                    }

                    if (item.type === 'checkbox') {
                        const displayName = item.checkbox.displayName
                        const shouldResetDisplayName =
                            displayName.trim().length > 0 && displayName.trim() === item.name.trim()
                        return {
                            ...item,
                            name: rawName,
                            checkbox: shouldResetDisplayName
                                ? { ...item.checkbox, displayName: '' }
                                : item.checkbox,
                        }
                    }

                    return {
                        ...item,
                        name: rawName,
                    }
                })
            )

            return true
        },
        [isInputNameDuplicate, onChange, value]
    )

    const navigateToPromptAdvanced = useCallback(
        ({ promptId: targetPromptId, inputId }: { promptId: string; inputId?: string }) => {
            if (!onNavigateToPromptAdvanced) return
            const trimmedPromptId = targetPromptId.trim()
            if (!trimmedPromptId) return
            onNavigateToPromptAdvanced({
                promptId: trimmedPromptId,
                inputId: inputId?.trim() || undefined,
            })
        },
        [onNavigateToPromptAdvanced]
    )

    const canNavigateToSelectedInputSource = Boolean(
        selectedInputReadOnly && selectedInputSourcePrompt?.id && onNavigateToPromptAdvanced
    )

    const handleNavigateToSelectedInputSource = useCallback(() => {
        if (!canNavigateToSelectedInputSource || !selectedInputSourcePrompt?.id) return
        navigateToPromptAdvanced({
            promptId: selectedInputSourcePrompt.id,
            inputId: selectedInput?.id,
        })
    }, [canNavigateToSelectedInputSource, navigateToPromptAdvanced, selectedInput, selectedInputSourcePrompt])

    const handleAddInput = useCallback(() => {
        const next = createPromptInput()
        next.name = makeUniqueInputName({
            baseName: t('advanced.inputs.newInputName'),
            inputs: value,
        })
        onChange([...value, next])
        selectInput(next.id)
    }, [onChange, selectInput, t, value])

    const handleDeleteSelectedInput = useCallback(() => {
        if (!selectedInput) return
        const remaining = value.filter((item) => item.id !== selectedInput.id)
        onChange(remaining)
        selectInput(remaining[0]?.id ?? null)
    }, [onChange, selectInput, selectedInput, value])

    const handleAddOption = useCallback(() => {
        if (!selectedInput || selectedInput.type !== 'custom') return
        const next = createPromptDropdownOption()
        next.label = t('advanced.dropdown.newOptionLabel')
        updateSelectedInput((prev) => {
            if (prev.type !== 'custom') return prev
            return {
                ...prev,
                custom: {
                    ...prev.custom,
                    dropdown: {
                        ...prev.custom.dropdown,
                        options: [...prev.custom.dropdown.options, next],
                    },
                },
            }
        })
        setEditingOptionId(next.id)
    }, [selectedInput, t, updateSelectedInput])

    const handleDeleteOption = useCallback(
        (optionId: string) => {
            if (!selectedInput || selectedInput.type !== 'custom') return
            const inputId = selectedInput.id
            let nextDefault: CustomPreviewState | null = null
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                const nextDropdownOptionIds = prev.custom.defaultContent.dropdownOptionIds.filter((id) => id !== optionId)
                const updatedDefault: CustomPreviewState = {
                    ...prev.custom.defaultContent,
                    dropdownOptionIds: nextDropdownOptionIds,
                }
                nextDefault = updatedDefault
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        dropdown: {
                            ...prev.custom.dropdown,
                            options: prev.custom.dropdown.options.filter((opt) => opt.id !== optionId),
                        },
                        defaultContent: updatedDefault,
                    },
                }
            })
            if (nextDefault) {
                const defaultToStore = nextDefault
                setCustomPreviewStateByInputId((prev) => ({ ...prev, [inputId]: defaultToStore }))
            }
            setEditingOptionId((prev) => (prev === optionId ? null : prev))
        },
        [selectedInput, setCustomPreviewStateByInputId, updateSelectedInput]
    )

    const handleSortOptions = useCallback(() => {
        if (!selectedInput || selectedInput.type !== 'custom') return
        updateSelectedInput((prev) => {
            if (prev.type !== 'custom') return prev
            return {
                ...prev,
                custom: {
                    ...prev.custom,
                    dropdown: {
                        ...prev.custom.dropdown,
                        options: sortOptionsAlpha(prev.custom.dropdown.options),
                    },
                },
            }
        })
    }, [selectedInput, updateSelectedInput])

    const handleReorderInputs = useCallback(
        (activeId: string, overId: string) => {
            if (activeId === overId) return
            const oldIndex = value.findIndex((item) => item.id === activeId)
            const newIndex = value.findIndex((item) => item.id === overId)
            if (oldIndex < 0 || newIndex < 0) return
            onChange(arrayMove(value, oldIndex, newIndex))
        },
        [onChange, value]
    )

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            if (!selectedInput || selectedInput.type !== 'custom') return
            const { active, over } = event
            if (!over) return
            if (active.id === over.id) return

            const options = selectedInput.custom.dropdown.options
            const oldIndex = options.findIndex((opt) => opt.id === active.id)
            const newIndex = options.findIndex((opt) => opt.id === over.id)
            if (oldIndex < 0 || newIndex < 0) return
            const reordered = arrayMove(options, oldIndex, newIndex)
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        dropdown: {
                            ...prev.custom.dropdown,
                            options: reordered,
                        },
                    },
                }
            })
        },
        [selectedInput, updateSelectedInput]
    )

    const editingOption = useMemo(() => {
        if (!editingOptionId) return null
        return dropdownOptions.find((opt) => opt.id === editingOptionId) ?? null
    }, [dropdownOptions, editingOptionId])

    const handleToggleTextAllowed = useCallback(
        (nextEnabled: boolean) => {
            if (!effectiveSelectedInputId) return
            let nextDefault: CustomPreviewState | null = null
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                const otherEnabled = prev.custom.dropdown.enabled
                if (!nextEnabled && !otherEnabled) return prev
                nextDefault = { ...prev.custom.defaultContent, text: nextEnabled ? prev.custom.defaultContent.text : '' }
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        text: {
                            ...prev.custom.text,
                            enabled: nextEnabled,
                        },
                        defaultContent: {
                            ...prev.custom.defaultContent,
                            text: nextEnabled ? prev.custom.defaultContent.text : '',
                        },
                    },
                }
            })
            if (nextDefault) {
                const defaultToStore = nextDefault
                setCustomPreviewStateByInputId((prev) => ({ ...prev, [effectiveSelectedInputId]: defaultToStore }))
            }
        },
        [effectiveSelectedInputId, setCustomPreviewStateByInputId, updateSelectedInput]
    )

    const handleToggleDropdownAllowed = useCallback(
        (nextEnabled: boolean) => {
            if (!effectiveSelectedInputId) return
            let nextDefault: CustomPreviewState | null = null
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                const otherEnabled = prev.custom.text.enabled
                if (!nextEnabled && !otherEnabled) return prev
                nextDefault = {
                    ...prev.custom.defaultContent,
                    dropdownOptionIds: nextEnabled ? prev.custom.defaultContent.dropdownOptionIds : [],
                }
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        dropdown: {
                            ...prev.custom.dropdown,
                            enabled: nextEnabled,
                        },
                        defaultContent: {
                            ...prev.custom.defaultContent,
                            dropdownOptionIds: nextEnabled ? prev.custom.defaultContent.dropdownOptionIds : [],
                        },
                    },
                }
            })
            if (nextDefault) {
                const defaultToStore = nextDefault
                setCustomPreviewStateByInputId((prev) => ({ ...prev, [effectiveSelectedInputId]: defaultToStore }))
            }
        },
        [effectiveSelectedInputId, setCustomPreviewStateByInputId, updateSelectedInput]
    )

    const handleDefaultDropdownOptionIdsChange = useCallback(
        (nextIds: string[]) => {
            if (!effectiveSelectedInputId) return
            let nextDefault: CustomPreviewState | null = null
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                const allowMultiple = prev.custom.dropdown.allowMultiple
                const normalizedIds = allowMultiple ? nextIds : nextIds.slice(0, 1)
                const shouldClearText = !allowMultiple && prev.custom.text.enabled && prev.custom.dropdown.enabled
                const updatedDefault: CustomPreviewState = {
                    ...prev.custom.defaultContent,
                    dropdownOptionIds: normalizedIds,
                    text: shouldClearText ? '' : prev.custom.defaultContent.text,
                }
                nextDefault = updatedDefault
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        defaultContent: updatedDefault,
                    },
                }
            })
            if (nextDefault) {
                const defaultToStore = nextDefault
                setCustomPreviewStateByInputId((prev) => ({ ...prev, [effectiveSelectedInputId]: defaultToStore }))
            }
        },
        [effectiveSelectedInputId, setCustomPreviewStateByInputId, updateSelectedInput]
    )

    const handleDefaultTextChange = useCallback(
        (nextText: string) => {
            if (!effectiveSelectedInputId) return
            let nextDefault: CustomPreviewState | null = null
            updateSelectedInput((prev) => {
                if (prev.type !== 'custom') return prev
                const allowMultiple = prev.custom.dropdown.allowMultiple
                const shouldClearDropdown = !allowMultiple && prev.custom.text.enabled && prev.custom.dropdown.enabled
                const updatedDefault: CustomPreviewState = {
                    ...prev.custom.defaultContent,
                    dropdownOptionIds: shouldClearDropdown ? [] : prev.custom.defaultContent.dropdownOptionIds,
                    text: nextText,
                }
                nextDefault = updatedDefault
                return {
                    ...prev,
                    custom: {
                        ...prev.custom,
                        defaultContent: updatedDefault,
                    },
                }
            })
            if (nextDefault) {
                const defaultToStore = nextDefault
                setCustomPreviewStateByInputId((prev) => ({ ...prev, [effectiveSelectedInputId]: defaultToStore }))
            }
        },
        [effectiveSelectedInputId, setCustomPreviewStateByInputId, updateSelectedInput]
    )

    const handleUpdateCustomPreviewState = useCallback(
        (inputId: string, fallback: CustomPreviewState, updater: (prev: CustomPreviewState) => CustomPreviewState) => {
            setCustomPreviewStateByInputId((prev) => {
                const current = prev[inputId] ?? fallback
                return { ...prev, [inputId]: updater(current) }
            })
        },
        [setCustomPreviewStateByInputId]
    )

    const handleUpdateContentSelectionPreviewState = useCallback(
        (
            inputId: string,
            fallback: ContentSelectionPreviewState,
            updater: (prev: ContentSelectionPreviewState) => ContentSelectionPreviewState
        ) => {
            setContentSelectionPreviewStateByInputId((prev) => {
                const current = prev[inputId] ?? fallback
                return { ...prev, [inputId]: updater(current) }
            })
        },
        [setContentSelectionPreviewStateByInputId]
    )

    const calledInputNames = useMemo(() => {
        const seen = new Set<string>()
        const result: string[] = []

        const addNames = (names: string[]) => {
            for (const rawName of names) {
                const trimmed = rawName.trim()
                if (!trimmed) continue
                const key = trimmed.toLowerCase()
                if (seen.has(key)) continue
                seen.add(key)
                result.push(trimmed)
            }
        }

        addNames(extractStringArgCallsFromMessages(messages ?? EMPTY_MESSAGES, 'input'))
        for (const component of includedComponents) {
            addNames(extractStringArgCallsFromMessages(component.prompt.messages ?? EMPTY_MESSAGES, 'input'))
        }

        return result
    }, [includedComponents, messages])
    const inputByNameKey = useMemo(() => {
        const map = new Map<string, PromptInputDefinition>()
        const add = (item: PromptInputDefinition) => {
            const key = item.name.trim().toLowerCase()
            if (!key) return
            if (map.has(key)) return
            map.set(key, item)
        }

        value.forEach(add)
        importedInputs.forEach((item) => add(item.input))
        return map
    }, [importedInputs, value])

    const previewInputs = useMemo(() => {
        if (calledInputNames.length === 0) return value
        return calledInputNames
            .map((name) => inputByNameKey.get(name.toLowerCase()) ?? null)
            .filter((item): item is PromptInputDefinition => item !== null)
    }, [calledInputNames, inputByNameKey, value])

    const usedInputIds = useMemo(() => {
        const inputs = calledInputNames.length === 0 ? value : previewInputs
        return new Set(inputs.map((input) => input.id))
    }, [calledInputNames.length, previewInputs, value])

    useEffect(() => {
        if (!promptId) return
        const raw = safeGetLocalStorage(PROMPT_INPUT_NAVIGATION_KEY)
        if (!raw) return
        try {
            const parsed = JSON.parse(raw) as { promptId?: unknown; inputId?: unknown }
            if (parsed.promptId !== promptId) return
            const nextInputId = typeof parsed.inputId === 'string' && parsed.inputId.trim() ? parsed.inputId : null
            if (nextInputId && inputEntryById.has(nextInputId)) {
                setSelectedInputId(nextInputId)
            }
        } catch {
            // Ignore invalid pending navigation state.
        } finally {
            safeRemoveLocalStorage(PROMPT_INPUT_NAVIGATION_KEY)
        }
    }, [inputEntryById, promptId])

    const missingInputNames = useMemo(
        () => calledInputNames.filter((name) => !inputByNameKey.has(name.toLowerCase())),
        [calledInputNames, inputByNameKey]
    )

    const handleAddMissingInputs = useCallback(() => {
        if (missingInputNames.length === 0) return
        const existing = new Set(value.map((item) => item.name.trim().toLowerCase()).filter(Boolean))
        const additions: PromptInputDefinition[] = []
        for (const rawName of missingInputNames) {
            const name = rawName.trim()
            const key = name.toLowerCase()
            if (!key || existing.has(key)) continue
            const next = createPromptInput()
            next.name = name
            additions.push(next)
            existing.add(key)
        }
        if (additions.length === 0) return
        onChange([...value, ...additions])
        if (!effectiveSelectedInputId) selectInput(additions[0]?.id ?? null)
    }, [effectiveSelectedInputId, missingInputNames, onChange, selectInput, value])

    const effectiveChapters = useMemo(
        () => chapters ?? (novelId ? novelChapters : EMPTY_CHAPTERS),
        [chapters, novelChapters, novelId]
    )

    const sortedChapters = useMemo(() => {
        const items = [...effectiveChapters]
        items.sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
        return items.map((chapter, index) => ({
            ...chapter,
            displayNumber: index + 1,
            scenes: [...(chapter.scenes ?? [])].sort((a, b) => a.order - b.order),
        }))
    }, [effectiveChapters])

    const previewSceneOptions = useMemo(
        () => buildPreviewSceneOptions({ chapters: effectiveChapters, t }),
        [effectiveChapters, t]
    )

    const previewSceneId = (() => {
        const override = previewSceneIdOverride
        if (override && previewSceneOptions.some((opt) => opt.id === override)) return override
        return previewSceneOptions[previewSceneOptions.length - 1]?.id ?? null
    })()

    const setPreviewSceneId = useCallback((nextId: string | null) => {
        const normalizedNextId = nextId && nextId.trim() ? nextId : null
        updatePreviewState((prev) => {
            if (prev.previewSceneIdOverride === normalizedNextId) return prev
            return {
                ...prev,
                previewSceneIdOverride: normalizedNextId,
            }
        })
    }, [updatePreviewState])

    const sceneById = useMemo(() => {
        const map = new Map<string, { chapterId: string; scene: ChapterWithScenes['scenes'][number] }>()
        sortedChapters.forEach((chapter) => {
            chapter.scenes.forEach((scene) => {
                map.set(scene.id, { chapterId: chapter.id, scene })
            })
        })
        return map
    }, [sortedChapters])

    const previewSceneHtml = (() => {
        if (!previewSceneId) return ''
        const scene = sceneById.get(previewSceneId)?.scene ?? null
        return scene?.content ?? ''
    })()

    const previewSceneText = previewSceneHtml ? htmlToText(previewSceneHtml, { paragraphSeparator: '\n' }) : ''
    const previousPreviewSceneText = useMemo(() => {
        if (!previewSceneId) return ''
        return htmlToText(
            findPreviousSceneContent({
                chapters: sortedChapters,
                currentChapterId: sceneById.get(previewSceneId)?.chapterId ?? null,
                currentSceneId: previewSceneId,
            }),
            { paragraphSeparator: '\n' }
        )
    }, [previewSceneId, sceneById, sortedChapters])

    const sceneContinueContext = useMemo(() => {
        const id = (sceneContinuationPanelId ?? '').trim()
        if (id && previewSceneHtml) {
            const split = splitSceneHtmlBySceneContinuationPanelId(previewSceneHtml, id)
            if (split) {
                const previousText =
                    htmlToText(split.beforeHtml, { paragraphSeparator: '\n' }).trim() || previousPreviewSceneText.trim()
                const followText = htmlToText(split.afterHtml, { paragraphSeparator: '\n' })
                return {
                    previousText,
                    followText,
                    hasPreviousText: previousText.trim().length > 0,
                    hasFollowText: followText.trim().length > 0,
                }
            }
        }

        const previousText = previewSceneText.trim() || previousPreviewSceneText.trim()
        return {
            previousText,
            followText: '',
            hasPreviousText: previousText.trim().length > 0,
            hasFollowText: false,
        }
    }, [previewSceneHtml, previewSceneText, previousPreviewSceneText, sceneContinuationPanelId])

    // The chapter/act the current preview scene belongs to — drives the detail-outline macro.
    const currentChapterIdForOutline = previewSceneId ? (sceneById.get(previewSceneId)?.chapterId ?? null) : null
    const currentActNumberForOutline = useMemo(() => {
        if (!currentChapterIdForOutline) return null
        return sortedChapters.find((chapter) => chapter.id === currentChapterIdForOutline)?.actNumber ?? null
    }, [currentChapterIdForOutline, sortedChapters])

    const actOutlineSummaryByNumber = useMemo(() => {
        const map = new Map<number, OutlineSummary>()
        for (const summary of outlinePickerOutlines) {
            if (summary.type !== 'ACT' || summary.actNumber == null) continue
            if (!map.has(summary.actNumber)) map.set(summary.actNumber, summary)
        }
        return map
    }, [outlinePickerOutlines])

    const chapterOutlineSummaryById = useMemo(() => {
        const map = new Map<string, OutlineSummary>()
        for (const summary of outlinePickerOutlines) {
            if (summary.type !== 'CHAPTER' || !summary.chapterId) continue
            if (!map.has(summary.chapterId)) map.set(summary.chapterId, summary)
        }
        return map
    }, [outlinePickerOutlines])

    // Detail-outlines explicitly picked inside content-selection inputs (act 卷纲 / chapter 章纲).
    const selectedOutlineKeys = useMemo(() => {
        const actNumbers = new Set<number>()
        const chapterIds = new Set<string>()
        for (const input of previewInputs) {
            if (input.type !== 'content_selection') continue
            const state = contentSelectionPreviewStateByInputId[input.id]
            const selections = Array.isArray(state?.selections) ? state.selections : []
            for (const selection of selections) {
                if (selection.kind === 'act_outline' && typeof selection.actNumber === 'number') {
                    actNumbers.add(selection.actNumber)
                } else if (selection.kind === 'chapter_outline' && selection.chapterId) {
                    chapterIds.add(selection.chapterId)
                }
            }
        }
        return { actNumbers, chapterIds }
    }, [contentSelectionPreviewStateByInputId, previewInputs])

    const neededOutlineIds = useMemo(() => {
        const ids = new Set<string>()
        const addActOutline = (actNumber: number | null | undefined) => {
            if (typeof actNumber !== 'number') return
            const id = actOutlineSummaryByNumber.get(actNumber)?.id
            if (id) ids.add(id)
        }
        const addChapterOutline = (chapterId: string | null | undefined) => {
            if (!chapterId) return
            const id = chapterOutlineSummaryById.get(chapterId)?.id
            if (id) ids.add(id)
        }
        addChapterOutline(currentChapterIdForOutline)
        addActOutline(currentActNumberForOutline)
        selectedOutlineKeys.actNumbers.forEach(addActOutline)
        selectedOutlineKeys.chapterIds.forEach(addChapterOutline)
        return ids
    }, [
        actOutlineSummaryByNumber,
        chapterOutlineSummaryById,
        currentActNumberForOutline,
        currentChapterIdForOutline,
        selectedOutlineKeys,
    ])

    useEffect(() => {
        let cancelled = false
        for (const id of neededOutlineIds) {
            if (id in outlineContentById) continue
            if (outlineContentLoadingRef.current.has(id)) continue
            outlineContentLoadingRef.current.add(id)
            outlineApi
                .get(id)
                .then((outline) => {
                    if (cancelled) return
                    setOutlineContentById((prev) => ({ ...prev, [id]: outline.content ?? '' }))
                })
                .catch((e) => {
                    console.error('Failed to load outline content for prompt preview:', e)
                    if (cancelled) return
                    setOutlineContentById((prev) => (id in prev ? prev : { ...prev, [id]: '' }))
                })
                .finally(() => {
                    outlineContentLoadingRef.current.delete(id)
                })
        }
        return () => {
            cancelled = true
        }
    }, [neededOutlineIds, outlineContentById])

    const outlineTextByActNumber = useMemo(() => {
        const map = new Map<number, string>()
        for (const [actNumber, summary] of actOutlineSummaryByNumber) {
            const raw = outlineContentById[summary.id]
            if (raw == null) continue
            const text = htmlToText(raw, { paragraphSeparator: '\n' }).trim()
            if (text) map.set(actNumber, text)
        }
        return map
    }, [actOutlineSummaryByNumber, outlineContentById])

    const outlineTextByChapterId = useMemo(() => {
        const map = new Map<string, string>()
        for (const [chapterId, summary] of chapterOutlineSummaryById) {
            const raw = outlineContentById[summary.id]
            if (raw == null) continue
            const text = htmlToText(raw, { paragraphSeparator: '\n' }).trim()
            if (text) map.set(chapterId, text)
        }
        return map
    }, [chapterOutlineSummaryById, outlineContentById])

    const sortedActs = useMemo(() => {
        const items = [...(acts ?? [])].sort((a, b) => a.number - b.number)
        if (items.length > 0) return items
        const numbers = [...new Set(sortedChapters.map((c) => c.actNumber))].sort((a, b) => a - b)
        return numbers.map((number) => ({ number, title: null as string | null }))
    }, [acts, sortedChapters])

    const effectiveActsForOutline = useMemo(() => {
        const map = new Map<number, { number: number; title: string | null; summary: string | null }>()
        const sourceActs = novelId ? novelActs : []

        sourceActs.forEach((act) => {
            map.set(act.number, {
                number: act.number,
                title: act.title,
                summary: act.summary,
            })
        })

        ;(acts ?? []).forEach((act) => {
            const existing = map.get(act.number)
            map.set(act.number, {
                number: act.number,
                title: act.title ?? existing?.title ?? null,
                summary: act.summary ?? existing?.summary ?? null,
            })
        })

        return [...map.values()].sort((left, right) => left.number - right.number)
    }, [acts, novelActs, novelId])

    const previewNovelOutline = useMemo(
        () =>
            buildNovelOutlineTexts({
                acts: effectiveActsForOutline,
                chapters: sortedChapters.map((chapter) => ({
                    id: chapter.id,
                    title: chapter.title,
                    actNumber: chapter.actNumber,
                    order: chapter.order,
                    scenes: chapter.scenes.map((scene) => ({
                        id: scene.id,
                        order: scene.order,
                        summary: scene.summary,
                    })),
                })),
                currentChapterId: previewSceneId ? (sceneById.get(previewSceneId)?.chapterId ?? null) : null,
                currentSceneId: previewSceneId,
                language: effectiveNovelLanguage,
                collapseChaptersWhenActSummary: novelOutlineCollapsesChapters,
            }),
        [effectiveActsForOutline, effectiveNovelLanguage, novelOutlineCollapsesChapters, previewSceneId, sceneById, sortedChapters]
    )

    const chapterCountByActNumber = useMemo(() => {
        const map = new Map<number, number>()
        sortedChapters.forEach((chapter) => {
            map.set(chapter.actNumber, (map.get(chapter.actNumber) ?? 0) + 1)
        })
        return map
    }, [sortedChapters])

    const snippetPickerItems = useMemo(() => {
        const q = snippetPickerQuery.trim().toLowerCase()
        const sorted = [...snippetPickerSnippets].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })
        if (!q) return sorted
        return sorted.filter((snippet) => {
            const title = snippet.title?.toLowerCase() ?? ''
            const content = htmlToText(snippet.content).toLowerCase()
            return title.includes(q) || content.includes(q)
        })
    }, [snippetPickerQuery, snippetPickerSnippets])

    const termPickerItems = useMemo(() => {
        const q = termPickerQuery.trim().toLowerCase()
        const base = termEntries.filter((entry) => !entry.archived)
        const filtered = q
            ? base.filter((entry) => {
                  const title = entry.title?.toLowerCase() ?? ''
                  const aliases = entry.aliases?.toLowerCase() ?? ''
                  return title.includes(q) || aliases.includes(q)
              })
            : base
        return filtered.slice().sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    }, [termEntries, termPickerQuery])

    const labelPickerItems = useMemo(() => {
        const q = labelPickerQuery.trim().toLowerCase()
        const sorted = [...labelPickerLabels].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        if (!q) return sorted
        return sorted.filter((label) => (label.name ?? '').toLowerCase().includes(q))
    }, [labelPickerLabels, labelPickerQuery])

    const outlinePickerItems = useMemo(() => {
        const q = outlinePickerQuery.trim().toLowerCase()
        const chapterIndexById = new Map(sortedChapters.map((chapter, index) => [chapter.id, index]))

        const sorted = [...outlinePickerOutlines].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'ACT' ? -1 : 1
            if (a.type === 'ACT') return (a.actNumber ?? 0) - (b.actNumber ?? 0)
            const aIndex = chapterIndexById.get(a.chapterId ?? '') ?? Number.MAX_SAFE_INTEGER
            const bIndex = chapterIndexById.get(b.chapterId ?? '') ?? Number.MAX_SAFE_INTEGER
            return aIndex - bIndex
        })

        if (!q) return sorted

        return sorted.filter((outline) => {
            if (outline.type === 'ACT') {
                const actNumber = outline.actNumber ?? 0
                const act = sortedActs.find((item) => item.number === actNumber) ?? null
                const base = t('advanced.contentSelection.actLabel', { number: actNumber })
                const label = act?.title?.trim() ? `${base}: ${act.title.trim()}` : base
                return label.toLowerCase().includes(q)
            }

            const chapterId = outline.chapterId ?? ''
            const chapter = sortedChapters.find((item) => item.id === chapterId) ?? null
            if (!chapter) return chapterId.toLowerCase().includes(q)

            const base = t('advanced.contentSelection.chapterLabel', { number: chapter.displayNumber })
            const label = getChapterDisplayLabel({
                title: chapter.title,
                displayNumber: chapter.displayNumber,
                labelBase: base,
                chapterWord: t('advanced.contentSelection.chapter'),
                separator: chapterTitleSeparator,
            })

            return label.toLowerCase().includes(q)
        })
    }, [
        chapterTitleSeparator,
        outlinePickerOutlines,
        outlinePickerQuery,
        sortedActs,
        sortedChapters,
        t,
    ])

    const termTagPickerItems = useMemo(() => {
        const q = termTagPickerQuery.trim().toLowerCase()
        const tags = new Set<string>()

        termEntries.forEach((entry) => {
            if (entry.archived) return
            ;(entry.tags ?? []).forEach((raw) => {
                const trimmed = raw.trim()
                if (!trimmed) return
                tags.add(trimmed)
            })
        })

        const sorted = [...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

        if (!q) return sorted
        return sorted.filter((tag) => tag.toLowerCase().includes(q))
    }, [termEntries, termTagPickerQuery])

    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry])), [termEntries])
    const labelPickerById = useMemo(() => new Map(labelPickerLabels.map((label) => [label.id, label])), [labelPickerLabels])
    const contentSelectionTemplateResources = useMemo(
        () => ({
            acts: sortedActs.map((act) => ({
                number: act.number,
                title: act.title ?? null,
                summary:
                    effectiveActsForOutline.find((item) => item.number === act.number)?.summary ??
                    null,
            })),
            chapters: sortedChapters.map((chapter) => ({
                id: chapter.id,
                title: chapter.title,
                order: chapter.order,
                actNumber: chapter.actNumber,
                scenes: chapter.scenes.map((scene) => ({
                    id: scene.id,
                    order: scene.order,
                    summary: scene.summary ?? null,
                    content: scene.content ?? '',
                })),
            })),
            chaptersById: new Map(
                sortedChapters.map((chapter) => [
                    chapter.id,
                    {
                        id: chapter.id,
                        title: chapter.title,
                        order: chapter.order,
                        actNumber: chapter.actNumber,
                        scenes: chapter.scenes.map((scene) => ({
                            id: scene.id,
                            order: scene.order,
                            summary: scene.summary ?? null,
                            content: scene.content ?? '',
                        })),
                    },
                ])
            ),
            scenesById: new Map(
                sortedChapters.flatMap((chapter) =>
                    chapter.scenes.map((scene) => [
                        scene.id,
                        {
                            id: scene.id,
                            order: scene.order,
                            summary: scene.summary ?? null,
                            content: scene.content ?? '',
                        },
                    ] as const)
                )
            ),
            novelOutlineFull: previewNovelOutline.full,
            outlineTextByActNumber,
            outlineTextByChapterId,
        }),
        [effectiveActsForOutline, outlineTextByActNumber, outlineTextByChapterId, previewNovelOutline.full, sortedActs, sortedChapters]
    )

    const templateContext = useMemo(
        () => ({
            novelLanguage: effectiveNovelLanguage,
            novelOutlineStorySoFar: previewNovelOutline.storysofar,
            novelOutlineFull: previewNovelOutline.full,
            sceneText: previewSceneText,
            sceneContinuePreviousText: sceneContinueContext.previousText,
            sceneContinueFollowText: sceneContinueContext.followText,
            sceneContinueHasPreviousText: sceneContinueContext.hasPreviousText,
            sceneContinueHasFollowText: sceneContinueContext.hasFollowText,
            sceneChapterOutline: currentChapterIdForOutline ? (outlineTextByChapterId.get(currentChapterIdForOutline) ?? '') : '',
            sceneActOutline:
                typeof currentActNumberForOutline === 'number' ? (outlineTextByActNumber.get(currentActNumberForOutline) ?? '') : '',
            instructionText: instructionText ?? '',
            instructionTerms: instructionTerms ?? [],
            chatUserInput: chatUserInput ?? '',
            chatUserInputTerms: chatUserInputTerms ?? [],
            chatHistoryText: chatHistoryText ?? '',
            chatHistoryTerms: chatHistoryTerms ?? [],
        }),
        [
            chatHistoryTerms,
            chatHistoryText,
            chatUserInput,
            chatUserInputTerms,
            currentActNumberForOutline,
            currentChapterIdForOutline,
            effectiveNovelLanguage,
            instructionTerms,
            instructionText,
            outlineTextByActNumber,
            outlineTextByChapterId,
            previewNovelOutline.full,
            previewNovelOutline.storysofar,
            previewSceneText,
            sceneContinueContext,
        ]
    )

    const buildInputPreviewValue = useCallback(
        (input: PromptInputDefinition): string => {
            if (input.type === 'checkbox') {
                const checked = checkboxPreviewCheckedByInputId[input.id] ?? input.checkbox.defaultChecked
                if (!checked) return ''
                return (input.checkbox.displayName || input.name).trim()
            }

            if (input.type === 'custom') {
                const state = customPreviewStateByInputId[input.id] ?? input.custom.defaultContent
                const allowMultiple = input.custom.dropdown.allowMultiple
                const selectedIds = allowMultiple ? state.dropdownOptionIds : state.dropdownOptionIds.slice(0, 1)
                const options = input.custom.dropdown.options ?? EMPTY_OPTIONS

                const optionParts = selectedIds
                    .map((id) => options.find((opt) => opt.id === id) ?? null)
                    .filter((opt): opt is PromptDropdownOption => opt !== null)
                    .map((opt) => (opt.content?.trim() ? opt.content.trim() : opt.label.trim()))
                    .filter(Boolean)

                const textPart = state.text?.trim() ?? ''
                const parts = [...optionParts, textPart].filter((part) => part.trim())
                return parts.join('\n\n').trim()
            }

            if (input.type !== 'content_selection') return ''

            const state = contentSelectionPreviewStateByInputId[input.id] ?? {
                selections: [],
            }

            const selections = Array.isArray(state.selections) ? state.selections : []
            if (selections.length === 0) return ''

            const parts: string[] = []
            const structureKinds: Array<'fullNovel' | 'act' | 'chapter' | 'scene'> = ['fullNovel', 'act', 'chapter', 'scene']
            for (const kind of structureKinds) {
                const items = getContentSelectionTemplateItems({
                    kind,
                    input,
                    selections,
                    resources: contentSelectionTemplateResources,
                    locale,
                })
                parts.push(...items.map((item) => item.value).filter(Boolean))
            }

            for (const selection of selections) {
                if (selection.kind === 'scene' || selection.kind === 'chapter' || selection.kind === 'act' || selection.kind === 'full_novel') {
                    continue
                }

                if (selection.kind === 'snippet') {
                    const snippet = snippetPickerSnippets.find((item) => item.id === selection.snippetId) ?? null
                    const rendered = snippet
                        ? htmlToText(snippet.content ?? '', { paragraphSeparator: '\n' }).trim()
                        : ''
                    if (rendered) parts.push(rendered)
                    continue
                }

                if (selection.kind === 'term') {
                    const entry = termEntriesById.get(selection.termId) ?? null
                    if (!entry) continue
                    const rendered = [
                        entry.title?.trim(),
                        entry.subtitle?.trim(),
                        entry.description?.trim(),
                        entry.researchNotes?.trim(),
                    ]
                        .filter(Boolean)
                        .join('\n')
                        .trim()
                    if (rendered) parts.push(rendered)
                    continue
                }

                if (selection.kind === 'label') {
                    const label = labelPickerById.get(selection.labelId) ?? null
                    const rendered = label?.name?.trim() ?? ''
                    if (rendered) parts.push(rendered)
                    continue
                }

                if (selection.kind === 'term_tag') {
                    const rendered = selection.tag?.trim() ?? ''
                    if (rendered) parts.push(rendered)
                    continue
                }
            }

            return parts.join('\n\n').trim()
        },
        [
            checkboxPreviewCheckedByInputId,
            contentSelectionPreviewStateByInputId,
            contentSelectionTemplateResources,
            customPreviewStateByInputId,
            labelPickerById,
            snippetPickerSnippets,
            termEntriesById,
            locale,
        ]
    )

    const inputValues = useMemo<InputsEditorValueMap>(() => {
        const out: InputsEditorValueMap = {}

        for (const input of value) {
            const name = input.name.trim()
            if (!name || name in out) continue

            if (input.type === 'custom') {
                const state = customPreviewStateByInputId[input.id] ?? {
                    dropdownOptionIds: [...(input.custom.defaultContent.dropdownOptionIds ?? [])],
                    text: input.custom.defaultContent.text ?? '',
                }
                out[name] = {
                    kind: 'custom',
                    dropdownOptionIds: [...state.dropdownOptionIds],
                    text: state.text,
                }
                continue
            }

            if (input.type === 'content_selection') {
                const state = contentSelectionPreviewStateByInputId[input.id] ?? { selections: [] }
                out[name] = {
                    kind: 'content_selection',
                    selections: [...state.selections],
                }
                continue
            }

            out[name] = {
                kind: 'checkbox',
                checked: checkboxPreviewCheckedByInputId[input.id] ?? input.checkbox.defaultChecked,
            }
        }

        return out
    }, [checkboxPreviewCheckedByInputId, contentSelectionPreviewStateByInputId, customPreviewStateByInputId, value])

    const missingRequiredInputNames = useMemo(() => {
        const missing: string[] = []
        const seen = new Set<string>()
        for (const input of previewInputs) {
            if (!input.required) continue
            if (buildInputPreviewValue(input).trim()) continue
            const name = input.name.trim() || t('advanced.inputs.untitled')
            const key = name.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            missing.push(name)
        }
        return missing
    }, [buildInputPreviewValue, previewInputs, t])

    const resolveInputValue = useCallback(
        (name: string) => {
            const key = normalizeKey(name)
            if (!key) return null
            const input = inputByNameKey.get(key) ?? null
            if (!input) return null
            return buildInputPreviewValue(input)
        },
        [buildInputPreviewValue, inputByNameKey]
    )

    const termIdsByTagKey = useMemo(() => {
        const map = new Map<string, string[]>()
        const normalize = (raw: string) => raw.trim().toLocaleLowerCase()

        for (const entry of termEntries) {
            if (entry.archived) continue
            for (const rawTag of entry.tags ?? []) {
                const key = normalize(rawTag)
                if (!key) continue
                const list = map.get(key) ?? []
                list.push(entry.id)
                map.set(key, list)
            }
        }

        // Keep deterministic order for stable renders.
        for (const [key, ids] of map.entries()) {
            const sorted = ids
                .slice()
                .sort((a, b) => {
                    const aTitle = termEntriesById.get(a)?.title ?? a
                    const bTitle = termEntriesById.get(b)?.title ?? b
                    return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' })
                })
            map.set(key, sorted)
        }

        return map
    }, [termEntries, termEntriesById])

    const resolveInputTermIds = useCallback(
        (name: string) => {
            const key = normalizeKey(name)
            if (!key) return null
            const input = inputByNameKey.get(key) ?? null
            if (!input) return null
            if (input.type !== 'content_selection') return []

            const state = contentSelectionPreviewStateByInputId[input.id] ?? { selections: [] }
            const selections = Array.isArray(state.selections) ? state.selections : []

            const out: string[] = []
            const seen = new Set<string>()
            for (const selection of selections) {
                if (selection.kind !== 'term') continue
                const id = (selection.termId ?? '').trim()
                const entry = id ? termEntriesById.get(id) ?? null : null
                if (!entry || entry.archived) continue
                if (seen.has(id)) continue
                seen.add(id)
                out.push(id)
            }
            return out
        },
        [contentSelectionPreviewStateByInputId, inputByNameKey, termEntriesById]
    )

    const resolveInputTermTagTermIds = useCallback(
        (name: string) => {
            const key = normalizeKey(name)
            if (!key) return null
            const input = inputByNameKey.get(key) ?? null
            if (!input) return null
            if (input.type !== 'content_selection') return []

            const state = contentSelectionPreviewStateByInputId[input.id] ?? { selections: [] }
            const selections = Array.isArray(state.selections) ? state.selections : []
            const normalize = (raw: string) => raw.trim().toLocaleLowerCase()

            const out: string[] = []
            const seen = new Set<string>()

            for (const selection of selections) {
                if (selection.kind !== 'term_tag') continue
                const tagKey = normalize(selection.tag ?? '')
                if (!tagKey) continue
                const ids = termIdsByTagKey.get(tagKey) ?? []
                for (const id of ids) {
                    if (seen.has(id)) continue
                    seen.add(id)
                    out.push(id)
                }
            }

            return out
        },
        [contentSelectionPreviewStateByInputId, inputByNameKey, termIdsByTagKey]
    )

    const resolveInputSnippets = useCallback(
        (name: string) => {
            const key = normalizeKey(name)
            if (!key) return null
            const input = inputByNameKey.get(key) ?? null
            if (!input) return null
            if (input.type !== 'content_selection') return []

            const state = contentSelectionPreviewStateByInputId[input.id] ?? { selections: [] }
            const selections = Array.isArray(state.selections) ? state.selections : []
            const out: Array<{ text: string; value: string }> = []
            const seen = new Set<string>()

            for (const selection of selections) {
                if (selection.kind !== 'snippet') continue
                const id = (selection.snippetId ?? '').trim()
                if (!id || seen.has(id)) continue

                const snippet = snippetPickerSnippets.find((item) => item.id === id) ?? null
                if (!snippet) continue

                seen.add(id)
                const value = htmlToText(snippet.content ?? '', { paragraphSeparator: '\n' }).trim()
                const text = snippet.title?.trim() || value.split('\n')[0]?.trim() || ''
                if (!text && !value) continue
                out.push({ text, value })
            }

            return out
        },
        [contentSelectionPreviewStateByInputId, inputByNameKey, snippetPickerSnippets]
    )

    const resolveInputContentSelectionItems = useCallback(
        (name: string, kind: 'fullNovel' | 'act' | 'chapter' | 'scene' | 'actOutline' | 'chapterOutline') => {
            const key = normalizeKey(name)
            if (!key) return null
            const input = inputByNameKey.get(key) ?? null
            if (!input || input.type !== 'content_selection') return []

            const state = contentSelectionPreviewStateByInputId[input.id] ?? { selections: [] }
            const selections = Array.isArray(state.selections) ? state.selections : []
            return getContentSelectionTemplateItems({
                kind,
                input,
                selections,
                resources: contentSelectionTemplateResources,
                locale,
            })
        },
        [contentSelectionPreviewStateByInputId, contentSelectionTemplateResources, inputByNameKey, locale]
    )

    const resolveTermText = useCallback(
        (termId: string) => {
            const id = (termId ?? '').trim()
            if (!id) return null
            const entry = termEntriesById.get(id) ?? null
            const rendered = renderTermTemplateText(entry)
            return rendered || null
        },
        [termEntriesById]
    )

    const resolveTermValue = useCallback(
        (termId: string) => {
            const id = (termId ?? '').trim()
            if (!id) return null
            const entry = termEntriesById.get(id) ?? null
            const rendered = renderTermTemplateValue({
                entry,
                locale,
                customCategories: termEntriesMeta?.customCategories,
            })
            return rendered || null
        },
        [locale, termEntriesById, termEntriesMeta?.customCategories]
    )

    const resolveIncludeContent = useCallback(
        (name: string) => {
            const key = normalizeKey(name)
            if (!key) return null
            const prompt = componentPromptsByNameKey.get(key) ?? null
            if (!prompt) return null
            if (promptId && prompt.id === promptId) return null
            return prompt.messages?.[0]?.content ?? ''
        },
        [componentPromptsByNameKey, promptId]
    )

    const renderedChatUserInputBlock = useMemo(() => {
        if (isComponentPrompt) return ''
        const lastMessage = (messages ?? EMPTY_MESSAGES)[(messages ?? EMPTY_MESSAGES).length - 1] ?? null
        if (!lastMessage) return ''
        const block = splitPromptBlocks(lastMessage.content ?? '').find(
            (item) => countChatUserInputReferencesInText(item) > 0
        )
        if (!block) return ''

        const rendered = renderPromptTemplateText({
            text: block,
            context: templateContext,
            resolvers: {
                resolveInput: resolveInputValue,
                resolveInclude: resolveIncludeContent,
                resolveInputTermIds,
                resolveInputTermTagTermIds,
                resolveInputSnippets,
                resolveInputFullNovels: (name) => resolveInputContentSelectionItems(name, 'fullNovel'),
                resolveInputActs: (name) => resolveInputContentSelectionItems(name, 'act'),
                resolveInputChapters: (name) => resolveInputContentSelectionItems(name, 'chapter'),
                resolveInputScenes: (name) => resolveInputContentSelectionItems(name, 'scene'),
                resolveInputActOutlines: (name) => resolveInputContentSelectionItems(name, 'actOutline'),
                resolveInputChapterOutlines: (name) => resolveInputContentSelectionItems(name, 'chapterOutline'),
                resolveTermText,
                resolveTermValue,
            },
        })
        return rendered.text.trim()
    }, [
        isComponentPrompt,
        messages,
        resolveIncludeContent,
        resolveInputTermIds,
        resolveInputTermTagTermIds,
        resolveInputSnippets,
        resolveInputContentSelectionItems,
        resolveInputValue,
        resolveTermText,
        resolveTermValue,
        templateContext,
    ])

    const renderedMessages = useMemo(() => {
        if (isComponentPrompt) return [] as Array<{ id: string; role: PromptMessage['role']; content: string }>
        const sourceMessages = messages ?? EMPTY_MESSAGES
        const rendered = renderPromptTemplateMessages({
            texts: sourceMessages.map((message) => message.content ?? ''),
            context: templateContext,
            resolvers: {
                resolveInput: resolveInputValue,
                resolveInclude: resolveIncludeContent,
                resolveInputTermIds,
                resolveInputTermTagTermIds,
                resolveInputSnippets,
                resolveInputFullNovels: (name) => resolveInputContentSelectionItems(name, 'fullNovel'),
                resolveInputActs: (name) => resolveInputContentSelectionItems(name, 'act'),
                resolveInputChapters: (name) => resolveInputContentSelectionItems(name, 'chapter'),
                resolveInputScenes: (name) => resolveInputContentSelectionItems(name, 'scene'),
                resolveInputActOutlines: (name) => resolveInputContentSelectionItems(name, 'actOutline'),
                resolveInputChapterOutlines: (name) => resolveInputContentSelectionItems(name, 'chapterOutline'),
                resolveTermText,
                resolveTermValue,
            },
        })
        return sourceMessages.map((message, index) => ({ id: message.id, role: message.role, content: rendered.texts[index] ?? '' }))
    }, [
        isComponentPrompt,
        messages,
        resolveIncludeContent,
        resolveInputTermIds,
        resolveInputTermTagTermIds,
        resolveInputSnippets,
        resolveInputContentSelectionItems,
        resolveInputValue,
        resolveTermText,
        resolveTermValue,
        templateContext,
    ])

    const renderedWarnings = useMemo(() => {
        if (isComponentPrompt) return [] as PromptTemplateRenderWarning[]
        const rendered = renderPromptTemplateMessages({
            texts: (messages ?? EMPTY_MESSAGES).map((message) => message.content ?? ''),
            context: templateContext,
            resolvers: {
                resolveInput: resolveInputValue,
                resolveInclude: resolveIncludeContent,
                resolveInputTermIds,
                resolveInputTermTagTermIds,
                resolveInputSnippets,
                resolveInputFullNovels: (name) => resolveInputContentSelectionItems(name, 'fullNovel'),
                resolveInputActs: (name) => resolveInputContentSelectionItems(name, 'act'),
                resolveInputChapters: (name) => resolveInputContentSelectionItems(name, 'chapter'),
                resolveInputScenes: (name) => resolveInputContentSelectionItems(name, 'scene'),
                resolveInputActOutlines: (name) => resolveInputContentSelectionItems(name, 'actOutline'),
                resolveInputChapterOutlines: (name) => resolveInputContentSelectionItems(name, 'chapterOutline'),
                resolveTermText,
                resolveTermValue,
            },
        })
        const all = rendered.warnings
        const unique: PromptTemplateRenderWarning[] = []
        const seen = new Set<string>()
        for (const warning of all) {
            const key = `${warning.type}:${warning.name.toLowerCase()}`
            if (seen.has(key)) continue
            seen.add(key)
            unique.push(warning)
        }
        return unique
    }, [
        isComponentPrompt,
        messages,
        resolveIncludeContent,
        resolveInputTermIds,
        resolveInputTermTagTermIds,
        resolveInputSnippets,
        resolveInputContentSelectionItems,
        resolveInputValue,
        resolveTermText,
        resolveTermValue,
        templateContext,
    ])

    const defaultContent = customInput?.custom.defaultContent ?? { dropdownOptionIds: [], text: '' }
    const customAllowMultiple = customInput?.custom.dropdown.allowMultiple ?? true
    const defaultTextPlaceholder = customInput?.custom.text.placeholder.trim() || t('advanced.defaultContent.textPlaceholder')

    const defaultDropdownLabel = useMemo(() => {
        if (!customInput) return t('advanced.preview.noneSelected')
        if (customAllowMultiple) {
            return buildMultiSelectionLabel({ selectedIds: defaultContent.dropdownOptionIds, options: dropdownOptions, t })
        }
        return buildSingleSelectionLabel({
            selectedId: defaultContent.dropdownOptionIds[0] ?? null,
            options: dropdownOptions,
            placeholder: t('advanced.defaultContent.dropdownPlaceholder', {
                name: customInput.name.trim() || t('advanced.inputs.untitled'),
            }),
        })
    }, [customAllowMultiple, customInput, defaultContent.dropdownOptionIds, dropdownOptions, t])

    const defaultContentLayout = useMemo(() => {
        if (!customInput) return 'none' as const
        const dropdownSelectable = customInput.custom.dropdown.enabled && dropdownOptions.length > 0
        const textSelectable = customInput.custom.text.enabled
        if (!dropdownSelectable && !textSelectable) return 'none' as const
        if (dropdownSelectable && textSelectable) {
            return customAllowMultiple ? ('and' as const) : ('or' as const)
        }
        return 'single' as const
    }, [customAllowMultiple, customInput, dropdownOptions.length])

    return {
        acts,
        allowedSettingsOpen,
        allowedSettingsOpenByInputId,
        calledInputNames,
        chapterCountByActNumber,
        chapterTitleSeparator,
        chapters: effectiveChapters,
        checkboxInput,
        checkboxPreviewCheckedByInputId,
        commitInputName,
        contentSelectionInput,
        contentSelectionPreviewStateByInputId,
        customAllowMultiple,
        customInput,
        customPreviewStateByInputId,
        defaultContent,
        defaultContentLayout,
        defaultDropdownLabel,
        defaultTextPlaceholder,
        disabled,
        dropdownDisplay,
        dropdownEnabled,
        dropdownOptions,
        dropdownSettingsOpen,
        editingOption,
        editingOptionId,
        effectiveSelectedInputId,
        ensureLabelsLoaded,
        ensureOutlinesLoaded,
        ensureSnippetsLoaded,
        handleAddInput,
        handleAddMissingInputs,
        handleAddOption,
        handleDefaultDropdownOptionIdsChange,
        handleDefaultTextChange,
        handleDeleteOption,
        handleDeleteSelectedInput,
        handleDragEnd,
        handleNavigateToSelectedInputSource,
        handleReorderInputs,
        handleSetSelectedInputType,
        handleSortOptions,
        handleToggleDropdownAllowed,
        handleToggleTextAllowed,
        handleUpdateContentSelectionPreviewState,
        handleUpdateCustomPreviewState,
        importedInputs,
        includedComponents,
        inputDefinitions: value,
        inputValues,
        invalidIncludes,
        isComponentPrompt,
        isInputNameDuplicate,
        inputTypeStashRef,
        labelPickerById,
        labelPickerError,
        labelPickerItems,
        labelPickerLabels,
        labelPickerLoading,
        labelPickerQuery,
        messages,
        missingInputNames,
        missingRequiredInputNames,
        novelLanguage: effectiveNovelLanguage,
        novelId,
        onChange,
        onInputDefinitionsChange: onChange,
        navigateToPromptAdvanced,
        outlinePickerError,
        outlinePickerItems,
        outlinePickerLoading,
        outlinePickerOutlines,
        outlinePickerQuery,
        previewSceneId,
        previewSceneOptions,
        setPreviewSceneId,
        previewInputs,
        renderedMessages,
        renderedWarnings,
        renderedChatUserInputBlock,
        selectInput,
        selectedInput,
        selectedInputId,
        selectedInputReadOnly,
        selectedInputSourcePrompt,
        sensors,
        setAllowedSettingsOpenByInputId,
        setCheckboxPreviewCheckedByInputId,
        setContentSelectionPreviewStateByInputId,
        setCustomPreviewStateByInputId,
        setEditingOptionId,
        setLabelPickerError,
        setLabelPickerLabels,
        setLabelPickerLoading,
        setLabelPickerQuery,
        setOutlinePickerError,
        setOutlinePickerLoading,
        setOutlinePickerOutlines,
        setOutlinePickerQuery,
        setSelectedInputId,
        setSnippetPickerError,
        setSnippetPickerLoading,
        setSnippetPickerQuery,
        setSnippetPickerSnippets,
        setTermTagPickerQuery,
        setTermPickerCategory,
        setTermPickerQuery,
        snippetPickerError,
        snippetPickerItems,
        snippetPickerLoading,
        snippetPickerQuery,
        snippetPickerSnippets,
        sortedActs,
        sortedChapters,
        t,
        termTagPickerItems,
        termTagPickerQuery,
        termEntries,
        termEntriesById,
        termPickerCategory,
        termPickerItems,
        termPickerQuery,
        textEnabled,
        textSettingsOpen,
        tTerms,
        templateContext,
        updateAllowedSettingsOpen,
        updateOption,
        updateSelectedInput,
        usedInputIds,
        value,
        canNavigateToSelectedInputSource,
    }
}

export type InputsEditorModel = ReturnType<typeof useInputsEditorModel>
