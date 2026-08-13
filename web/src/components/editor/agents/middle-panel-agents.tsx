'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bot, Check, MoreVertical, Plus, Search } from 'lucide-react'

import {
    agentApi,
    agentPresetApi,
    ApiError,
    type Agent,
    type BuiltinAgentPreset,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { AgentPresetLibrarySection } from '@/components/editor/agents/agent-preset-library-section'
import { AgentPresetPublishDialog } from '@/components/editor/agents/agent-preset-publish-dialog'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type MiddlePanelAgentsProps = {
    novelId?: string
}

type SavedDraftSnapshot = {
    id: string
    name: string
    content: string
}

function sortAgents(list: Agent[]) {
    return [...list].sort(
        (left, right) =>
            Number(right.enabled) - Number(left.enabled)
            || right.updatedAt.localeCompare(left.updatedAt)
            || left.name.localeCompare(right.name)
    )
}

function getAgentPreview(content: string) {
    const line = content
        .split('\n')
        .map((item) => item.trim())
        .find(Boolean)

    if (!line) return ''
    return line.replace(/^#+\s*/, '')
}

export function MiddlePanelAgents({ novelId }: MiddlePanelAgentsProps) {
    const t = useTranslations('agents')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [agents, setAgents] = useState<Agent[]>([])
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [draftName, setDraftName] = useState('')
    const [draftContent, setDraftContent] = useState('')
    const [saveState, setSaveState] = useState<SaveState>('idle')

    const [builtinPresets, setBuiltinPresets] = useState<BuiltinAgentPreset[]>([])
    const [builtinPresetsLoading, setBuiltinPresetsLoading] = useState(true)
    const [builtinPresetsError, setBuiltinPresetsError] = useState<string | null>(null)
    const [presetAuthoringEnabled, setPresetAuthoringEnabled] = useState(false)
    const [cloningPresetId, setCloningPresetId] = useState<string | null>(null)
    const [cloningAllPresets, setCloningAllPresets] = useState(false)
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

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastSavedRef = useRef<SavedDraftSnapshot | null>(null)
    const latestDraftRef = useRef({ name: '', content: '' })
    const saveRequestIdRef = useRef(0)
    const hasRestoredViewStateRef = useRef(false)
    const hasInitializedPersistenceRef = useRef(false)

    const storageKey = useMemo(() => `editor_agent_view_state_${novelId ?? 'global'}`, [novelId])

    const loadAgents = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const { agents: list } = await agentApi.list()
            const sorted = sortAgents(list)
            setAgents(sorted)
            setSelectedAgentId((prevSelected) => {
                if (prevSelected && sorted.some((agent) => agent.id === prevSelected)) return prevSelected
                return sorted[0]?.id ?? null
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : t('errors.loadFailed')
            setError(message)
        } finally {
            setLoading(false)
        }
    }, [t])

    useEffect(() => {
        void loadAgents()
    }, [loadAgents])

    const loadBuiltinPresets = useCallback(async () => {
        setBuiltinPresetsLoading(true)
        setBuiltinPresetsError(null)
        try {
            const { authoringEnabled, presets } = await agentPresetApi.list()
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
        if (typeof window === 'undefined') return
        if (hasRestoredViewStateRef.current) return

        const raw = window.localStorage.getItem(storageKey)
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as { selectedAgentId?: string | null }
                if (typeof parsed.selectedAgentId === 'string' && parsed.selectedAgentId.trim()) {
                    setSelectedAgentId(parsed.selectedAgentId)
                }
            } catch {
                // Ignore invalid local state.
            }
        }

        hasRestoredViewStateRef.current = true
    }, [storageKey])

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (!hasRestoredViewStateRef.current) return
        if (!hasInitializedPersistenceRef.current) {
            hasInitializedPersistenceRef.current = true
            return
        }

        window.localStorage.setItem(
            storageKey,
            JSON.stringify({
                selectedAgentId,
            })
        )
    }, [selectedAgentId, storageKey])

    const selectedAgent = useMemo(
        () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
        [agents, selectedAgentId]
    )
    const editorReadOnly = useMemo(
        () => Boolean(selectedAgent?.sourcePresetId) && !presetAuthoringEnabled,
        [presetAuthoringEnabled, selectedAgent?.sourcePresetId]
    )
    const agentPresetUpdate = useMemo(() => {
        const sourceId = selectedAgent?.sourcePresetId ?? null
        const clonedRevision = selectedAgent?.sourcePresetRevision ?? null
        if (!sourceId) return { sourceId: null as string | null, clonedRevision: null as number | null, updateAvailable: false }
        const current = builtinPresets.find((preset) => preset.presetId === sourceId) ?? null
        const updateAvailable = current != null && clonedRevision != null && current.revision > clonedRevision
        return { sourceId, clonedRevision, updateAvailable }
    }, [builtinPresets, selectedAgent?.sourcePresetId, selectedAgent?.sourcePresetRevision])

    useEffect(() => {
        if (!selectedAgent) {
            setDraftName('')
            setDraftContent('')
            setSaveState('idle')
            lastSavedRef.current = null
            return
        }

        setDraftName(selectedAgent.name)
        setDraftContent(selectedAgent.content)
        latestDraftRef.current = {
            name: selectedAgent.name,
            content: selectedAgent.content,
        }
        lastSavedRef.current = {
            id: selectedAgent.id,
            name: selectedAgent.name,
            content: selectedAgent.content,
        }
        setSaveState('idle')
    }, [selectedAgent])

    useEffect(() => {
        latestDraftRef.current = {
            name: draftName,
            content: draftContent,
        }
    }, [draftContent, draftName])

    useEffect(() => {
        if (!selectedAgent) return
        if (editorReadOnly) return

        const lastSaved = lastSavedRef.current
        if (!lastSaved || lastSaved.id !== selectedAgent.id) return
        if (draftName === lastSaved.name && draftContent === lastSaved.content) return

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

        saveTimerRef.current = setTimeout(async () => {
            const requestId = ++saveRequestIdRef.current
            const previousAgentId = selectedAgent.id
            const pendingName = draftName
            const pendingContent = draftContent
            setSaveState('saving')

            try {
                const { agent } = await agentApi.update(previousAgentId, {
                    name: pendingName,
                    content: pendingContent,
                })

                if (requestId !== saveRequestIdRef.current) return
                if (
                    latestDraftRef.current.name !== pendingName
                    || latestDraftRef.current.content !== pendingContent
                ) {
                    return
                }

                setAgents((prev) => sortAgents(prev.map((item) => (item.id === previousAgentId ? agent : item))))
                setSelectedAgentId((prev) => (prev === previousAgentId ? agent.id : prev))
                setDraftName(agent.name)
                setDraftContent(agent.content)
                latestDraftRef.current = { name: agent.name, content: agent.content }
                lastSavedRef.current = {
                    id: agent.id,
                    name: agent.name,
                    content: agent.content,
                }
                setError(null)
                setSaveState('saved')
                window.setTimeout(() => {
                    if (saveRequestIdRef.current === requestId) setSaveState('idle')
                }, 900)
            } catch (err) {
                console.error(err)
                if (requestId !== saveRequestIdRef.current) return
                setSaveState('error')
                const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : null
                if (status === 409) {
                    setError(t('errors.nameAlreadyExists'))
                } else if (status === 400) {
                    setError(t('errors.nameCannotBeEmpty'))
                } else {
                    setError(err instanceof Error ? err.message : t('errors.saveFailed'))
                }
            }
        }, 650)

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        }
    }, [draftContent, draftName, editorReadOnly, selectedAgent, t])

    const filteredAgents = useMemo(() => {
        const normalized = searchQuery.trim().toLowerCase()
        if (!normalized) return agents

        return agents.filter((agent) => {
            const name = agent.name.toLowerCase()
            const content = agent.content.toLowerCase()
            return name.includes(normalized) || content.includes(normalized)
        })
    }, [agents, searchQuery])

    const handleCreate = useCallback(async () => {
        try {
            setError(null)
            const { agent } = await agentApi.create({ name: t('actions.newAgentName') })
            setAgents((prev) => sortAgents([agent, ...prev]))
            setSelectedAgentId(agent.id)
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.createFailed')}: ${detail}` : t('errors.createFailed'))
        }
    }, [t])

    const handleEnable = useCallback(async (agent: Agent) => {
        if (agent.enabled) return

        try {
            setError(null)
            const { agent: updated } = await agentApi.update(agent.id, { enabled: true })
            setAgents((prev) =>
                sortAgents(
                    prev.map((item) => {
                        if (item.id === updated.id) return updated
                        return item.enabled ? { ...item, enabled: false } : item
                    })
                )
            )
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : t('errors.enableFailed'))
        }
    }, [t])

    const handleDelete = useCallback(async () => {
        if (!selectedAgent) return

        try {
            setError(null)
            await agentApi.delete(selectedAgent.id)
            const remaining = agents.filter((agent) => agent.id !== selectedAgent.id)
            const sorted = sortAgents(remaining)
            setAgents(sorted)
            setSelectedAgentId((prevSelected) => (prevSelected === selectedAgent.id ? sorted[0]?.id ?? null : prevSelected))
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.deleteFailed')}: ${detail}` : t('errors.deleteFailed'))
        }
    }, [agents, selectedAgent, t])

    const handleCloneAgent = useCallback(async () => {
        if (!selectedAgent) return
        try {
            setError(null)
            const { agent } = await agentApi.clone(selectedAgent.id)
            setAgents((prev) => sortAgents([agent, ...prev]))
            setSelectedAgentId(agent.id)
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.cloneFailed')}: ${detail}` : t('errors.cloneFailed'))
        }
    }, [selectedAgent, t])

    const handleClonePreset = useCallback(async (presetId: string, overwriteExisting = false) => {
        setCloningPresetId(presetId)
        setBuiltinPresetsError(null)
        try {
            const { agents: importedAgents } = await agentPresetApi.clone(presetId, { overwriteExisting })
            const importedIds = new Set(importedAgents.map((agent) => agent.id))
            setAgents((prev) => sortAgents([...importedAgents, ...prev.filter((agent) => !importedIds.has(agent.id))]))

            const preset = builtinPresets.find((item) => item.presetId === presetId) ?? null
            const entryKey = (preset?.name ?? importedAgents[0]?.name ?? '').trim().toLowerCase()
            const entryAgent = importedAgents.find((agent) => agent.name.trim().toLowerCase() === entryKey) ?? importedAgents[0] ?? null
            if (entryAgent) setSelectedAgentId(entryAgent.id)

            setCloneOverwriteConfirmOpen(false)
            setCloneOverwritePresetId(null)
            setCloneConflictNames([])
        } catch (err) {
            if (err instanceof ApiError) {
                const data = err.data as { code?: unknown; names?: unknown } | undefined
                const names = Array.isArray(data?.names)
                    ? data.names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
                    : []

                if (err.status === 409 && data?.code === 'AGENT_NAME_ALREADY_EXISTS' && names.length > 0 && !overwriteExisting) {
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
    }, [builtinPresets, t])

    const handleConfirmCloneOverwrite = useCallback(async () => {
        if (!cloneOverwritePresetId) return
        await handleClonePreset(cloneOverwritePresetId, true)
    }, [cloneOverwritePresetId, handleClonePreset])

    const handleCloneAllPresets = useCallback(async () => {
        setCloningAllPresets(true)
        setBuiltinPresetsError(null)
        try {
            const allImported: Agent[] = []
            for (const preset of builtinPresets) {
                const { agents: importedAgents } = await agentPresetApi.clone(preset.presetId, { overwriteExisting: true })
                allImported.push(...importedAgents)
            }
            if (allImported.length > 0) {
                const importedIds = new Set(allImported.map((agent) => agent.id))
                setAgents((prev) => sortAgents([...allImported, ...prev.filter((agent) => !importedIds.has(agent.id))]))
            }
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setBuiltinPresetsError(detail || t('presets.errors.cloneFailed'))
        } finally {
            setCloningAllPresets(false)
        }
    }, [builtinPresets, t])

    const handleOpenPublishDialog = useCallback((mode: 'create' | 'overwrite') => {
        if (!selectedAgent) return

        const agentName = draftName.trim() || t('actions.newAgentName')
        const key = agentName.trim().toLowerCase()
        const matchingPreset =
            (selectedAgent.sourcePresetId
                ? builtinPresets.find((preset) => preset.presetId === selectedAgent.sourcePresetId)
                : null)
            ?? builtinPresets.find(
                (preset) => preset.name.trim().toLowerCase() === key
            )
            ?? builtinPresets[0]
            ?? null

        setPublishDialogMode(mode)
        setPublishPresetName(agentName)
        setPublishDescription(matchingPreset?.description ?? '')
        setPublishOverwritePresetId(matchingPreset?.presetId ?? '')
        setPublishError(null)
        setPublishDialogOpen(true)
    }, [builtinPresets, draftName, selectedAgent, t])

    const handlePublishDialogOpenChange = useCallback((open: boolean) => {
        setPublishDialogOpen(open)
        if (!open) setPublishError(null)
    }, [])

    const handleSubmitPublishDialog = useCallback(async () => {
        if (!selectedAgent) return

        setPublishBusy(true)
        setPublishError(null)
        try {
            const description = publishDescription.trim() ? publishDescription.trim() : null
            if (publishDialogMode === 'create') {
                await agentPresetApi.publish({
                    agentId: selectedAgent.id,
                    name: publishPresetName,
                    description,
                })
            } else {
                if (!publishOverwritePresetId) {
                    throw new Error(t('presets.errors.selectPreset'))
                }
                await agentPresetApi.update(publishOverwritePresetId, {
                    agentId: selectedAgent.id,
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
    }, [loadBuiltinPresets, publishDescription, publishDialogMode, publishOverwritePresetId, publishPresetName, selectedAgent, t])

    const saveLabel = useMemo(() => {
        if (saveState === 'saving') return t('status.saving')
        if (saveState === 'saved') return t('status.saved')
        if (saveState === 'error') return t('status.saveFailed')
        return ''
    }, [saveState, t])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('library.loading')}
            </div>
        )
    }

    return (
        <>
        <div className="flex h-full min-h-0">
            <section className="w-[340px] shrink-0 border-r bg-card flex flex-col">
                <div className="border-b p-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder={t('library.searchPlaceholder')}
                                className="pl-8"
                            />
                        </div>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => void handleCreate()}>
                            <Plus className="h-4 w-4" />
                            {t('actions.new')}
                        </Button>
                    </div>
                </div>

                <AgentPresetLibrarySection
                    presets={builtinPresets}
                    loading={builtinPresetsLoading}
                    error={builtinPresetsError}
                    cloningPresetId={cloningPresetId}
                    cloningAll={cloningAllPresets}
                    cloneConflictNames={cloneConflictNames}
                    cloneOverwriteConfirmOpen={cloneOverwriteConfirmOpen}
                    onClonePreset={(presetId, overwriteExisting) => void handleClonePreset(presetId, overwriteExisting)}
                    onCloneAllPresets={() => void handleCloneAllPresets()}
                    onCloneOverwriteConfirmOpenChange={(open) => {
                        setCloneOverwriteConfirmOpen(open)
                        if (!open) {
                            setCloneOverwritePresetId(null)
                            setCloneConflictNames([])
                        }
                    }}
                    onConfirmCloneOverwrite={() => void handleConfirmCloneOverwrite()}
                />

                {error && <div className="border-b px-3 py-2 text-sm text-destructive">{error}</div>}

                <ScrollArea className="flex-1">
                    <div className="p-2">
                        {filteredAgents.length === 0 ? (
                            <div className="px-2 py-2 text-sm text-muted-foreground">{t('library.empty')}</div>
                        ) : (
                            filteredAgents.map((agent) => {
                                const isSelected = agent.id === selectedAgentId
                                const preview = getAgentPreview(agent.content)
                                return (
                                    <div
                                        key={agent.id}
                                        role="button"
                                        tabIndex={0}
                                        className={cn(
                                            'group mb-2 w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 focus-visible:ring-offset-1',
                                            isSelected && agent.enabled
                                                ? 'border-amber-400 bg-amber-50/80 ring-1 ring-amber-200 dark:bg-amber-950/35 dark:ring-amber-900/60'
                                                : isSelected
                                                    ? 'border-primary/40 bg-muted'
                                                    : agent.enabled
                                                        ? 'border-amber-300 bg-amber-50/70 hover:border-amber-400 dark:bg-amber-950/25'
                                                        : 'border-border hover:border-sky-200/60 hover:bg-muted'
                                        )}
                                        onClick={() => setSelectedAgentId(agent.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                setSelectedAgentId(agent.id)
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span
                                                className={cn(
                                                    'truncate text-sm font-medium',
                                                    agent.sourcePresetId && 'italic text-muted-foreground'
                                                )}
                                            >
                                                {agent.name}
                                            </span>
                                            {agent.enabled && (
                                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                                                    {t('actions.enabled')}
                                                </span>
                                            )}
                                            <Button
                                                variant={agent.enabled ? 'secondary' : 'outline'}
                                                size="sm"
                                                className="ml-auto h-7 px-2"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    void handleEnable(agent)
                                                }}
                                                disabled={agent.enabled}
                                                title={t('actions.enableAgent')}
                                            >
                                                <Check className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                        {preview ? (
                                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                                {preview}
                                            </p>
                                        ) : null}
                                    </div>
                                )
                            })
                        )}
                    </div>
                </ScrollArea>
            </section>

            <section className="flex-1 min-w-0 flex flex-col">
                {!selectedAgent ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        {t('editor.emptyState')}
                    </div>
                ) : (
                    <>
                        <div className="px-5 pt-3 pb-2">
                            <div className="mb-2 flex items-center gap-3">
                                <div className="shrink-0 text-sm font-medium">{t('editor.name')}</div>
                                <Input
                                    value={draftName}
                                    disabled={editorReadOnly}
                                    onChange={(event) => {
                                        setError(null)
                                        setDraftName(event.target.value)
                                    }}
                                    placeholder={t('editor.namePlaceholder')}
                                />
                                <div className="flex shrink-0 items-center gap-2">
                                    {saveLabel && (
                                        <span className={cn('text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                                            {saveLabel}
                                        </span>
                                    )}
                                    <Button
                                        variant={selectedAgent.enabled ? 'secondary' : 'outline'}
                                        size="sm"
                                        className="gap-1"
                                        onClick={() => void handleEnable(selectedAgent)}
                                        disabled={selectedAgent.enabled}
                                    >
                                        <Check className="h-4 w-4" />
                                        {selectedAgent.enabled ? t('actions.enabled') : t('actions.enableAgent')}
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="icon-sm" title={t('actions.more')}>
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {presetAuthoringEnabled && (
                                                <>
                                                    <DropdownMenuItem onClick={() => handleOpenPublishDialog('create')}>
                                                        {t('presets.publish.createMenu')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleOpenPublishDialog('overwrite')}>
                                                        {t('presets.publish.overwriteMenu')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                </>
                                            )}
                                            <DropdownMenuItem onClick={() => void handleCloneAgent()}>
                                                {t('actions.cloneAgent')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-destructive" onClick={() => void handleDelete()}>
                                                {t('actions.deleteAgent')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        </div>

                        <Separator />

                        {editorReadOnly && (
                            <div className="mx-5 mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-300">
                                <div>
                                    {agentPresetUpdate.clonedRevision != null
                                        ? t('editor.presetReadOnlyNoticeVersioned', { revision: agentPresetUpdate.clonedRevision.toFixed(1) })
                                        : t('editor.presetReadOnlyNotice')}
                                </div>
                                {agentPresetUpdate.updateAvailable && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="font-medium">{t('editor.presetUpdateAvailable')}</span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 gap-1 border-amber-400/60 bg-background/60"
                                            onClick={() => {
                                                if (agentPresetUpdate.sourceId) void handleClonePreset(agentPresetUpdate.sourceId, true)
                                            }}
                                        >
                                            {t('editor.presetUpdateClone')}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="px-5 py-3">
                            <div className="text-base font-semibold">{t('editor.sectionTitle')}</div>
                        </div>

                        <div className="flex-1 min-h-0 px-5 pb-5">
                            <Textarea
                                value={draftContent}
                                disabled={editorReadOnly}
                                onChange={(event) => {
                                    setError(null)
                                    setDraftContent(event.target.value)
                                }}
                                className={cn(
                                    'h-full min-h-[420px] resize-none font-mono text-sm leading-6',
                                    editorReadOnly && 'bg-muted/40 text-muted-foreground'
                                )}
                                placeholder={t('editor.placeholder')}
                            />
                        </div>
                    </>
                )}
            </section>
        </div>

        <AgentPresetPublishDialog
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
            onOverwritePresetIdChange={setPublishOverwritePresetId}
            onSubmit={() => void handleSubmitPublishDialog()}
        />
        </>
    )
}
