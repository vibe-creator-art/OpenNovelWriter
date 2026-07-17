'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bot, Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { useEditorCodexStore } from '@/components/editor/editor-codex-store'
import { cn } from '@/lib/utils'
import type { CodexSession, CodexSessionCategory } from '@/lib/api'

type LeftPanelCodexProps = {
    novelId?: string
    isCompact: boolean
    onOpenCodex: () => void
}

const CATEGORY_ORDER: CodexSessionCategory[] = ['general', 'scene_operation', 'scene_continuation']
const EMPTY_SESSIONS: CodexSession[] = []

function formatSessionTime(updatedAt: string) {
    const date = new Date(updatedAt)
    if (Number.isNaN(date.getTime())) return ''
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    return new Intl.DateTimeFormat(undefined, sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric' }).format(date)
}

function getSessionPreview(session: CodexSession, fallback: string) {
    const lastMessage = [...session.messages].reverse().find((message) => message.role !== 'event' && message.content.trim())
    const content = lastMessage?.content.trim() || session.draftContent.trim()
    return content ? content.replace(/\s+/g, ' ') : fallback
}

export function LeftPanelCodex({ novelId, isCompact, onOpenCodex }: LeftPanelCodexProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const sessionState = useEditorCodexStore((state) => state.sessionsByNovel[novelId?.trim() || '__default__'])
    const loadSessions = useEditorCodexStore((state) => state.loadSessions)
    const createSession = useEditorCodexStore((state) => state.createSession)
    const selectSession = useEditorCodexStore((state) => state.selectSession)
    const deleteSession = useEditorCodexStore((state) => state.deleteSession)
    const [expandedCategories, setExpandedCategories] = useState<Set<CodexSessionCategory>>(
        () => new Set(CATEGORY_ORDER)
    )
    const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null)

    useEffect(() => {
        void loadSessions(novelId)
    }, [loadSessions, novelId])

    const sessions = sessionState?.sessions ?? EMPTY_SESSIONS
    const selectedSessionId = sessionState?.selectedSessionId ?? null
    const deletingSession = sessions.find((session) => session.id === deleteSessionId) ?? null

    const sessionsByCategory = useMemo(() => {
        const map: Record<CodexSessionCategory, CodexSession[]> = {
            general: [],
            scene_operation: [],
            scene_continuation: [],
        }
        sessions.forEach((session) => {
            map[session.category]?.push(session)
        })
        return map
    }, [sessions])

    const toggleCategory = (category: CodexSessionCategory) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev)
            if (next.has(category)) {
                next.delete(category)
            } else {
                next.add(category)
            }
            return next
        })
    }

    const openSession = (sessionId: string) => {
        selectSession(novelId, sessionId)
        onOpenCodex()
    }

    return (
        <>
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="border-b p-2">
                    <Button
                        type="button"
                        size="sm"
                        variant={sessionsByCategory.general.length > 0 ? 'outline' : 'default'}
                        className="w-full justify-start gap-2"
                        onClick={() => {
                            void (async () => {
                                const sessionId = await createSession(novelId)
                                if (sessionId) openSession(sessionId)
                            })()
                        }}
                    >
                        <Plus className="h-4 w-4" />
                        {!isCompact && <span>{t('codex.newSession')}</span>}
                    </Button>
                </div>

                <ScrollArea className="min-w-0 flex-1 overflow-hidden">
                    <div className="min-w-0 space-y-3 p-2">
                        {sessionState?.loading && sessions.length === 0 && (
                            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {!isCompact && <span>{tCommon('loading')}</span>}
                            </div>
                        )}

                        {CATEGORY_ORDER.map((category) => {
                            const categorySessions = sessionsByCategory[category]
                            const expanded = expandedCategories.has(category)
                            const canCreate = category === 'general'

                            return (
                                <section key={category} className="min-w-0">
                                    <button
                                        type="button"
                                        className="flex h-7 w-full items-center gap-1 rounded px-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                        onClick={() => toggleCategory(category)}
                                    >
                                        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                        {!isCompact && <span className="truncate">{t(`codex.categories.${category}`)}</span>}
                                        <span className="ml-auto text-[11px]">{categorySessions.length}</span>
                                    </button>

                                    {expanded && (
                                        <div className="mt-1 space-y-1">
                                            {categorySessions.length === 0 ? (
                                                !isCompact && (
                                                    <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                                                        {canCreate ? t('codex.generalEmpty') : t('codex.boundCategoryEmpty')}
                                                    </div>
                                                )
                                            ) : (
                                                categorySessions.map((session) => {
                                                    const selected = session.id === selectedSessionId
                                                    return (
                                                        <div
                                                            key={session.id}
                                                            role="button"
                                                            tabIndex={0}
                                                            className={cn(
                                                                'group box-border h-12 w-full max-w-full min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset',
                                                                !isCompact && 'h-16',
                                                                selected
                                                                    ? 'border-primary bg-primary/6 ring-1 ring-primary/20 ring-inset'
                                                                    : 'border-transparent hover:border-border hover:bg-muted/60'
                                                            )}
                                                            onClick={() => openSession(session.id)}
                                                            onKeyDown={(event) => {
                                                                if (event.key !== 'Enter' && event.key !== ' ') return
                                                                event.preventDefault()
                                                                openSession(session.id)
                                                            }}
                                                        >
                                                            <div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 overflow-hidden">
                                                                <div className="min-w-0">
                                                                    <div className="flex min-w-0 items-center gap-2">
                                                                        <span className="block min-w-0 flex-1 truncate text-sm font-medium">
                                                                            {session.title || t('codex.untitled')}
                                                                        </span>
                                                                        {session.status === 'running' ? (
                                                                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                                                                        ) : session.status === 'idle' && session.messages.length > 0 ? (
                                                                            <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                                        ) : null}
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className={cn(
                                                                        'flex h-7 shrink-0 items-center justify-end opacity-0 transition-opacity group-hover:opacity-100',
                                                                        selected && 'opacity-100'
                                                                    )}
                                                                    onClick={(event) => event.stopPropagation()}
                                                                >
                                                                    <Button
                                                                        type="button"
                                                                        size="icon-sm"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                                                        onClick={() => setDeleteSessionId(session.id)}
                                                                        title={t('codex.deleteSession')}
                                                                        aria-label={t('codex.deleteSession')}
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                                {!isCompact && (
                                                                    <div className="col-span-2 mt-0.5 flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
                                                                        <span className="min-w-0 flex-1 truncate">
                                                                            {getSessionPreview(session, t('codex.noMessages'))}
                                                                        </span>
                                                                        <span className="shrink-0">{formatSessionTime(session.updatedAt)}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </div>
                                    )}
                                </section>
                            )
                        })}

                        {!sessionState?.loading && sessions.length === 0 && !isCompact && (
                            <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                    <Bot className="h-5 w-5" />
                                </div>
                                <div className="text-sm font-medium">{t('codex.emptyTitle')}</div>
                                <div className="text-xs leading-5 text-muted-foreground">{t('codex.emptyDescription')}</div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            <AlertDialog open={!!deletingSession} onOpenChange={(open) => !open && setDeleteSessionId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('codex.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('codex.deleteConfirmDescription', {
                                title: deletingSession?.title?.trim() || t('codex.untitled'),
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90"
                            onClick={() => {
                                if (!deleteSessionId) return
                                void deleteSession(novelId, deleteSessionId)
                                setDeleteSessionId(null)
                            }}
                        >
                            {t('codex.deleteSession')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
