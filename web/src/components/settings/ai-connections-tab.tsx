'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    pointerWithin,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModelSetsCard } from '@/components/settings/model-sets-card'
import { ApiError, aiApi } from '@/lib/api'
import {
    computeFailureUpdates,
    createEmptyModelTypeState,
    getConsecutiveFailureCount,
    getIgnoredUntilTimestamp,
    getResetAssignmentHealth,
} from '@/lib/ai-group-config'
import {
    CHERRY_STUDIO_MODEL_TYPE_ORDER,
    detectCherryStudioModelTypes,
    type CherryStudioDetectionState,
    type CherryStudioModelType,
} from '@/lib/cherrystudio-model-config'
import { dispatchModelGroupsChangedEvent } from '@/lib/model-group-events'
import { cn } from '@/lib/utils'
import {
    createId,
    AiConnection,
    ModelAssignment,
    ModelGroup,
    ModelTypeState,
    ProviderType,
    useAiStore,
} from '@/lib/ai-store'
import {
    AlertTriangle,
    Brain,
    ChevronDown,
    ChevronRight,
    Database,
    Eye,
    EyeOff,
    GripVertical,
    Plus,
    RefreshCw,
    Search,
    TestTube,
    Trash2,
    Wrench,
} from 'lucide-react'

const TEST_MESSAGE =
    'hi, just testing the connection, if you see this message, plz respond with connection success'

interface DragItemData {
    type: 'provider-model' | 'assignment'
    connectionId?: string
    modelId?: string
    assignmentId?: string
    groupId?: string
    label?: string
}

type RenameGroupResult = {
    ok: boolean
    name: string
}

const PROVIDER_DEFAULT_BASE_URLS: Record<ProviderType, string> = {
    'openai-chat': 'https://api.openai.com/v1',
    'openai-image': 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

function getProviderTypeLabelKey(providerType: string) {
    if (providerType === 'openai-image') return 'providerTypes.openaiImage'
    if (providerType === 'gemini') return 'providerTypes.gemini'
    return 'providerTypes.openai'
}

type FilteredProvider = {
    connection: AiConnection
    models: AiConnection['models']
}

const formatDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString()
}

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '')
const normalizeName = (value: string) => value.trim().toLocaleLowerCase()
const MODEL_TYPE_LABEL_KEYS: Record<CherryStudioModelType, string> = {
    vision: 'modelTypeVision',
    reasoning: 'modelTypeReasoning',
    tool: 'modelTypeTool',
    reranker: 'modelTypeReranker',
    embedding: 'modelTypeEmbedding',
}
const MODEL_TYPE_ICONS = {
    vision: Eye,
    reasoning: Brain,
    tool: Wrench,
    reranker: Search,
    embedding: Database,
} satisfies Record<CherryStudioModelType, typeof Eye>

const parseOptionalNumber = (value: string) => {
    if (value.trim() === '') return null
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
}

