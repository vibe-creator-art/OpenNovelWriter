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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModelGroupLogoIcon } from '@/components/ai/model-group-logo-icon'
import { ApiError, aiApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { createId, type ModelGroup, type ModelSet, type ModelSetMember, useAiStore } from '@/lib/ai-store'
import { dispatchModelSetsChangedEvent } from '@/lib/model-set-events'
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react'

interface DragItemData {
    type: 'model-group' | 'member'
    groupId: string
    setId?: string
    label?: string
}

type RenameSetResult = {
    ok: boolean
    name: string
}

const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

export function ModelSetsCard() {
    const t = useTranslations('settings.ai')
    const {
        groups,
        sets,
        setSets,
        addSet,
        updateSet: updateSetLocal,
        removeSet: removeSetLocal,
        setSetMembers: setSetMembersLocal,
    } = useAiStore()

    const [newSetName, setNewSetName] = useState('')
    const [setError, setSetError] = useState<string | null>(null)
    const [activeDragItem, setActiveDragItem] = useState<DragItemData | null>(null)

    const groupMap = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
    const trimmedNewSetName = newSetName.trim()
    const canAddSet = trimmedNewSetName.length > 0

    const isSetNameDuplicate = useCallback(
        (name: string, excludeId?: string) => {
            const normalizedName = normalizeName(name)
            return sets.some(
                (setItem) =>
                    setItem.id !== excludeId && normalizeName(setItem.name) === normalizedName
            )
        },
        [sets]
    )

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    useEffect(() => {
        let cancelled = false

        aiApi
            .listModelSets()
            .then((data) => {
                if (cancelled) return
                setSets(data.sets ?? [])
                setSetError(null)
            })
            .catch((error) => {
                if (cancelled) return
                setSetError(error instanceof Error ? error.message : String(error))
            })

        return () => {
            cancelled = true
        }
    }, [setSets])

    const renameSet = useCallback(
        async (id: string, nextName: string): Promise<RenameSetResult> => {
            const currentSet = sets.find((setItem) => setItem.id === id)
            if (!currentSet) {
                return { ok: false, name: nextName }
            }

            const trimmedName = nextName.trim()
            if (!trimmedName) {
                setSetError(t('errors.missingSetName'))
                return { ok: false, name: currentSet.name }
            }

            if (isSetNameDuplicate(trimmedName, id)) {
                setSetError(t('errors.setNameExists'))
                return { ok: false, name: currentSet.name }
            }

            if (trimmedName === currentSet.name) {
                setSetError(null)
                return { ok: true, name: currentSet.name }
            }

            updateSetLocal(id, { name: trimmedName })
            try {
                await aiApi.updateModelSet(id, { name: trimmedName })
                setSetError(null)
                dispatchModelSetsChangedEvent()
                return { ok: true, name: trimmedName }
            } catch (error) {
                updateSetLocal(id, { name: currentSet.name })
                if (error instanceof ApiError) {
                    if (error.status === 409) {
                        setSetError(t('errors.setNameExists'))
                    } else if (error.status === 400) {
                        setSetError(t('errors.missingSetName'))
                    } else {
                        setSetError(error.message)
                    }
                } else {
                    setSetError(error instanceof Error ? error.message : String(error))
                }
                return { ok: false, name: currentSet.name }
            }
        },
        [isSetNameDuplicate, sets, t, updateSetLocal]
    )

    const removeSet = async (id: string) => {
        removeSetLocal(id)
        try {
            await aiApi.deleteModelSet(id)
            dispatchModelSetsChangedEvent()
        } catch {
            // ignore
        }
    }

    const setMembers = (setId: string, members: ModelSetMember[]) => {
        setSetMembersLocal(setId, members)
        aiApi
            .setModelSetMembers(
                setId,
                members.map((member) => ({ groupId: member.groupId }))
            )
            .then(() => dispatchModelSetsChangedEvent())
            .catch(() => {})
    }

    const collisionDetectionStrategy = useCallback(
        (args: Parameters<typeof pointerWithin>[0]) => {
            const pointerCollisions = pointerWithin(args)
            if (pointerCollisions.length > 0) {
                return pointerCollisions
            }

            if (!args.pointerCoordinates) {
                return closestCenter(args)
            }

            return []
        },
        []
    )

    const handleAddSet = async () => {
        setSetError(null)

        const name = newSetName.trim()
        if (!name) {
            setSetError(t('errors.missingSetName'))
            return
        }

        if (isSetNameDuplicate(name)) {
            setSetError(t('errors.setNameExists'))
            return
        }

        setNewSetName('')

        try {
            const data = await aiApi.createModelSet({ name })
            addSet(data.set)
            dispatchModelSetsChangedEvent()
        } catch (error) {
            console.error('Failed to create model set:', error)
            if (error instanceof ApiError && error.status === 409) {
                setSetError(t('errors.setNameExists'))
                return
            }
            if (error instanceof ApiError && error.status === 400) {
                setSetError(t('errors.missingSetName'))
                return
            }
            setSetError(error instanceof Error ? error.message : String(error))
        }
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
        if (!activeData) return

        const overId = String(over.id)
        const targetSetId = resolveSetId(overId)
        if (!targetSetId) return

        const targetSet = sets.find((setItem) => setItem.id === targetSetId)
        if (!targetSet) return

        const insertIndex = resolveInsertIndex(overId, targetSet)

        if (activeData.type === 'model-group') {
            if (targetSet.members.some((member) => member.groupId === activeData.groupId)) return
            const nextMembers = [...targetSet.members]
            nextMembers.splice(insertIndex, 0, { id: createId(), groupId: activeData.groupId })
            setMembers(targetSetId, nextMembers)
            return
        }

        if (activeData.type === 'member') {
            const sourceSetId = activeData.setId
            if (!sourceSetId) return

            const sourceSet = sets.find((setItem) => setItem.id === sourceSetId)
            if (!sourceSet) return

            const memberGroupId = activeData.groupId
            const activeIndex = sourceSet.members.findIndex((member) => member.groupId === memberGroupId)
            if (activeIndex === -1) return

            if (sourceSetId === targetSetId) {
                const overGroupId = parseMemberGroupId(overId)
                const overIndex = overGroupId
                    ? targetSet.members.findIndex((member) => member.groupId === overGroupId)
                    : -1
                if (overIndex === -1 || overIndex === activeIndex) return
                const reordered = arrayMove(targetSet.members, activeIndex, overIndex)
                setMembers(targetSetId, reordered)
                return
            }

            const nextSourceMembers = sourceSet.members.filter((member) => member.groupId !== memberGroupId)
            if (targetSet.members.some((member) => member.groupId === memberGroupId)) {
                setMembers(sourceSetId, nextSourceMembers)
                return
            }

            const nextTargetMembers = [...targetSet.members]
            nextTargetMembers.splice(insertIndex, 0, { id: createId(), groupId: memberGroupId })

            setSetMembersLocal(sourceSetId, nextSourceMembers)
            setSetMembersLocal(targetSetId, nextTargetMembers)
            Promise.all([
                aiApi.setModelSetMembers(
                    sourceSetId,
                    nextSourceMembers.map((member) => ({ groupId: member.groupId }))
                ),
                aiApi.setModelSetMembers(
                    targetSetId,
                    nextTargetMembers.map((member) => ({ groupId: member.groupId }))
                ),
            ])
                .then(() => dispatchModelSetsChangedEvent())
                .catch(() => {})
        }
    }

    const dragOverlayLabel = useMemo(() => {
        if (!activeDragItem) return null
        const group = groupMap.get(activeDragItem.groupId)
        return activeDragItem.label || group?.name || t('dragPreview')
    }, [activeDragItem, groupMap, t])

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('modelSetsTitle')}</CardTitle>
                <CardDescription>{t('modelSetsDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        value={newSetName}
                        onChange={(event) => {
                            setNewSetName(event.target.value)
                            if (setError) setSetError(null)
                        }}
                        placeholder={t('setNamePlaceholder')}
                        className="max-w-xs"
                    />
                    <Button variant="outline" onClick={handleAddSet} disabled={!canAddSet}>
                        <Plus className="h-4 w-4" />
                        {t('addSet')}
                    </Button>
                </div>
                {setError && <div className="text-xs text-destructive">{setError}</div>}

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
                            <div className="text-sm font-semibold">{t('availableGroupsTitle')}</div>
                            <p className="text-xs text-muted-foreground">{t('availableGroupsHint')}</p>
                            <div className="rounded-lg border border-muted">
                                <ScrollArea className="h-[360px]">
                                    <div className="p-3 space-y-2">
                                        {groups.length === 0 ? (
                                            <div className="text-xs text-muted-foreground">{t('noModelGroups')}</div>
                                        ) : (
                                            groups.map((group) => (
                                                <AvailableGroupItem
                                                    key={group.id}
                                                    groupId={group.id}
                                                    group={group}
                                                    label={group.name}
                                                />
                                            ))
                                        )}
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {sets.map((setItem) => (
                                <ModelSetCard
                                    key={setItem.id}
                                    setItem={setItem}
                                    groups={groups}
                                    onRenameSet={renameSet}
                                    onRemoveSet={removeSet}
                                    onSetMembers={setMembers}
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
    )
}

function resolveSetId(overId: string) {
    if (overId.startsWith('set-')) {
        return overId.replace('set-', '')
    }
    if (overId.startsWith('member-')) {
        return parseMemberSetId(overId)
    }
    return null
}

function parseMemberSetId(value: string) {
    const segments = value.split('-')
    return segments.length >= 3 ? segments[1] : null
}

function parseMemberGroupId(value: string) {
    if (!value.startsWith('member-')) return null
    const segments = value.split('-')
    return segments.length >= 3 ? segments[2] : null
}

function resolveInsertIndex(overId: string, setItem: ModelSet) {
    if (overId.startsWith('set-')) {
        return setItem.members.length
    }
    const groupId = parseMemberGroupId(overId)
    if (!groupId) return setItem.members.length
    const index = setItem.members.findIndex((member) => member.groupId === groupId)
    return index === -1 ? setItem.members.length : index
}

function AvailableGroupItem({ groupId, group, label }: { groupId: string; group?: ModelGroup | null; label: string }) {
    const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
        id: `group-${groupId}`,
        data: {
            type: 'model-group',
            groupId,
            label,
        } satisfies DragItemData,
    })

    const style = transform
        ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
        : undefined

    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            style={style}
            className={cn(
                'flex items-center gap-2 rounded-md border border-muted px-2 py-1 text-xs cursor-grab bg-background',
                isDragging && 'opacity-0'
            )}
        >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
            <ModelGroupLogoIcon group={group} fallbackLabel={label} />
            <span className="truncate">{label}</span>
        </div>
    )
}

function ModelSetCard({
    setItem,
    groups,
    onRenameSet,
    onRemoveSet,
    onSetMembers,
}: {
    setItem: ModelSet
    groups: ModelGroup[]
    onRenameSet: (id: string, name: string) => Promise<RenameSetResult>
    onRemoveSet: (id: string) => void
    onSetMembers: (setId: string, members: ModelSetMember[]) => void
}) {
    const t = useTranslations('settings.ai')
    const [collapsed, setCollapsed] = useState(true)
    const [nameDraft, setNameDraft] = useState(setItem.name)
    const [isEditingName, setIsEditingName] = useState(false)

    const memberIds = setItem.members.map((member) => `member-${setItem.id}-${member.groupId}`)

    const commitNameDraft = async () => {
        const result = await onRenameSet(setItem.id, nameDraft)
        setNameDraft(result.name)
        setIsEditingName(false)
    }

    const removeMember = (groupId: string) => {
        onSetMembers(
            setItem.id,
            setItem.members.filter((member) => member.groupId !== groupId)
        )
    }

    const { setNodeRef, isOver } = useDroppable({ id: `set-${setItem.id}` })

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'rounded-lg border border-muted p-4 space-y-4',
                isOver && 'border-primary/60'
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCollapsed(!collapsed)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={collapsed ? t('expandSet') : t('collapseSet')}
                        >
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {setItem.fixed ? (
                            <div className="text-sm font-semibold">{setItem.name}</div>
                        ) : (
                            <Input
                                value={isEditingName ? nameDraft : setItem.name}
                                onFocus={() => {
                                    setIsEditingName(true)
                                    setNameDraft(setItem.name)
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
                        {t('setOrderHint')} · {t('setSummary', { count: setItem.members.length })}
                    </div>
                </div>

                {!setItem.fixed && (
                    <Button variant="ghost" size="icon" onClick={() => onRemoveSet(setItem.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                        <span className="sr-only">{t('deleteSet')}</span>
                    </Button>
                )}
            </div>

            {collapsed ? (
                <div className="rounded-md border border-dashed border-muted px-3 py-3 text-xs text-muted-foreground">
                    {setItem.members.length === 0 ? t('emptySet') : t('collapsedMembersHint', { count: setItem.members.length })}
                </div>
            ) : (
                <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {setItem.members.length === 0 ? (
                            <div className="rounded-md border border-dashed border-muted px-3 py-3 text-xs text-muted-foreground">
                                {t('emptySet')}
                            </div>
                        ) : (
                            setItem.members.map((member) => {
                                const group = groups.find((item) => item.id === member.groupId)
                                return (
                                    <SetMemberItem
                                        key={`member-${setItem.id}-${member.groupId}`}
                                        setId={setItem.id}
                                        groupId={member.groupId}
                                        group={group}
                                        label={group?.name || member.groupId}
                                        onRemove={() => removeMember(member.groupId)}
                                    />
                                )
                            })
                        )}
                    </div>
                </SortableContext>
            )}
        </div>
    )
}

function SetMemberItem({
    setId,
    groupId,
    group,
    label,
    onRemove,
}: {
    setId: string
    groupId: string
    group?: ModelGroup | null
    label: string
    onRemove: () => void
}) {
    const t = useTranslations('settings.ai')
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: `member-${setId}-${groupId}`,
        data: {
            type: 'member',
            setId,
            groupId,
        } satisfies DragItemData,
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'flex items-center justify-between rounded-md border border-muted bg-background px-3 py-2 text-xs',
                isDragging && 'opacity-50'
            )}
        >
            <div className="flex items-center gap-2 min-w-0">
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    className="cursor-grab text-muted-foreground hover:text-foreground"
                    aria-label={t('dragPreview')}
                >
                    <GripVertical className="h-3 w-3" />
                </button>
                <ModelGroupLogoIcon group={group} fallbackLabel={label} />
                <span className="truncate">{label}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={onRemove}>
                {t('removeMember')}
            </Button>
        </div>
    )
}
