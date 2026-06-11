'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Milestone, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { TermEntry } from '@/components/editor/terms/types'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { splitTermExperiences } from '@/lib/term-template'

type TermEntryExperiencesTabProps = {
    entry: TermEntry
    onUpdate: (patch: Partial<TermEntry>) => void
}

type ExperienceItem = { id: string; text: string }

// Items carry locally generated ids so dnd-kit can track cards across
// reorders; only the joined text lines are persisted.
type ExperiencesState = { entryId: string; value: string; items: ExperienceItem[] }

let experienceIdCounter = 0
function makeExperienceItems(lines: string[]): ExperienceItem[] {
    return lines.map((text) => ({ id: `experience-${++experienceIdCounter}`, text }))
}

export function TermEntryExperiencesTab({ entry, onUpdate }: TermEntryExperiencesTabProps) {
    const t = useTranslations('editor')
    const externalValue = entry.experiences ?? ''
    const [state, setState] = useState<ExperiencesState>(() => ({
        entryId: entry.id,
        value: externalValue,
        items: makeExperienceItems(splitTermExperiences(externalValue)),
    }))
    if (state.entryId !== entry.id || state.value !== externalValue) {
        setState({
            entryId: entry.id,
            value: externalValue,
            items: makeExperienceItems(splitTermExperiences(externalValue)),
        })
    }
    const items = state.items

    const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
    const [newDraft, setNewDraft] = useState('')

    const colorId = getTermEntryColorId(entry.color)
    const colorClasses = getTermEntryColorClasses(colorId)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const commitItems = (next: ExperienceItem[]) => {
        const cleaned = next
            .map((item) => ({ ...item, text: item.text.replace(/\s+/g, ' ').trim() }))
            .filter((item) => item.text)
        const value = cleaned.map((item) => item.text).join('\n')
        setState({ entryId: entry.id, value, items: cleaned })
        onUpdate({ experiences: value || undefined })
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const fromIndex = items.findIndex((item) => item.id === active.id)
        const toIndex = items.findIndex((item) => item.id === over.id)
        if (fromIndex < 0 || toIndex < 0) return
        commitItems(arrayMove(items, fromIndex, toIndex))
    }

    const commitEdit = () => {
        if (!editing) return
        const draft = editing.draft.trim()
        const current = items.find((item) => item.id === editing.id)
        setEditing(null)
        if (!current || !draft || draft === current.text) return
        commitItems(items.map((item) => (item.id === editing.id ? { ...item, text: draft } : item)))
    }

    const deleteItem = (id: string) => {
        setEditing(null)
        commitItems(items.filter((item) => item.id !== id))
    }

    const addItem = () => {
        const draft = newDraft.trim()
        if (!draft) return
        setNewDraft('')
        commitItems([...items, ...makeExperienceItems([draft])])
    }

    return (
        <div className="p-4">
            <div className="text-xs text-muted-foreground">{t('terms.panel.experiences.help')}</div>

            {items.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed bg-muted/10 px-4 py-8 flex flex-col items-center gap-2 text-center">
                    <Milestone className="h-6 w-6 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">{t('terms.panel.experiences.empty')}</div>
                </div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                        <div className="relative mt-3">
                            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" aria-hidden="true" />
                            <div className="space-y-3">
                                {items.map((item) => (
                                    <SortableExperienceCard
                                        key={item.id}
                                        id={item.id}
                                        text={item.text}
                                        dotClassName={colorClasses.dot}
                                        editing={editing?.id === item.id ? editing.draft : null}
                                        onEditStart={() => setEditing({ id: item.id, draft: item.text })}
                                        onEditChange={(draft) => setEditing({ id: item.id, draft })}
                                        onEditCommit={commitEdit}
                                        onEditCancel={() => setEditing(null)}
                                        onDelete={() => deleteItem(item.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    </SortableContext>
                </DndContext>
            )}

            <div className="relative mt-3 pl-8">
                {items.length > 0 && (
                    <span
                        className="absolute left-[6px] top-1/2 -translate-y-1/2 h-[11px] w-[11px] rounded-full border-2 border-dashed border-muted-foreground/40 bg-background"
                        aria-hidden="true"
                    />
                )}
                <div className="flex items-center gap-2">
                    <Input
                        value={newDraft}
                        placeholder={t('terms.panel.experiences.addPlaceholder')}
                        onChange={(e) => setNewDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                            e.preventDefault()
                            addItem()
                        }}
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        disabled={!newDraft.trim()}
                        onClick={addItem}
                        aria-label={t('terms.panel.experiences.add')}
                        title={t('terms.panel.experiences.add')}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}

type SortableExperienceCardProps = {
    id: string
    text: string
    dotClassName: string
    editing: string | null
    onEditStart: () => void
    onEditChange: (draft: string) => void
    onEditCommit: () => void
    onEditCancel: () => void
    onDelete: () => void
}

function SortableExperienceCard({
    id,
    text,
    dotClassName,
    editing,
    onEditStart,
    onEditChange,
    onEditCommit,
    onEditCancel,
    onDelete,
}: SortableExperienceCardProps) {
    const t = useTranslations('editor')
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn('group/experience relative pl-8', isDragging && 'z-10')}
        >
            <span
                className={cn(
                    'absolute left-[6px] top-3.5 h-[11px] w-[11px] rounded-full ring-2 ring-background',
                    dotClassName
                )}
                aria-hidden="true"
            />
            <div
                className={cn(
                    'rounded-lg border bg-card px-3 py-2 shadow-xs transition-shadow',
                    isDragging ? 'shadow-md opacity-80' : 'group-hover/experience:shadow-sm'
                )}
            >
                {editing !== null ? (
                    <Input
                        autoFocus
                        value={editing}
                        onChange={(e) => onEditChange(e.target.value)}
                        onBlur={onEditCommit}
                        onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                onEditCommit()
                            } else if (e.key === 'Escape') {
                                e.preventDefault()
                                onEditCancel()
                            }
                        }}
                        className="h-8 border-transparent bg-muted/30 px-2 shadow-none focus-visible:bg-background"
                    />
                ) : (
                    <div className="flex items-start gap-1.5">
                        <button
                            type="button"
                            className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground group-hover/experience:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            aria-label={t('terms.panel.experiences.dragHandle')}
                            title={t('terms.panel.experiences.dragHandle')}
                            {...attributes}
                            {...listeners}
                        >
                            <GripVertical className="h-4 w-4" />
                        </button>
                        <div
                            className="min-w-0 flex-1 py-0.5 text-sm leading-relaxed break-words"
                            onDoubleClick={onEditStart}
                        >
                            {text}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/experience:opacity-100 focus-within:opacity-100">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={onEditStart}
                                aria-label={t('terms.panel.experiences.edit')}
                                title={t('terms.panel.experiences.edit')}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={onDelete}
                                aria-label={t('terms.panel.experiences.delete')}
                                title={t('terms.panel.experiences.delete')}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