export function AIConnectionsTab() {
    const t = useTranslations('settings.ai')
    const {
        connections,
        groups,
        setConnections,
        setGroups,
        upsertConnection,
        removeConnection,
        setConnectionModels,
        addGroup,
        updateGroup: updateGroupLocal,
        removeGroup: removeGroupLocal,
        setGroupAssignments: setGroupAssignmentsLocal,
        updateAssignment: updateAssignmentLocal,
    } = useAiStore()

    const [providerType, setProviderType] = useState<ProviderType>('openai-chat')
    const [connectionName, setConnectionName] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
    const [showApiKey, setShowApiKey] = useState(false)
    const [connecting, setConnecting] = useState(false)
    const [connectError, setConnectError] = useState<string | null>(null)
    const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({})
    const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({})
    const [refreshingConnectionId, setRefreshingConnectionId] = useState<string | null>(null)
    const [testing, setTesting] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({})
    const [testMessage, setTestMessage] = useState<Record<string, string>>({})
    const [activeDragItem, setActiveDragItem] = useState<DragItemData | null>(null)
    const [newGroupName, setNewGroupName] = useState('')
    const [groupError, setGroupError] = useState<string | null>(null)
    const [providerKeyword, setProviderKeyword] = useState('')
    const [currentTimestamp, setCurrentTimestamp] = useState(0)
    const trimmedNewGroupName = newGroupName.trim()
    const canAddGroup = trimmedNewGroupName.length > 0
    const normalizedProviderKeyword = providerKeyword.trim().toLocaleLowerCase()

    useEffect(() => {
        const updateCurrentTimestamp = () => {
            setCurrentTimestamp(Date.now())
        }

        updateCurrentTimestamp()
        const timer = window.setInterval(updateCurrentTimestamp, 60_000)
        return () => window.clearInterval(timer)
    }, [])

    const connectionMap = useMemo(() => {
        return new Map(connections.map((connection) => [connection.id, connection]))
    }, [connections])

    const activeProviders = useMemo(() => {
        return connections.filter((connection) => connection.isActive && connection.models.length > 0)
    }, [connections])

    const filteredProviders = useMemo<FilteredProvider[]>(() => {
        if (!normalizedProviderKeyword) {
            return activeProviders.map((connection) => ({
                connection,
                models: connection.models,
            }))
        }

        // Match models only — a hit on the connection name would surface every
        // model under it, which reads as wrong results.
        return activeProviders.reduce<FilteredProvider[]>((result, connection) => {
            const models = connection.models.filter(
                (model) =>
                    model.name.toLocaleLowerCase().includes(normalizedProviderKeyword) ||
                    model.id.toLocaleLowerCase().includes(normalizedProviderKeyword)
            )

            if (models.length > 0) {
                result.push({ connection, models })
            }

            return result
        }, [])
    }, [activeProviders, normalizedProviderKeyword])

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    useEffect(() => {
        let cancelled = false

        aiApi
            .listConnections()
            .then((items) => {
                if (cancelled) return
                setConnections(
                    items.map((connection) => ({
                        id: connection.id,
                        name: connection.name,
                        providerType: connection.providerType as ProviderType,
                        baseUrl: connection.baseUrl ?? undefined,
                        isActive: connection.isActive,
                        models: connection.models ?? [],
                        lastFetchedAt: connection.lastFetchedAt ?? undefined,
                    }))
                )
            })
            .catch(() => {})

        return () => {
            cancelled = true
        }
    }, [setConnections])

    useEffect(() => {
        let cancelled = false

        aiApi
            .listGroups()
            .then((data) => {
                if (cancelled) return
                setGroups(data.groups ?? [])
                setGroupError(null)
            })
            .catch((error) => {
                if (cancelled) return
                setGroupError(error instanceof Error ? error.message : String(error))
            })

        return () => {
            cancelled = true
        }
    }, [setGroups])

    const isGroupNameDuplicate = useCallback(
        (name: string, excludeId?: string) => {
            const normalizedName = normalizeName(name)
            return groups.some(
                (group) => group.id !== excludeId && normalizeName(group.name) === normalizedName
            )
        },
        [groups]
    )

    const updateGroup = (id: string, updates: Partial<ModelGroup>) => {
        updateGroupLocal(id, updates)
        if (updates.name !== undefined || updates.modelTypes !== undefined) {
            dispatchModelGroupsChangedEvent()
        }
        aiApi.updateGroup(id, updates).catch(() => {})
    }

    const renameGroup = useCallback(
        async (id: string, nextName: string): Promise<RenameGroupResult> => {
            const currentGroup = groups.find((group) => group.id === id)
            if (!currentGroup) {
                return { ok: false, name: nextName }
            }

            const trimmedName = nextName.trim()
            if (!trimmedName) {
                setGroupError(t('errors.missingGroupName'))
                return { ok: false, name: currentGroup.name }
            }

            if (isGroupNameDuplicate(trimmedName, id)) {
                setGroupError(t('errors.groupNameExists'))
                return { ok: false, name: currentGroup.name }
            }

            if (trimmedName === currentGroup.name) {
                setGroupError(null)
                return { ok: true, name: currentGroup.name }
            }

            updateGroupLocal(id, { name: trimmedName })
            dispatchModelGroupsChangedEvent()
            try {
                await aiApi.updateGroup(id, { name: trimmedName })
                setGroupError(null)
                return { ok: true, name: trimmedName }
            } catch (error) {
                updateGroupLocal(id, { name: currentGroup.name })
                if (error instanceof ApiError) {
                    if (error.status === 409) {
                        setGroupError(t('errors.groupNameExists'))
                    } else if (error.status === 400) {
                        setGroupError(t('errors.missingGroupName'))
                    } else {
                        setGroupError(error.message)
                    }
                } else {
                    setGroupError(error instanceof Error ? error.message : String(error))
                }
                return { ok: false, name: currentGroup.name }
            }
        },
        [groups, isGroupNameDuplicate, t, updateGroupLocal]
    )

    const removeGroup = async (id: string) => {
        removeGroupLocal(id)
        dispatchModelGroupsChangedEvent()
        try {
            await aiApi.deleteGroup(id)
        } catch {
            // ignore
        }
    }

    const setGroupAssignments = (groupId: string, assignments: ModelAssignment[]) => {
        setGroupAssignmentsLocal(groupId, assignments)
        dispatchModelGroupsChangedEvent()
        aiApi.setGroupAssignments(groupId, assignments).catch(() => {})
    }

    const updateAssignment = (
        groupId: string,
        assignmentId: string,
        updates: Partial<ModelAssignment>
    ) => {
        updateAssignmentLocal(groupId, assignmentId, updates)
        aiApi.patchAssignment(assignmentId, updates).catch(() => {})
    }

    const collisionDetectionStrategy = useCallback(
        (args: Parameters<typeof pointerWithin>[0]) => {
            const pointerCollisions = pointerWithin(args)
            if (pointerCollisions.length > 0) {
                return pointerCollisions
            }

            // If there's no pointer (e.g. keyboard sensor), fall back to closest-center.
            // With pointer input, return no collisions so users can "drop to cancel" outside groups.
            if (!args.pointerCoordinates) {
                return closestCenter(args)
            }

            return []
        },
        []
    )

    const handleConnect = async () => {
        setConnectError(null)

        if (!apiKey.trim()) {
            setConnectError(t('errors.missingApiKey'))
            return
        }

        if (!baseUrl.trim()) {
            setConnectError(t('errors.missingBaseUrl'))
            return
        }

        const name = connectionName.trim() || t('defaults.openaiName')

        setConnecting(true)

        try {
            const { connection } = await aiApi.createConnection({
                name,
                providerType,
                apiKey: apiKey.trim(),
                baseUrl: normalizeBaseUrl(baseUrl.trim()),
            })

            const nextConnection: AiConnection = {
                id: connection.id,
                name: connection.name,
                providerType: connection.providerType as ProviderType,
                baseUrl: connection.baseUrl ?? undefined,
                isActive: connection.isActive,
                models: connection.models || [],
                lastFetchedAt: connection.lastFetchedAt ?? undefined,
            }

            // Backward compatible: if a connection with same name was created earlier (server upsert),
            // keep local state in sync.
            upsertConnection(nextConnection)

            setConnectionName('')
            setApiKey('')
            setBaseUrl('https://api.openai.com/v1')
            setShowApiKey(false)
        } catch (error) {
            setConnectError(error instanceof Error ? error.message : t('errors.fetchModelsFailed'))
        } finally {
            setConnecting(false)
        }
    }

    const handleRefreshModels = async (connectionId: string) => {
        const connection = connectionMap.get(connectionId)
        if (!connection) return

        setRefreshingConnectionId(connectionId)
        try {
            const data = await aiApi.refreshModels(connectionId)
            setConnectionModels(connectionId, data.models || [])
        } catch (error) {
            console.error('Failed to refresh models:', error)
        } finally {
            setRefreshingConnectionId(null)
        }
    }

    const toggleConnectionExpanded = (connectionId: string) => {
        setExpandedConnections((prev) => ({
            ...prev,
            [connectionId]: !prev[connectionId],
        }))
    }

    const toggleProviderExpanded = (connectionId: string) => {
        setExpandedProviders((prev) => ({
            ...prev,
            [connectionId]: !prev[connectionId],
        }))
    }

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current as DragItemData | undefined
        setActiveDragItem(data || null)
    }

    const handleDragCancel = () => {
        setActiveDragItem(null)
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        setActiveDragItem(null)

        if (!over) return

        const activeData = active.data.current as DragItemData | undefined
        const overId = String(over.id)

        if (!activeData) return

        if (activeData.type === 'provider-model') {
            const targetGroupId = resolveGroupId(overId, groups)
            if (!targetGroupId || !activeData.connectionId || !activeData.modelId) return

            const targetGroup = groups.find((group) => group.id === targetGroupId)
            if (!targetGroup) return

            const exists = targetGroup.assignments.some(
                (assignment) =>
                    assignment.connectionId === activeData.connectionId &&
                    assignment.modelId === activeData.modelId
            )

            if (exists) return

            const newAssignment: ModelAssignment = {
                id: createId(),
                connectionId: activeData.connectionId,
                modelId: activeData.modelId,
                failureCount: 0,
                ignoredUntil: null,
                manuallyDisabled: false,
            }

            const insertIndex = resolveInsertIndex(overId, targetGroup)
            const updatedAssignments = [...targetGroup.assignments]
            updatedAssignments.splice(insertIndex, 0, newAssignment)
            setGroupAssignmentsLocal(targetGroupId, updatedAssignments)
            aiApi.setGroupAssignments(targetGroupId, updatedAssignments).catch(() => {})
            return
        }

        if (activeData.type === 'assignment') {
            const activeGroupId = activeData.groupId
            if (!activeGroupId) return

            const targetGroupId = resolveGroupId(overId, groups)
            if (!targetGroupId) return

            const activeGroup = groups.find((group) => group.id === activeGroupId)
            const targetGroup = groups.find((group) => group.id === targetGroupId)

            if (!activeGroup || !targetGroup) return

            const activeIndex = activeGroup.assignments.findIndex(
                (assignment) => assignment.id === active.id
            )

            if (activeIndex === -1) return

            const assignment = activeGroup.assignments[activeIndex]

            if (activeGroupId === targetGroupId) {
                const overIndex = targetGroup.assignments.findIndex(
                    (item) => item.id === over.id
                )

                if (overIndex === -1 || overIndex === activeIndex) return

                const reordered = arrayMove(targetGroup.assignments, activeIndex, overIndex)
                setGroupAssignmentsLocal(targetGroupId, reordered)
                dispatchModelGroupsChangedEvent()
                aiApi.setGroupAssignments(targetGroupId, reordered).catch(() => {})
                return
            }

            const targetIndex = resolveInsertIndex(overId, targetGroup)
            const nextSourceAssignments = activeGroup.assignments.filter(
                (item) => item.id !== assignment.id
            )
            const nextTargetAssignments = [...targetGroup.assignments]
            nextTargetAssignments.splice(targetIndex, 0, assignment)

            setGroupAssignmentsLocal(activeGroupId, nextSourceAssignments)
            setGroupAssignmentsLocal(targetGroupId, nextTargetAssignments)
            dispatchModelGroupsChangedEvent()
            Promise.all([
                aiApi.setGroupAssignments(activeGroupId, nextSourceAssignments),
                aiApi.setGroupAssignments(targetGroupId, nextTargetAssignments),
            ]).catch(() => {})
        }
    }

    const handleAddGroup = async () => {
        setGroupError(null)
        const name = newGroupName.trim()
        if (!name) {
            setGroupError(t('errors.missingGroupName'))
            return
        }

        if (isGroupNameDuplicate(name)) {
            setGroupError(t('errors.groupNameExists'))
            return
        }

        setNewGroupName('')

        try {
            const data = await aiApi.createGroup({ name })
            addGroup(data.group)
            dispatchModelGroupsChangedEvent()
        } catch (error) {
            console.error('Failed to create group:', error)
            if (error instanceof ApiError && error.status === 409) {
                setGroupError(t('errors.groupNameExists'))
                return
            }
            if (error instanceof ApiError && error.status === 400) {
                setGroupError(t('errors.missingGroupName'))
                return
            }
            setGroupError(error instanceof Error ? error.message : String(error))
        }
    }

    const handleTestAssignment = async (group: ModelGroup, assignment: ModelAssignment) => {
        const connection = connectionMap.get(assignment.connectionId)
        if (!connection) return

        setTesting((prev) => ({ ...prev, [assignment.id]: 'testing' }))
        setTestMessage((prev) => ({ ...prev, [assignment.id]: '' }))

        try {
            const data = await aiApi.testModel({
                connectionId: assignment.connectionId,
                modelId: assignment.modelId,
                prompt: TEST_MESSAGE,
            })
            setTesting((prev) => ({ ...prev, [assignment.id]: 'success' }))
            setTestMessage((prev) => ({
                ...prev,
                [assignment.id]: data.text || t('testSuccess'),
            }))

            updateAssignment(group.id, assignment.id, getResetAssignmentHealth())
        } catch (error) {
            setTesting((prev) => ({ ...prev, [assignment.id]: 'error' }))
            setTestMessage((prev) => ({
                ...prev,
                [assignment.id]: error instanceof Error ? error.message : t('errors.testFailed'),
            }))

            updateAssignment(
                group.id,
                assignment.id,
                computeFailureUpdates({
                    assignment,
                    failurePolicy: group.failurePolicy,
                    nowMs: Date.now(),
                })
            )
        }
    }

    const handleReactivate = (groupId: string, assignmentId: string) => {
        updateAssignment(groupId, assignmentId, getResetAssignmentHealth())
    }

    const handleToggleManual = (groupId: string, assignment: ModelAssignment) => {
        const manuallyDisabled = !assignment.manuallyDisabled
        updateAssignment(groupId, assignment.id, { manuallyDisabled })
    }

    const dragOverlayLabel = useMemo(() => {
        if (!activeDragItem) return null
        if (activeDragItem.type === 'provider-model') {
            return activeDragItem.label || activeDragItem.modelId || t('dragPreview')
        }
        if (activeDragItem.type === 'assignment' && activeDragItem.groupId) {
            const group = groups.find((item) => item.id === activeDragItem.groupId)
            const assignment = group?.assignments.find(
                (item) => item.id === activeDragItem.assignmentId
            )
            if (assignment) {
                const connection = connectionMap.get(assignment.connectionId)
                const modelLabel =
                    connection?.models.find((model) => model.id === assignment.modelId)?.name ||
                    assignment.modelId
                return modelLabel
            }
        }
        return activeDragItem.label || t('dragPreview')
    }, [activeDragItem, connectionMap, groups, t])

    const isDraggingProviderModel = activeDragItem?.type === 'provider-model'

    return (
        <div className="space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>{t('connectionsTitle')}</CardTitle>
                    <CardDescription>{t('connectionsDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>{t('connectionType')}</Label>
                            <Select
                                value={providerType}
                                onValueChange={(value) => {
                                    const nextType = value as ProviderType
                                    // Swap an untouched base URL to the new format's default.
                                    if (!baseUrl.trim() || baseUrl.trim() === PROVIDER_DEFAULT_BASE_URLS[providerType]) {
                                        setBaseUrl(PROVIDER_DEFAULT_BASE_URLS[nextType])
                                    }
                                    setProviderType(nextType)
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="openai-chat">{t('providerTypes.openai')}</SelectItem>
                                    <SelectItem value="openai-image">{t('providerTypes.openaiImage')}</SelectItem>
                                    <SelectItem value="gemini">{t('providerTypes.gemini')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="connection-name">{t('connectionName')}</Label>
                            <Input
                                id="connection-name"
                                value={connectionName}
                                onChange={(event) => setConnectionName(event.target.value)}
                                placeholder={t('connectionNamePlaceholder')}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="api-key">{t('apiKey')}</Label>
                        <div className="relative">
                            <Input
                                id="api-key"
                                type={showApiKey ? 'text' : 'password'}
                                placeholder={t('apiKeyPlaceholder')}
                                value={apiKey}
                                onChange={(event) => setApiKey(event.target.value)}
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                {showApiKey ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="base-url">{t('baseUrl')}</Label>
                        <Input
                            id="base-url"
                            type="text"
                            placeholder={t('baseUrlPlaceholder')}
                            value={baseUrl}
                            onChange={(event) => setBaseUrl(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
                    </div>

                    {connectError && (
                        <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertTriangle className="h-4 w-4" />
                            {connectError}
                        </div>
                    )}

                    <Button onClick={handleConnect} disabled={connecting}>
                        {connecting ? t('connecting') : t('connect')}
                    </Button>

                    <div className="space-y-4">
                        <div className="text-sm font-semibold">{t('connectionsListTitle')}</div>
                        {connections.length === 0 ? (
                            <div className="text-sm text-muted-foreground">{t('noConnections')}</div>
                        ) : (
                            <div className="space-y-3">
                                {connections.map((connection) => {
                                    const isExpanded = expandedConnections[connection.id]
                                    return (
                                        <div
                                            key={connection.id}
                                            className="rounded-lg border border-muted p-4 space-y-2"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="space-y-1">
                                                    <div className="font-medium">{connection.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {t(getProviderTypeLabelKey(connection.providerType))}
                                                        {' · '}
                                                        {t('modelCount', { count: connection.models.length })}
                                                    </div>
                                                    {connection.baseUrl && (
                                                        <div className="text-xs text-muted-foreground">
                                                            {t('baseUrlLabel', { value: connection.baseUrl })}
                                                        </div>
                                                    )}
                                                    {connection.lastFetchedAt && (
                                                        <div className="text-xs text-muted-foreground">
                                                            {t('lastFetched', {
                                                                value: new Date(connection.lastFetchedAt).toLocaleString(),
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleRefreshModels(connection.id)}
                                                        disabled={refreshingConnectionId === connection.id}
                                                        aria-label={t('refreshModels')}
                                                    >
                                                        <RefreshCw className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={async () => {
                                                            try {
                                                                await aiApi.deleteConnection(connection.id)
                                                            } finally {
                                                                removeConnection(connection.id)
                                                            }
                                                        }}
                                                        aria-label={t('deleteConnection')}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleConnectionExpanded(connection.id)}
                                                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                                {isExpanded ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                )}
                                                {isExpanded ? t('collapseModels') : t('expandModels')}
                                            </button>
                                            {isExpanded && (
                                                <div className="text-xs text-muted-foreground grid gap-1">
                                                    {connection.models.length === 0
                                                        ? t('noModels')
                                                        : connection.models.map((model) => (
                                                            <div key={model.id}>{model.name}</div>
                                                        ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('modelGroupsTitle')}</CardTitle>
                    <CardDescription>{t('modelGroupsDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            value={newGroupName}
                            onChange={(event) => {
                                setNewGroupName(event.target.value)
                                if (groupError) setGroupError(null)
                            }}
                            placeholder={t('groupNamePlaceholder')}
                            className="max-w-xs"
                        />
                        <Button variant="outline" onClick={handleAddGroup} disabled={!canAddGroup}>
                            <Plus className="h-4 w-4" />
                            {t('addGroup')}
                        </Button>
                    </div>
                    {groupError && (
                        <div className="text-xs text-destructive">{groupError}</div>
                    )}

                    <DndContext
                        sensors={sensors}
                        collisionDetection={collisionDetectionStrategy}
                        autoScroll
                        onDragStart={handleDragStart}
                        onDragCancel={handleDragCancel}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <div className="text-sm font-semibold">{t('providersTitle')}</div>
                                <p className="text-xs text-muted-foreground">{t('providersHint')}</p>
                                <div className="rounded-lg border border-muted">
                                    <div className="border-b border-muted p-2">
                                        <Input
                                            value={providerKeyword}
                                            onChange={(event) => setProviderKeyword(event.target.value)}
                                            placeholder={t('providerFilterPlaceholder')}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                    <ScrollArea className="h-[430px]">
                                        <div className="p-3 pr-6 space-y-2">
                                            {filteredProviders.length === 0 ? (
                                                <div className="text-xs text-muted-foreground">
                                                    {normalizedProviderKeyword
                                                        ? t('noMatchedProviders')
                                                        : t('noActiveProviders')}
                                                </div>
                                            ) : (
                                                filteredProviders.map(({ connection, models }) => {
                                                    const expanded = expandedProviders[connection.id]
                                                    return (
                                                        <div key={connection.id} className="space-y-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleProviderExpanded(connection.id)}
                                                                className="grid w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-2 text-left text-xs font-medium"
                                                            >
                                                                <span className="min-w-0 truncate pr-1">
                                                                    {connection.name}
                                                                </span>
                                                                <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">
                                                                    {expanded ? (
                                                                        <ChevronDown className="h-3 w-3" />
                                                                    ) : (
                                                                        <ChevronRight className="h-3 w-3" />
                                                                    )}
                                                                </span>
                                                            </button>
                                                            {expanded && (
                                                                <div className="space-y-1">
                                                                    {models.map((model) => (
                                                                        <ProviderModelItem
                                                                            key={`${connection.id}-${model.id}`}
                                                                            connectionId={connection.id}
                                                                            modelId={model.id}
                                                                            label={model.name}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {groups.map((group) => (
                                    <ModelGroupCard
                                        key={group.id}
                                        group={group}
                                        compact={isDraggingProviderModel}
                                        currentTimestamp={currentTimestamp}
                                        connections={connections}
                                        testing={testing}
                                        testMessage={testMessage}
                                        onUpdateGroup={updateGroup}
                                        onRenameGroup={renameGroup}
                                        onRemoveGroup={removeGroup}
                                        onSetAssignments={setGroupAssignments}
                                        onTestAssignment={handleTestAssignment}
                                        onReactivate={handleReactivate}
                                        onToggleManual={handleToggleManual}
                                    />
                                ))}
                            </div>
                        </div>
                        {typeof document === 'undefined'
                            ? null
                            : createPortal(
                                <DragOverlay>
                                    {dragOverlayLabel ? (
                                        <div className="pointer-events-none rounded-md border bg-background px-3 py-2 text-xs shadow-xl flex items-center gap-2 z-[9999]">
                                            <GripVertical className="h-3 w-3 text-muted-foreground" />
                                            <span className="max-w-[220px] truncate">{dragOverlayLabel}</span>
                                        </div>
                                    ) : null}
                                </DragOverlay>,
                                document.body
                            )}
                    </DndContext>
                </CardContent>
            </Card>

            <ModelSetsCard />
        </div>
    )
}

function resolveGroupId(overId: string, groups: ModelGroup[]) {
    if (overId.startsWith('group-')) {
        return overId.replace('group-', '')
    }

    const group = groups.find((item) =>
        item.assignments.some((assignment) => assignment.id === overId)
    )
    return group?.id
}

function resolveInsertIndex(overId: string, group: ModelGroup) {
    if (overId.startsWith('group-')) {
        return group.assignments.length
    }

    const index = group.assignments.findIndex((assignment) => assignment.id === overId)
    return index === -1 ? group.assignments.length : index
}

function detectGroupModelTypeState(
    group: Pick<ModelGroup, 'assignments'>,
    connections: AiConnection[]
): CherryStudioDetectionState {
    const state = createEmptyModelTypeState()

    for (const assignment of group.assignments) {
        const connection = connections.find((item) => item.id === assignment.connectionId)
        const model = connection?.models.find((item) => item.id === assignment.modelId)
        const detected = detectCherryStudioModelTypes({
            modelId: assignment.modelId,
            modelName: model?.name ?? assignment.modelId,
            baseUrl: connection?.baseUrl ?? null,
        })

        for (const modelType of CHERRY_STUDIO_MODEL_TYPE_ORDER) {
            state[modelType] = state[modelType] || detected[modelType]
        }
    }

    return state
}

function areModelTypeStatesEqual(left: ModelTypeState, right: ModelTypeState) {
    return CHERRY_STUDIO_MODEL_TYPE_ORDER.every((modelType) => left[modelType] === right[modelType])
}

function ProviderModelItem({
    connectionId,
    modelId,
    label,
}: {
    connectionId: string
    modelId: string
    label: string
}) {
    // The DragOverlay renders the moving copy; the source element must stay in
    // place untransformed, or it widens the scroll container and leaves the list
    // horizontally scrolled after the drop.
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `provider-${connectionId}-${modelId}`,
        data: {
            type: 'provider-model',
            connectionId,
            modelId,
            label,
        } satisfies DragItemData,
    })

    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={cn(
                'flex items-center gap-2 rounded-md border border-muted px-2 py-1 text-xs cursor-grab bg-background',
                isDragging && 'opacity-40'
            )}
        >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
            <span className="truncate">{label}</span>
        </div>
    )
}

function ModelGroupCard({
    group,
    compact,
    currentTimestamp,
    connections,
    testing,
    testMessage,
    onUpdateGroup,
    onRenameGroup,
    onRemoveGroup,
    onSetAssignments,
    onTestAssignment,
    onReactivate,
    onToggleManual,
}: {
    group: ModelGroup
    compact: boolean
    currentTimestamp: number
    connections: AiConnection[]
    testing: Record<string, 'idle' | 'testing' | 'success' | 'error'>
    testMessage: Record<string, string>
    onUpdateGroup: (id: string, updates: Partial<ModelGroup>) => void
    onRenameGroup: (id: string, name: string) => Promise<RenameGroupResult>
    onRemoveGroup: (id: string) => void
    onSetAssignments: (id: string, assignments: ModelAssignment[]) => void
    onTestAssignment: (group: ModelGroup, assignment: ModelAssignment) => void
    onReactivate: (groupId: string, assignmentId: string) => void
    onToggleManual: (groupId: string, assignment: ModelAssignment) => void
}) {
    const t = useTranslations('settings.ai')
    const assignmentIds = group.assignments.map((assignment) => assignment.id)
    const [collapsed, setCollapsed] = useState(true)
    const [modelTypesCollapsed, setModelTypesCollapsed] = useState(true)
    const [nameDraft, setNameDraft] = useState(group.name)
    const [isEditingName, setIsEditingName] = useState(false)
    const effectiveCollapsed = compact || collapsed
    const detectedModelTypeState = useMemo(
        () => detectGroupModelTypeState(group, connections),
        [connections, group]
    )
    const effectiveModelTypeState = group.modelTypes ?? detectedModelTypeState
    const hasManualModelTypeOverride = group.modelTypes !== null
    const enabledModelTypeCount = useMemo(
        () =>
            CHERRY_STUDIO_MODEL_TYPE_ORDER.filter((modelType) => effectiveModelTypeState[modelType]).length,
        [effectiveModelTypeState]
    )

    const commitNameDraft = async () => {
        const result = await onRenameGroup(group.id, nameDraft)
        setNameDraft(result.name)
        setIsEditingName(false)
    }

    const updateSettings = (updates: Partial<ModelGroup['settings']>) => {
        onUpdateGroup(group.id, {
            settings: {
                ...group.settings,
                ...updates,
            },
        })
    }

    const updateFailurePolicy = (updates: Partial<ModelGroup['failurePolicy']>) => {
        onUpdateGroup(group.id, {
            failurePolicy: {
                ...group.failurePolicy,
                ...updates,
            },
        })
    }

    const removeAssignment = (assignmentId: string) => {
        onSetAssignments(
            group.id,
            group.assignments.filter((assignment) => assignment.id !== assignmentId)
        )
    }

    const toggleModelType = (modelType: CherryStudioModelType) => {
        const nextState = {
            ...effectiveModelTypeState,
            [modelType]: !effectiveModelTypeState[modelType],
        }

        onUpdateGroup(group.id, {
            modelTypes: areModelTypeStatesEqual(nextState, detectedModelTypeState) ? null : nextState,
        })
    }

    const resetModelTypes = () => {
        onUpdateGroup(group.id, { modelTypes: null })
    }

    const { setNodeRef, isOver } = useDroppable({ id: `group-${group.id}` })

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'rounded-lg border border-muted',
                compact ? 'p-3 space-y-2' : 'p-4 space-y-4',
                isOver && 'border-primary/60'
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCollapsed(!collapsed)}
                            disabled={compact}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                            aria-label={effectiveCollapsed ? t('expandGroup') : t('collapseGroup')}
                        >
                            {effectiveCollapsed ? (
                                <ChevronRight className="h-4 w-4" />
                            ) : (
                                <ChevronDown className="h-4 w-4" />
                            )}
                        </button>
                        {group.fixed ? (
                            <div className="text-sm font-semibold">{group.name}</div>
                        ) : (
                            <Input
                                value={isEditingName ? nameDraft : group.name}
                                onFocus={() => {
                                    setIsEditingName(true)
                                    setNameDraft(group.name)
                                }}
                                onChange={(event) => setNameDraft(event.target.value)}
                                onBlur={() => {
                                    void commitNameDraft()
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault()
                                        event.currentTarget.blur()
                                    }
                                }}
                                className="max-w-xs"
                            />
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {t('callOrderHint')} · {t('groupSummary', { count: group.assignments.length })}
                    </div>
                </div>
                {!group.fixed && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveGroup(group.id)}
                        aria-label={t('deleteGroup')}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {effectiveCollapsed ? (
                <div className="rounded-md border border-dashed border-muted px-3 py-2 text-xs text-muted-foreground">
                    {group.assignments.length === 0
                        ? t('emptyGroup')
                        : t('collapsedAssignmentsHint', { count: group.assignments.length })}
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        <Label>{t('assignments')}</Label>
                        <div className="rounded-md border border-dashed border-muted p-2">
                            <SortableContext items={assignmentIds} strategy={verticalListSortingStrategy}>
                                {group.assignments.length === 0 ? (
                                    <div className="text-xs text-muted-foreground">{t('emptyGroup')}</div>
                                ) : (
                                    <div className="space-y-2">
                                        {group.assignments.map((assignment) => (
                                            <AssignmentItem
                                                key={assignment.id}
                                                assignment={assignment}
                                                group={group}
                                                currentTimestamp={currentTimestamp}
                                                connections={connections}
                                                testing={testing}
                                                testMessage={testMessage}
                                                onRemove={() => removeAssignment(assignment.id)}
                                                onTest={() => onTestAssignment(group, assignment)}
                                                onReactivate={() => onReactivate(group.id, assignment.id)}
                                                onToggleManual={() => onToggleManual(group.id, assignment)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </SortableContext>
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>{t('strategy')}</Label>
                            <Select
                                value={group.settings.strategy}
                                onValueChange={(value) =>
                                    updateSettings({ strategy: value as ModelGroup['settings']['strategy'] })
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t('strategy')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="priority">{t('strategyPriority')}</SelectItem>
                                    <SelectItem value="round-robin">{t('strategyRoundRobin')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <input
                                id={`stream-${group.id}`}
                                type="checkbox"
                                checked={group.settings.stream}
                                onChange={(event) => updateSettings({ stream: event.target.checked })}
                            />
                            <Label htmlFor={`stream-${group.id}`}>{t('stream')}</Label>
                        </div>
                        <div className="space-y-2">
                            <Label>{t('temperature')}</Label>
                            <Input
                                type="text"
                                inputMode="decimal"
                                value={group.settings.temperature ?? ''}
                                onChange={(event) =>
                                    updateSettings({ temperature: parseOptionalNumber(event.target.value) })
                                }
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('maxTokens')}</Label>
                            <Input
                                type="text"
                                inputMode="numeric"
                                value={group.settings.maxTokens ?? ''}
                                onChange={(event) =>
                                    updateSettings({ maxTokens: parseOptionalNumber(event.target.value) })
                                }
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={() => setModelTypesCollapsed((value) => !value)}
                            className="flex w-full items-center justify-between rounded-md border border-dashed border-muted px-3 py-2 text-left"
                            aria-expanded={!modelTypesCollapsed}
                            aria-controls={`group-model-types-${group.id}`}
                        >
                            <div className="flex items-center gap-2">
                                {modelTypesCollapsed ? (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                                <span className="text-sm font-medium">{t('modelTypes')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {hasManualModelTypeOverride && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                                        {t('modelTypesManualOverride')}
                                    </span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                    {enabledModelTypeCount > 0
                                        ? t('modelTypesDetectedCount', { count: enabledModelTypeCount })
                                        : t('modelTypesNoneDetected')}
                                </span>
                            </div>
                        </button>
                        {!modelTypesCollapsed && (
                            <div
                                id={`group-model-types-${group.id}`}
                                className="rounded-md border border-dashed border-muted px-3 py-3"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap gap-2">
                                        {CHERRY_STUDIO_MODEL_TYPE_ORDER.map((modelType) => (
                                            <ModelTypeBadge
                                                key={modelType}
                                                modelType={modelType}
                                                active={effectiveModelTypeState[modelType]}
                                                label={t(MODEL_TYPE_LABEL_KEYS[modelType])}
                                                onClick={() => toggleModelType(modelType)}
                                            />
                                        ))}
                                    </div>
                                    {hasManualModelTypeOverride && (
                                        <Button variant="ghost" size="sm" onClick={resetModelTypes}>
                                            {t('reset')}
                                        </Button>
                                    )}
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground">
                                    {t('modelTypesAutoDetectHint')}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>{t('maxFailures')}</Label>
                            <Input
                                type="number"
                                value={group.failurePolicy.maxFailures}
                                onChange={(event) =>
                                    updateFailurePolicy({ maxFailures: Number(event.target.value || 0) })
                                }
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('resetDays')}</Label>
                            <Input
                                type="number"
                                value={group.failurePolicy.resetDays}
                                onChange={(event) =>
                                    updateFailurePolicy({ resetDays: Number(event.target.value || 0) })
                                }
                            />
                        </div>
                    </div>

                </>
            )}
        </div>
    )
}

function ModelTypeBadge({
    modelType,
    active,
    label,
    onClick,
}: {
    modelType: CherryStudioModelType
    active: boolean
    label: string
    onClick: () => void
}) {
    const Icon = MODEL_TYPE_ICONS[modelType]

    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:border-foreground/20',
                getModelTypeBadgeClassName(modelType, active)
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
        </button>
    )
}

function getModelTypeBadgeClassName(modelType: CherryStudioModelType, active: boolean) {
    if (!active) {
        return 'border-muted bg-muted/40 text-muted-foreground'
    }

    switch (modelType) {
        case 'vision':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700'
        case 'reasoning':
            return 'border-violet-200 bg-violet-50 text-violet-700'
        case 'tool':
            return 'border-amber-200 bg-amber-50 text-amber-700'
        case 'reranker':
            return 'border-slate-200 bg-slate-100 text-slate-700'
        case 'embedding':
            return 'border-stone-200 bg-stone-100 text-stone-700'
    }
}

function AssignmentItem({
    assignment,
    group,
    currentTimestamp,
    connections,
    testing,
    testMessage,
    onRemove,
    onTest,
    onReactivate,
    onToggleManual,
}: {
    assignment: ModelAssignment
    group: ModelGroup
    currentTimestamp: number
    connections: AiConnection[]
    testing: Record<string, 'idle' | 'testing' | 'success' | 'error'>
    testMessage: Record<string, string>
    onRemove: () => void
    onTest: () => void
    onReactivate: () => void
    onToggleManual: () => void
}) {
    const t = useTranslations('settings.ai')
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: assignment.id,
        data: {
            type: 'assignment',
            groupId: group.id,
            assignmentId: assignment.id,
            label: assignment.modelId,
        } satisfies DragItemData,
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const connection = connections.find((item) => item.id === assignment.connectionId)
    const modelLabel =
        connection?.models.find((model) => model.id === assignment.modelId)?.name || assignment.modelId

    const testState = testing[assignment.id] || 'idle'
    const message = testMessage[assignment.id]

    const ignoredUntilTimestamp = getIgnoredUntilTimestamp(assignment.ignoredUntil)
    const isIgnored =
        currentTimestamp > 0 &&
        ignoredUntilTimestamp !== null &&
        ignoredUntilTimestamp > currentTimestamp
    const ignoreWindowExpired =
        currentTimestamp > 0 &&
        ignoredUntilTimestamp !== null &&
        ignoredUntilTimestamp <= currentTimestamp
    const visibleFailureCount = ignoreWindowExpired
        ? 0
        : getConsecutiveFailureCount(assignment, currentTimestamp)
    const isDisabled = assignment.manuallyDisabled || isIgnored

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'rounded-md border border-muted bg-background px-2 py-2 text-xs space-y-2',
                isDragging && 'opacity-50'
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <button
                        type="button"
                        className="mt-0.5 text-muted-foreground"
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="h-3 w-3" />
                    </button>
                    <div>
                        <div className="font-medium">{modelLabel}</div>
                        <div className="text-[10px] text-muted-foreground">
                            {connection?.name || assignment.connectionId}
                        </div>
                        {isIgnored && assignment.ignoredUntil && (
                            <div className="text-[10px] text-amber-600">
                                {t('ignoredUntil', { value: formatDate(assignment.ignoredUntil) })}
                            </div>
                        )}
                        {assignment.manuallyDisabled && (
                            <div className="text-[10px] text-amber-600">{t('manualDisabled')}</div>
                        )}
                        {visibleFailureCount > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                                {t('failureCount', { count: visibleFailureCount })}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onTest}
                        disabled={testState === 'testing'}
                        aria-label={t('testConnection')}
                    >
                        <TestTube className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onRemove} aria-label={t('removeAssignment')}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {testState === 'testing' && (
                    <span className="text-muted-foreground">{t('testing')}</span>
                )}
                {testState === 'success' && (
                    <span className="text-green-600">{t('testSuccess')}</span>
                )}
                {testState === 'error' && <span className="text-destructive">{t('testFailed')}</span>}
                {message && <span className="text-[10px] text-muted-foreground">{message}</span>}
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={isDisabled ? onReactivate : onToggleManual}
                >
                    {isDisabled ? t('enable') : t('disable')}
                </Button>
            </div>
        </div>
    )
}
