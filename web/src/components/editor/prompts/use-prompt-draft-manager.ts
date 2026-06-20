'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModelGroup, ModelSet } from '@/lib/ai-store'
import type { PromptInputDefinition } from '@/lib/prompt-inputs'
import { promptApi, type Prompt } from '@/lib/api'
import type { PromptCategory, PromptMessage } from '@/lib/prompts'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import {
    attachModelGroupSelection,
    attachModelSetSelection,
    buildModelSetGroupIdsById,
    detachModelGroupSelection,
    detachModelSetSelection,
    getLlmBindableModelSetIds,
    setPrimaryModelGroupSelection,
} from '@/lib/model-bindings'

import {
    HISTORY_CATEGORIES,
    coerceCategory,
    createLocalId,
    getNextRole,
    normalizeEditorTabForCategory,
    type PromptDraft,
    type PromptEditorTab,
    type PromptTranslateFn,
} from '@/components/editor/prompts/middle-panel-prompts-shared'

function toPromptNameKey(name: string) {
    return name.trim().toLocaleLowerCase()
}

export function usePromptDraftManager(params: {
    prompts: Prompt[]
    modelGroups: ModelGroup[]
    modelSets: ModelSet[]
    selectedPromptId: string | null
    setPrompts: React.Dispatch<React.SetStateAction<Prompt[]>>
    setError: React.Dispatch<React.SetStateAction<string | null>>
    setActiveCategory: React.Dispatch<React.SetStateAction<PromptCategory>>
    setEditorTab: React.Dispatch<React.SetStateAction<PromptEditorTab>>
    onPromptChanged: () => void
    readOnly: boolean
    t: PromptTranslateFn
}) {
    const { prompts, modelGroups, modelSets, selectedPromptId, setPrompts, setError, setActiveCategory, setEditorTab, onPromptChanged, readOnly, t } = params

    const [draft, setDraft] = useState<PromptDraft | null>(null)
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [isEditingName, setIsEditingName] = useState(false)

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastSavedRef = useRef<{
        id: string
        name: string
        description: string | null
        category: string
        messagesJson: string
        inputsJson: string
        modelGroupIdsJson: string
        modelSetIdsJson: string
        allowLlmCall: boolean
        allowAgentCall: boolean
        agentCallMode: Prompt['agentCallMode']
        isNsfw: boolean
    } | null>(null)
    const latestDraftRef = useRef<PromptDraft | null>(null)
    const saveRequestIdRef = useRef(0)
    const allowedGroupIds = useMemo(
        () => new Set(modelGroups.map((group) => group.id)),
        [modelGroups]
    )
    const modelSetGroupIdsById = useMemo(
        () => buildModelSetGroupIdsById(modelSets, allowedGroupIds),
        [allowedGroupIds, modelSets]
    )
    const allowedSetIds = useMemo(
        () => getLlmBindableModelSetIds(modelSets, allowedGroupIds),
        [allowedGroupIds, modelSets]
    )

    const restorePromptName = useCallback((promptId: string, name: string) => {
        setDraft((prev) => (prev && prev.id === promptId ? { ...prev, name } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === promptId ? { ...prompt, name } : prompt)))
    }, [setPrompts])

    const getPromptNameError = useCallback((promptDraft: PromptDraft) => {
        const name = promptDraft.name.trim()
        if (!name) return t('errors.nameCannotBeEmpty')

        const nameKey = toPromptNameKey(name)
        const duplicate = prompts.some((prompt) => prompt.id !== promptDraft.id && toPromptNameKey(prompt.name) === nameKey)
        return duplicate ? t('errors.nameAlreadyExists') : null
    }, [prompts, t])

    useEffect(() => {
        if (!selectedPromptId) {
            startTransition(() => {
                setDraft(null)
                setSaveState('idle')
                setIsEditingName(false)
            })
            lastSavedRef.current = null
            return
        }
        if (draft?.id === selectedPromptId) return

        const prompt = prompts.find((item) => item.id === selectedPromptId)
        if (!prompt) return

        startTransition(() => {
            setDraft({
                id: prompt.id,
                name: prompt.name,
                category: prompt.category,
                description: prompt.description,
                messages: prompt.messages,
                inputs: prompt.inputs ?? [],
                modelGroupIds: Array.isArray(prompt.modelGroupIds) ? prompt.modelGroupIds : [],
                modelSetIds: Array.isArray(prompt.modelSetIds) ? prompt.modelSetIds : [],
                allowLlmCall: prompt.allowLlmCall === true,
                allowAgentCall: prompt.allowAgentCall === true,
                agentCallMode: prompt.agentCallMode ?? 'generate_then_agent',
                history: prompt.history ?? [],
                isNsfw: prompt.isNsfw === true,
            })
            setSaveState('idle')
            setIsEditingName(false)
        })
        lastSavedRef.current = {
            id: prompt.id,
            name: prompt.name,
            description: prompt.description,
            category: String(prompt.category),
            messagesJson: JSON.stringify(prompt.messages),
            inputsJson: JSON.stringify(prompt.inputs ?? []),
            modelGroupIdsJson: JSON.stringify(prompt.modelGroupIds ?? []),
            modelSetIdsJson: JSON.stringify(prompt.modelSetIds ?? []),
            allowLlmCall: prompt.allowLlmCall === true,
            allowAgentCall: prompt.allowAgentCall === true,
            agentCallMode: prompt.agentCallMode ?? 'generate_then_agent',
            isNsfw: prompt.isNsfw === true,
        }

        const category = coerceCategory(String(prompt.category))
        if (category) setActiveCategory(category)
        setEditorTab((prev) => normalizeEditorTabForCategory(prev, category))
    }, [draft?.id, prompts, selectedPromptId, setActiveCategory, setEditorTab])

    useEffect(() => {
        latestDraftRef.current = draft
    }, [draft])

    useEffect(() => {
        if (!draft) return
        // Prompts cloned from an official preset are read-only outside authoring mode: never autosave.
        // The server (PUT /prompts/[id]) enforces the same rule, so this is purely to avoid no-op churn.
        if (readOnly) return
        const lastSaved = lastSavedRef.current
        if (!lastSaved || lastSaved.id !== draft.id) return

        const messagesJson = JSON.stringify(draft.messages)
        const inputsJson = JSON.stringify(draft.inputs ?? [])
        const modelGroupIdsJson = JSON.stringify(draft.modelGroupIds ?? [])
        const modelSetIdsJson = JSON.stringify(draft.modelSetIds ?? [])
        const nameChanged = draft.name !== lastSaved.name
        const isDirty =
            nameChanged ||
            (draft.description ?? null) !== (lastSaved.description ?? null) ||
            String(draft.category) !== lastSaved.category ||
            messagesJson !== lastSaved.messagesJson ||
            inputsJson !== lastSaved.inputsJson ||
            modelGroupIdsJson !== lastSaved.modelGroupIdsJson ||
            modelSetIdsJson !== lastSaved.modelSetIdsJson ||
            (draft.allowLlmCall === true) !== lastSaved.allowLlmCall ||
            (draft.allowAgentCall === true) !== lastSaved.allowAgentCall ||
            (draft.agentCallMode ?? 'generate_then_agent') !== lastSaved.agentCallMode ||
            (draft.isNsfw === true) !== lastSaved.isNsfw

        if (!isDirty) return

        if (isEditingName && nameChanged) return

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

        const promptNameError = getPromptNameError(draft)
        if (promptNameError) {
            setError(promptNameError)
            startTransition(() => {
                setSaveState('error')
                restorePromptName(draft.id, lastSaved.name)
            })
            return
        }

        const snapshot = {
            id: draft.id,
            name: draft.name,
            description: draft.description ?? null,
            category: String(draft.category),
            messages: draft.messages,
            messagesJson,
            inputs: draft.inputs ?? [],
            inputsJson,
            modelGroupIds: draft.modelGroupIds ?? [],
            modelGroupIdsJson,
            modelSetIds: draft.modelSetIds ?? [],
            modelSetIdsJson,
            allowLlmCall: draft.allowLlmCall === true,
            allowAgentCall: draft.allowAgentCall === true,
            agentCallMode: draft.agentCallMode ?? 'generate_then_agent',
            isNsfw: draft.isNsfw === true,
        }

        saveTimerRef.current = setTimeout(async () => {
            const requestId = ++saveRequestIdRef.current
            setSaveState('saving')
            try {
                const { prompt } = await promptApi.update(snapshot.id, {
                    name: snapshot.name,
                    description: snapshot.description,
                    category: snapshot.category as PromptCategory,
                    messages: snapshot.messages,
                    inputs: snapshot.inputs,
                    isNsfw: snapshot.isNsfw,
                    modelGroupIds: snapshot.modelGroupIds,
                    modelSetIds: snapshot.modelSetIds,
                    allowLlmCall: snapshot.allowLlmCall,
                    allowAgentCall: snapshot.allowAgentCall,
                    agentCallMode: snapshot.agentCallMode,
                })

                const current = latestDraftRef.current
                const currentMessagesJson = current ? JSON.stringify(current.messages) : ''
                const currentInputsJson = current ? JSON.stringify(current.inputs ?? []) : ''
                const currentModelGroupIdsJson = current ? JSON.stringify(current.modelGroupIds ?? []) : ''
                const currentModelSetIdsJson = current ? JSON.stringify(current.modelSetIds ?? []) : ''
                const isStillCurrent =
                    current?.id === snapshot.id &&
                    current.name === snapshot.name &&
                    (current.description ?? null) === (snapshot.description ?? null) &&
                    String(current.category) === snapshot.category &&
                    currentMessagesJson === snapshot.messagesJson &&
                    currentInputsJson === snapshot.inputsJson &&
                    currentModelGroupIdsJson === snapshot.modelGroupIdsJson &&
                    currentModelSetIdsJson === snapshot.modelSetIdsJson &&
                    (current.allowLlmCall === true) === snapshot.allowLlmCall &&
                    (current.allowAgentCall === true) === snapshot.allowAgentCall &&
                    (current.agentCallMode ?? 'generate_then_agent') === snapshot.agentCallMode &&
                    (current.isNsfw === true) === snapshot.isNsfw

                if (!isStillCurrent) {
                    if (requestId === saveRequestIdRef.current) setSaveState('idle')
                    return
                }
                if (requestId !== saveRequestIdRef.current) return

                setPrompts((prev) => prev.map((item) => (item.id === prompt.id ? prompt : item)))
                setDraft((prev) => (
                    prev && prev.id === prompt.id
                        ? {
                            ...prev,
                            name: prompt.name,
                            category: prompt.category,
                            description: prompt.description,
                            messages: prompt.messages,
                            inputs: prompt.inputs ?? [],
                            modelGroupIds: Array.isArray(prompt.modelGroupIds) ? prompt.modelGroupIds : [],
                            modelSetIds: Array.isArray(prompt.modelSetIds) ? prompt.modelSetIds : [],
                            allowLlmCall: prompt.allowLlmCall === true,
                            allowAgentCall: prompt.allowAgentCall === true,
                            agentCallMode: prompt.agentCallMode ?? 'generate_then_agent',
                            history: prompt.history ?? [],
                            isNsfw: prompt.isNsfw === true,
                        }
                        : prev
                ))
                lastSavedRef.current = {
                    id: prompt.id,
                    name: prompt.name,
                    description: prompt.description,
                    category: String(prompt.category),
                    messagesJson: JSON.stringify(prompt.messages),
                    inputsJson: JSON.stringify(prompt.inputs ?? []),
                    modelGroupIdsJson: JSON.stringify(prompt.modelGroupIds ?? []),
                    modelSetIdsJson: JSON.stringify(prompt.modelSetIds ?? []),
                    allowLlmCall: prompt.allowLlmCall === true,
                    allowAgentCall: prompt.allowAgentCall === true,
                    agentCallMode: prompt.agentCallMode ?? 'generate_then_agent',
                    isNsfw: prompt.isNsfw === true,
                }
                setError(null)
                onPromptChanged()
                setSaveState('saved')
                window.setTimeout(() => setSaveState('idle'), 900)
            } catch (error) {
                console.error(error)
                if (requestId !== saveRequestIdRef.current) return
                const savedName = lastSavedRef.current?.id === snapshot.id ? lastSavedRef.current.name : snapshot.name
                const current = latestDraftRef.current
                const currentMessagesJson = current ? JSON.stringify(current.messages) : ''
                const currentInputsJson = current ? JSON.stringify(current.inputs ?? []) : ''
                const currentModelGroupIdsJson = current ? JSON.stringify(current.modelGroupIds ?? []) : ''
                const currentModelSetIdsJson = current ? JSON.stringify(current.modelSetIds ?? []) : ''
                const isStillCurrent =
                    current?.id === snapshot.id &&
                    current.name === snapshot.name &&
                    (current.description ?? null) === (snapshot.description ?? null) &&
                    String(current.category) === snapshot.category &&
                    currentMessagesJson === snapshot.messagesJson &&
                    currentInputsJson === snapshot.inputsJson &&
                    currentModelGroupIdsJson === snapshot.modelGroupIdsJson &&
                    currentModelSetIdsJson === snapshot.modelSetIdsJson &&
                    (current.allowLlmCall === true) === snapshot.allowLlmCall &&
                    (current.allowAgentCall === true) === snapshot.allowAgentCall &&
                    (current.agentCallMode ?? 'generate_then_agent') === snapshot.agentCallMode &&
                    (current.isNsfw === true) === snapshot.isNsfw

                if (!isStillCurrent) {
                    setSaveState('idle')
                    return
                }
                setSaveState('error')
                const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : null
                if (status === 409) {
                    restorePromptName(snapshot.id, savedName)
                    setError(t('errors.nameAlreadyExists'))
                } else if (status === 400 && !snapshot.name.trim()) {
                    restorePromptName(snapshot.id, savedName)
                    setError(t('errors.nameCannotBeEmpty'))
                }
            }
        }, nameChanged ? 0 : 650)

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        }
    }, [draft, getPromptNameError, isEditingName, onPromptChanged, readOnly, restorePromptName, setError, setPrompts, t])

    const handleUpdateDraftName = useCallback((value: string) => {
        setError(null)
        setDraft((prev) => (prev ? { ...prev, name: value } : prev))
        if (!value.trim()) return
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, name: value } : prompt)))
    }, [selectedPromptId, setError, setPrompts])

    const handleStartDraftNameEditing = useCallback(() => {
        setError(null)
        setIsEditingName(true)
    }, [setError])

    const handleEndDraftNameEditing = useCallback(() => {
        setIsEditingName(false)
    }, [])

    const handleUpdateDraftDescription = useCallback((value: string) => {
        setDraft((prev) => (prev ? { ...prev, description: value } : prev))
    }, [])

    const handleUpdateDraftCategory = useCallback((category: PromptCategory) => {
        if (category === 'default' || category === 'component') return
        setError(null)
        setDraft((prev) => (prev ? { ...prev, category } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, category } : prompt)))
        setActiveCategory(category)
    }, [selectedPromptId, setActiveCategory, setError, setPrompts])

    const handleUpdateDraftNsfw = useCallback((isNsfw: boolean) => {
        setDraft((prev) => (prev ? { ...prev, isNsfw } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, isNsfw } : prompt)))
    }, [selectedPromptId, setPrompts])

    const handleUpdateDraftAllowLlmCall = useCallback((allowLlmCall: boolean) => {
        setDraft((prev) => (prev ? { ...prev, allowLlmCall } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, allowLlmCall } : prompt)))
    }, [selectedPromptId, setPrompts])

    const handleUpdateDraftAllowAgentCall = useCallback((allowAgentCall: boolean) => {
        setDraft((prev) => (prev ? { ...prev, allowAgentCall } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, allowAgentCall } : prompt)))
    }, [selectedPromptId, setPrompts])

    const handleUpdateDraftAgentCallMode = useCallback((agentCallMode: Prompt['agentCallMode']) => {
        setDraft((prev) => (prev ? { ...prev, agentCallMode } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, agentCallMode } : prompt)))
    }, [selectedPromptId, setPrompts])

    const handleUpdateDraftInputs = useCallback((inputs: PromptInputDefinition[]) => {
        setDraft((prev) => (prev ? { ...prev, inputs } : prev))
        setPrompts((prev) => prev.map((prompt) => (prompt.id === selectedPromptId ? { ...prompt, inputs } : prompt)))
    }, [selectedPromptId, setPrompts])

    const handleAttachModelGroup = useCallback((groupId: string) => {
        const normalizedGroupId = groupId.trim()
        if (!normalizedGroupId) return

        setDraft((prev) => {
            if (!prev) return prev
            const next = attachModelGroupSelection({
                selection: prev,
                groupId: normalizedGroupId,
                modelSets,
                modelSetGroupIdsById,
                allowedGroupIds,
                allowedSetIds,
            })
            if (!next.changed) return prev
            return { ...prev, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        })
        setPrompts((prev) => prev.map((prompt) => {
            if (prompt.id !== selectedPromptId) return prompt
            const next = attachModelGroupSelection({
                selection: prompt,
                groupId: normalizedGroupId,
                modelSets,
                modelSetGroupIdsById,
                allowedGroupIds,
                allowedSetIds,
            })
            if (!next.changed) return prompt
            return { ...prompt, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        }))
    }, [allowedGroupIds, allowedSetIds, modelSetGroupIdsById, modelSets, selectedPromptId, setPrompts])

    const handleAttachModelSet = useCallback((setId: string) => {
        const normalizedSetId = setId.trim()
        if (!normalizedSetId) return

        setDraft((prev) => {
            if (!prev) return prev
            const next = attachModelSetSelection({
                selection: prev,
                setId: normalizedSetId,
                modelSetGroupIdsById,
                allowedGroupIds,
                allowedSetIds,
            })
            if (!next.changed) return prev
            return { ...prev, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        })
        setPrompts((prev) => prev.map((prompt) => {
            if (prompt.id !== selectedPromptId) return prompt
            const next = attachModelSetSelection({
                selection: prompt,
                setId: normalizedSetId,
                modelSetGroupIdsById,
                allowedGroupIds,
                allowedSetIds,
            })
            if (!next.changed) return prompt
            return { ...prompt, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        }))
    }, [allowedGroupIds, allowedSetIds, modelSetGroupIdsById, selectedPromptId, setPrompts])

    const handleDetachModelSet = useCallback((setId: string) => {
        const normalizedSetId = setId.trim()
        if (!normalizedSetId) return

        setDraft((prev) => {
            if (!prev) return prev
            const next = detachModelSetSelection({
                selection: prev,
                setId: normalizedSetId,
                modelSetGroupIdsById,
            })
            if (!next.changed) return prev
            return { ...prev, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        })
        setPrompts((prev) => prev.map((prompt) => {
            if (prompt.id !== selectedPromptId) return prompt
            const next = detachModelSetSelection({
                selection: prompt,
                setId: normalizedSetId,
                modelSetGroupIdsById,
            })
            if (!next.changed) return prompt
            return { ...prompt, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        }))
    }, [modelSetGroupIdsById, selectedPromptId, setPrompts])

    const handleDetachModelGroup = useCallback((groupId: string) => {
        const normalizedGroupId = groupId.trim()
        if (!normalizedGroupId) return

        setDraft((prev) => (
            prev
                ? (() => {
                    const next = detachModelGroupSelection({
                        selection: prev,
                        groupId: normalizedGroupId,
                        modelSetGroupIdsById,
                    })
                    if (!next.changed) return prev
                    return { ...prev, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
                })()
                : prev
        ))
        setPrompts((prev) => prev.map((prompt) => (
            prompt.id === selectedPromptId
                ? (() => {
                    const next = detachModelGroupSelection({
                        selection: prompt,
                        groupId: normalizedGroupId,
                        modelSetGroupIdsById,
                    })
                    if (!next.changed) return prompt
                    return { ...prompt, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
                })()
                : prompt
        )))
    }, [modelSetGroupIdsById, selectedPromptId, setPrompts])

    const handleSetPrimaryModelGroup = useCallback((groupId: string) => {
        const normalizedGroupId = groupId.trim()
        if (!normalizedGroupId) return

        setDraft((prev) => {
            if (!prev) return prev
            const next = setPrimaryModelGroupSelection({
                selection: prev,
                groupId: normalizedGroupId,
            })
            if (!next.changed) return prev
            return { ...prev, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        })
        setPrompts((prev) => prev.map((prompt) => {
            if (prompt.id !== selectedPromptId) return prompt
            const next = setPrimaryModelGroupSelection({
                selection: prompt,
                groupId: normalizedGroupId,
            })
            if (!next.changed) return prompt
            return { ...prompt, modelGroupIds: next.modelGroupIds, modelSetIds: next.modelSetIds }
        }))
    }, [selectedPromptId, setPrompts])

    const isComponent = coerceCategory(String(draft?.category ?? '')) === 'component'

    const systemMessage = useMemo(() => {
        if (!draft || isComponent) return null
        const first = draft.messages[0] ?? null
        if (!first || first.role !== 'system') {
            return { id: `${draft.id}-system`, role: 'system' as const, content: '' }
        }
        return first
    }, [draft, isComponent])

    const additionalMessages = useMemo(() => {
        if (!draft || isComponent) return []
        return draft.messages.slice(1)
    }, [draft, isComponent])

    const historyEnabled = useMemo(() => {
        const category = coerceCategory(String(draft?.category ?? ''))
        if (!category) return false
        return HISTORY_CATEGORIES.includes(category)
    }, [draft?.category])

    const historyCurrentValue = useMemo(() => {
        if (!draft) return ''
        if (isComponent) return draft.messages[0]?.content ?? ''
        return systemMessage?.content ?? ''
    }, [draft, isComponent, systemMessage])

    const handleUpdateSystemMessage = useCallback((content: string) => {
        setDraft((prev) => {
            if (!prev) return prev
            const messages = prev.messages.length > 0 ? [...prev.messages] : []
            if (messages.length === 0 || messages[0].role !== 'system') {
                messages.unshift({ id: `${prev.id}-system`, role: 'system', content })
            } else {
                messages[0] = { ...messages[0], content }
            }
            return { ...prev, messages }
        })
    }, [])

    const handleUpdateComponentMessage = useCallback((content: string) => {
        setDraft((prev) => {
            if (!prev) return prev
            if (coerceCategory(String(prev.category)) !== 'component') return prev
            const existing = prev.messages[0]
            const next: PromptMessage = {
                id: existing?.id ?? `${prev.id}-message`,
                role: existing?.role === 'user' || existing?.role === 'assistant' ? existing.role : 'assistant',
                content,
            }
            return { ...prev, messages: [next] }
        })
    }, [])

    const handleAddMessage = useCallback(() => {
        setDraft((prev) => {
            if (!prev) return prev
            if (coerceCategory(String(prev.category)) === 'component') return prev
            const nextRole = getNextRole(prev.messages)
            const next: PromptMessage = { id: createLocalId(), role: nextRole, content: '' }
            return { ...prev, messages: [...prev.messages, next] }
        })
    }, [])

    const handleUpdateAdditionalMessage = useCallback((messageId: string, updates: Partial<Pick<PromptMessage, 'role' | 'content'>>) => {
        setDraft((prev) => {
            if (!prev) return prev
            const index = prev.messages.findIndex((message) => message.id === messageId)
            if (index < 0) return prev
            if (index === 0 && prev.messages[0]?.role === 'system') return prev
            const next = [...prev.messages]
            next[index] = { ...next[index], ...updates }
            return { ...prev, messages: next }
        })
    }, [])

    const handleDeleteAdditionalMessage = useCallback((messageId: string) => {
        setDraft((prev) => {
            if (!prev) return prev
            const index = prev.messages.findIndex((message) => message.id === messageId)
            if (index < 0) return prev
            if (index === 0 && prev.messages[0]?.role === 'system') return prev
            if (coerceCategory(String(prev.category)) === 'component' && prev.messages.length <= 1) return prev
            return { ...prev, messages: prev.messages.filter((message) => message.id !== messageId) }
        })
    }, [])

    const handleCopyMessage = useCallback(async (messageId: string) => {
        if (!draft) return
        const message = draft.messages.find((item) => item.id === messageId)
        if (!message) return
        try {
            await navigator.clipboard.writeText(message.content ?? '')
        } catch (error) {
            console.error(error)
        }
    }, [draft])

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        if (!draft || isComponent) return
        const { active, over } = event
        if (!over || active.id === over.id) return

        const oldIndex = additionalMessages.findIndex((message) => message.id === active.id)
        const newIndex = additionalMessages.findIndex((message) => message.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return

        const reordered = arrayMove(additionalMessages, oldIndex, newIndex)
        setDraft((prev) => {
            if (!prev) return prev
            const first = prev.messages[0]
            return { ...prev, messages: [first, ...reordered] }
        })
    }, [additionalMessages, draft, isComponent])

    return {
        draft,
        setDraft,
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
    }
}
