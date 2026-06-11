'use client'

import { GripVertical, Copy, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { PromptMessage } from '@/lib/prompts'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PromptTemplateEditor } from '@/components/editor/prompts/prompt-template-editor'

function RoleSegment({
    value,
    disabled,
    onChange,
    t,
}: {
    value: 'user' | 'assistant'
    disabled?: boolean
    onChange: (value: 'user' | 'assistant') => void
    t: (key: string) => string
}) {
    return (
        <div className={cn('inline-flex overflow-hidden rounded-md border', disabled && 'opacity-60')}>
            <button
                type="button"
                disabled={disabled}
                className={cn(
                    'px-3 py-1 text-xs font-medium transition-colors',
                    value === 'user' ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'
                )}
                onClick={() => onChange('user')}
            >
                {t('roles.user')}
            </button>
            <button
                type="button"
                disabled={disabled}
                className={cn(
                    'border-l px-3 py-1 text-xs font-medium transition-colors',
                    value === 'assistant' ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'
                )}
                onClick={() => onChange('assistant')}
            >
                {t('roles.ai')}
            </button>
        </div>
    )
}

export function SortableMessageCard({
    message,
    active = false,
    onRoleChange,
    onContentChange,
    onCopy,
    onDelete,
    t,
    insertRequest,
    onEditorFocus,
}: {
    message: PromptMessage
    active?: boolean
    onRoleChange: (role: 'user' | 'assistant') => void
    onContentChange: (content: string) => void
    onCopy: () => void
    onDelete: () => void
    t: (key: string) => string
    insertRequest?: { id: number; text: string } | null
    onEditorFocus?: () => void
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: message.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'rounded-md border bg-card transition-shadow',
                active && 'ring-2 ring-primary/20 border-primary/30 bg-primary/[0.03]',
                isDragging && 'opacity-70 ring-2 ring-primary/30'
            )}
        >
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="rounded p-1 hover:bg-muted"
                        {...attributes}
                        {...listeners}
                        aria-label={t('actions.reorder')}
                    >
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </button>

                    <RoleSegment
                        value={message.role === 'assistant' ? 'assistant' : 'user'}
                        onChange={onRoleChange}
                        t={t}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={onCopy}>
                        <Copy className="h-4 w-4" />
                        {t('actions.copy')}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={onDelete}>
                        <Trash2 className="h-4 w-4" />
                        {t('actions.delete')}
                    </Button>
                </div>
            </div>

            <div className="p-3">
                <PromptTemplateEditor
                    value={message.content ?? ''}
                    onChange={onContentChange}
                    className="h-[270px]"
                    placeholder={t('editor.instructionsPlaceholder')}
                    insertRequest={insertRequest}
                    onEditorFocus={onEditorFocus}
                />
            </div>
        </div>
    )
}
