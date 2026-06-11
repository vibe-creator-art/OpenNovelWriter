'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Copy, MessageSquareText, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEditorChatStore, type EditorChatConversation, EDITOR_CHAT_FALLBACK_NOVEL_ID } from '@/components/editor/editor-chat-store'
import { cn } from '@/lib/utils'

type LeftPanelChatsProps = {
    novelId?: string
    isCompact: boolean
}

const EMPTY_CONVERSATIONS: EditorChatConversation[] = []

function formatConversationTime(updatedAt: string) {
    const date = new Date(updatedAt)
    if (Number.isNaN(date.getTime())) return ''

    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    return new Intl.DateTimeFormat(undefined, sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric' }).format(date)
}

function getConversationPreview(conversation: EditorChatConversation, fallback: string) {
    const lastMessage = [...conversation.messages].reverse().find((message) => message.content.trim())
    return lastMessage?.content.trim().replace(/\s+/g, ' ') ?? fallback
}

export function LeftPanelChats({ novelId, isCompact }: LeftPanelChatsProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const novelKey = novelId?.trim() || EDITOR_CHAT_FALLBACK_NOVEL_ID
    const session = useEditorChatStore((state) => state.sessionsByNovel[novelKey])
    const createConversation = useEditorChatStore((state) => state.createConversation)
    const loadConversations = useEditorChatStore((state) => state.loadConversations)
    const selectConversation = useEditorChatStore((state) => state.selectConversation)
    const renameConversation = useEditorChatStore((state) => state.renameConversation)
    const cloneConversation = useEditorChatStore((state) => state.cloneConversation)
    const deleteConversation = useEditorChatStore((state) => state.deleteConversation)

    const conversations = session?.conversations ?? EMPTY_CONVERSATIONS
    const selectedChatId = session?.selectedChatId ?? null
    const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
    const [renamingValue, setRenamingValue] = useState('')
    const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null)

    useEffect(() => {
        void loadConversations(novelId)
    }, [loadConversations, novelId])

    const orderedConversations = useMemo(
        () =>
            [...conversations].sort((left, right) => {
                if (left.updatedAt === right.updatedAt) return 0
                return left.updatedAt < right.updatedAt ? 1 : -1
            }),
        [conversations]
    )
    const renamingConversation =
        orderedConversations.find((conversation) => conversation.id === renamingConversationId) ?? null
    const deletingConversation =
        orderedConversations.find((conversation) => conversation.id === deleteConversationId) ?? null

    const startRenamingConversation = (conversation: EditorChatConversation) => {
        setRenamingConversationId(conversation.id)
        setRenamingValue(conversation.title?.trim() || t('sidebar.chatUntitled'))
    }

    const submitRenamingConversation = () => {
        if (!renamingConversationId) return
        const title = renamingValue.trim()
        if (!title) return
        void renameConversation(novelId, renamingConversationId, title)
        setRenamingConversationId(null)
        setRenamingValue('')
    }

    const cancelRenamingConversation = () => {
        setRenamingConversationId(null)
        setRenamingValue('')
    }

    return (
        <>
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="border-b p-2">
                    <Button
                        type="button"
                        size="sm"
                        variant={orderedConversations.length > 0 ? 'outline' : 'default'}
                        className="w-full justify-start gap-2"
                        onClick={() => {
                            void (async () => {
                                const conversationId = await createConversation(novelId)
                                selectConversation(novelId, conversationId)
                            })()
                        }}
                    >
                        <Plus className="h-4 w-4" />
                        {!isCompact && <span>{t('sidebar.chatNew')}</span>}
                    </Button>
                </div>

                {orderedConversations.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <MessageSquareText className="h-5 w-5" />
                        </div>
                        {!isCompact && (
                            <>
                                <div className="text-sm font-medium">{t('sidebar.chatEmptyTitle')}</div>
                                <div className="text-xs leading-5 text-muted-foreground">{t('sidebar.chatEmptyDescription')}</div>
                            </>
                        )}
                    </div>
                ) : (
                    <ScrollArea className="min-w-0 flex-1 overflow-hidden">
                        <div className="min-w-0 space-y-1 p-2">
                            {orderedConversations.map((conversation) => {
                                const isSelected = conversation.id === selectedChatId
                                const isRenaming = renamingConversation?.id === conversation.id

                                return (
                                    <div
                                        key={conversation.id}
                                        role="button"
                                        tabIndex={0}
                                        className={cn(
                                            'group box-border h-12 w-full max-w-full min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset',
                                            !isCompact && 'h-16',
                                            isSelected
                                                ? 'border-primary bg-primary/6 ring-1 ring-primary/20 ring-inset'
                                                : 'border-transparent hover:border-border hover:bg-muted/60'
                                        )}
                                        onClick={() => selectConversation(novelId, conversation.id)}
                                        onKeyDown={(event) => {
                                            if (event.key !== 'Enter' && event.key !== ' ') return
                                            event.preventDefault()
                                            selectConversation(novelId, conversation.id)
                                        }}
                                    >
                                        <div
                                            className={cn(
                                                'grid h-full min-w-0 max-w-full gap-x-2 overflow-hidden',
                                                isCompact
                                                    ? 'grid-cols-[minmax(0,1fr)_auto] items-center'
                                                    : 'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto]'
                                            )}
                                        >
                                            {isRenaming ? (
                                                <div
                                                    className="col-span-2 flex min-w-0 items-center gap-1"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <Input
                                                        value={renamingValue}
                                                        onChange={(event) => setRenamingValue(event.target.value)}
                                                        autoFocus
                                                        className="h-8 min-w-0 flex-1 bg-background text-sm"
                                                        maxLength={120}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault()
                                                                submitRenamingConversation()
                                                            } else if (event.key === 'Escape') {
                                                                event.preventDefault()
                                                                cancelRenamingConversation()
                                                            }
                                                        }}
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="icon-sm"
                                                        variant="ghost"
                                                        className="h-8 w-8"
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            submitRenamingConversation()
                                                        }}
                                                        disabled={!renamingValue.trim()}
                                                        title={tCommon('save')}
                                                        aria-label={tCommon('save')}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="icon-sm"
                                                        variant="ghost"
                                                        className="h-8 w-8"
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            cancelRenamingConversation()
                                                        }}
                                                        title={tCommon('cancel')}
                                                        aria-label={tCommon('cancel')}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="min-w-0">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <span className="block min-w-0 flex-1 truncate text-sm font-medium">
                                                                {conversation.title || t('sidebar.chatUntitled')}
                                                            </span>
                                                            {!isCompact && (
                                                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                                                    {formatConversationTime(conversation.updatedAt)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div
                                                        className={cn(
                                                            'flex h-7 shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100',
                                                            !isCompact && 'mt-px',
                                                            isSelected && 'opacity-100'
                                                        )}
                                                        onClick={(event) => event.stopPropagation()}
                                                    >
                                                        <Button
                                                            type="button"
                                                            size="icon-sm"
                                                            variant="ghost"
                                                            className="h-7 w-7"
                                                            onClick={() => startRenamingConversation(conversation)}
                                                            title={t('infoPanel.chatRename')}
                                                            aria-label={t('infoPanel.chatRename')}
                                                        >
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="icon-sm"
                                                            variant="ghost"
                                                            className="h-7 w-7"
                                                            onClick={() => void cloneConversation(novelId, conversation.id)}
                                                            title={t('infoPanel.chatClone')}
                                                            aria-label={t('infoPanel.chatClone')}
                                                        >
                                                            <Copy className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="icon-sm"
                                                            variant="ghost"
                                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                                            onClick={() => setDeleteConversationId(conversation.id)}
                                                            title={t('infoPanel.chatDelete')}
                                                            aria-label={t('infoPanel.chatDelete')}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>

                                                    {!isCompact && (
                                                        <div className="col-span-2 mt-0.5 block min-w-0 truncate text-xs leading-4 text-muted-foreground">
                                                            {getConversationPreview(conversation, t('sidebar.chatNoMessages'))}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </ScrollArea>
                )}
            </div>

            <AlertDialog open={!!deletingConversation} onOpenChange={(open) => !open && setDeleteConversationId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('infoPanel.chatDeleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('infoPanel.chatDeleteConfirmDescription', {
                                title: deletingConversation?.title?.trim() || t('sidebar.chatUntitled'),
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90"
                            onClick={() => {
                                if (!deleteConversationId) return
                                void deleteConversation(novelId, deleteConversationId)
                                setDeleteConversationId(null)
                            }}
                        >
                            {t('infoPanel.chatDelete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
