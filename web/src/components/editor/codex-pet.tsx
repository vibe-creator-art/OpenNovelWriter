'use client'

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from 'react'
import {
    Check,
    ChevronDown,
    CircleAlert,
    Loader2,
    MessageCircleReply,
    Send,
    Square,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { CodexPetSprite } from '@/components/editor/codex-pet-sprite'
import { useEditorCodexStore } from '@/components/editor/editor-codex-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { codexSessionApi, petApi, type CodexSession } from '@/lib/api'
import type { PetAnimationName, PetSummary } from '@/lib/pets'
import { cn } from '@/lib/utils'

type TrayMode = 'expanded' | 'summary' | 'compact'
type ActivityStatus = 'needs-input' | 'blocked' | 'ready' | 'running'
type PetActivity = { session: CodexSession; status: ActivityStatus }
type PetPosition = { x: number; bottom: number }
type PetDragState = {
    pointerId: number
    startClientX: number
    startClientY: number
    startPosition: PetPosition
    currentPosition: PetPosition
    lastClientX: number
}

const EMPTY_SESSIONS: CodexSession[] = []
const PET_POSITION_STORAGE_KEY = 'onw.codexPet.position'
const VIEWPORT_MARGIN = 8
const STATUS_PRIORITY: Record<ActivityStatus, number> = {
    'needs-input': 0,
    blocked: 1,
    ready: 2,
    running: 3,
}

type CodexPetProps = {
    novelId: string
    petId: string
    onOpenSession: (sessionId: string) => void
}

export function CodexPet({ novelId, petId, onOpenSession }: CodexPetProps) {
    const t = useTranslations('editor.codex.pet')
    const sessionState = useEditorCodexStore((state) => state.sessionsByNovel[novelId])
    const pendingApprovals = useEditorCodexStore((state) => state.pendingApprovalsBySession)
    const loadSessions = useEditorCodexStore((state) => state.loadSessions)
    const selectSession = useEditorCodexStore((state) => state.selectSession)
    const stopSession = useEditorCodexStore((state) => state.stop)
    const sendMessage = useEditorCodexStore((state) => state.sendMessage)
    const [pets, setPets] = useState<PetSummary[]>([])
    const [trayMode, setTrayMode] = useState<TrayMode>('summary')
    const [followUpSessionId, setFollowUpSessionId] = useState<string | null>(null)
    const [followUp, setFollowUp] = useState('')
    const [sending, setSending] = useState(false)
    const [position, setPosition] = useState<PetPosition | null>(null)
    const [dragAnimation, setDragAnimation] = useState<PetAnimationName | null>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<PetDragState | null>(null)

    useEffect(() => {
        void loadSessions(novelId)
    }, [loadSessions, novelId])

    useEffect(() => {
        let active = true
        void petApi.list()
            .then((result) => {
                if (active) setPets(result.pets)
            })
            .catch((error) => console.error('Failed to load Codex pet:', error))
        return () => {
            active = false
        }
    }, [petId])

    const pet = pets.find((item) => item.id === petId) ?? null
    const sessions = sessionState?.sessions ?? EMPTY_SESSIONS
    const activities = useMemo(() => sessions
        .map((session): PetActivity | null => {
            if (pendingApprovals[session.id]) return { session, status: 'needs-input' }
            if (session.status === 'error') return { session, status: 'blocked' }
            if (session.unreadCompletionAt) return { session, status: 'ready' }
            if (session.status === 'running') return { session, status: 'running' }
            return null
        })
        .filter((activity): activity is PetActivity => activity !== null)
        .sort((left, right) =>
            STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
            || new Date(right.session.updatedAt).getTime() - new Date(left.session.updatedAt).getTime()
        ), [pendingApprovals, sessions])

    useEffect(() => {
        if (!pet) return
        const frame = window.requestAnimationFrame(() => {
            const root = rootRef.current
            if (!root) return
            const rect = root.getBoundingClientRect()
            const storedPosition = readStoredPetPosition()
            setPosition(clampPetPosition(storedPosition ?? {
                x: rect.left,
                bottom: window.innerHeight - rect.bottom,
            }, root))
        })
        return () => window.cancelAnimationFrame(frame)
    }, [pet])

    useEffect(() => {
        if (!pet) return
        const root = rootRef.current
        if (!root) return
        const keepInViewport = () => {
            setPosition((current) => current ? clampPetPosition(current, root) : current)
        }
        const observer = new ResizeObserver(keepInViewport)
        observer.observe(root)
        window.addEventListener('resize', keepInViewport)
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', keepInViewport)
        }
    }, [pet])

    if (!pet) return null

    const primaryActivity = activities[0] ?? null
    const animation = dragAnimation ?? activityAnimation(primaryActivity?.status)
    const visibleActivities = trayMode === 'expanded' ? activities : activities.slice(0, 1)

    const openSession = (sessionId: string) => {
        selectSession(novelId, sessionId)
        onOpenSession(sessionId)
    }

    const submitFollowUp = async (activity: PetActivity) => {
        const content = followUp.trim()
        if (!content || sending) return
        setSending(true)
        try {
            if (activity.session.status === 'running') {
                await codexSessionApi.steerMessage(activity.session.id, content)
            } else {
                await sendMessage(novelId, activity.session.id, content)
            }
            setFollowUp('')
            setFollowUpSessionId(null)
        } catch (error) {
            console.error('Failed to send Codex pet follow-up:', error)
        } finally {
            setSending(false)
        }
    }

    const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        const root = rootRef.current
        if (!root) return
        const rect = root.getBoundingClientRect()
        const startPosition = clampPetPosition(position ?? {
            x: rect.left,
            bottom: window.innerHeight - rect.bottom,
        }, root)
        dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPosition,
            currentPosition: startPosition,
            lastClientX: event.clientX,
        }
        setPosition(startPosition)
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
    }

    const continueDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        const root = rootRef.current
        if (!drag || drag.pointerId !== event.pointerId || !root) return
        const nextPosition = clampPetPosition({
            x: drag.startPosition.x + event.clientX - drag.startClientX,
            bottom: drag.startPosition.bottom - (event.clientY - drag.startClientY),
        }, root)
        const horizontalMovement = event.clientX - drag.lastClientX
        if (Math.abs(horizontalMovement) >= 1) {
            setDragAnimation(horizontalMovement > 0 ? 'running-right' : 'running-left')
        }
        drag.currentPosition = nextPosition
        drag.lastClientX = event.clientX
        setPosition(nextPosition)
    }

    const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        savePetPosition(drag.currentPosition)
        setDragAnimation(null)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    return (
        <div
            ref={rootRef}
            className={cn(
                'pointer-events-none fixed z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col items-center',
                !position && 'bottom-5 right-5'
            )}
            style={position ? { left: position.x, bottom: position.bottom } : undefined}
        >
            {trayMode !== 'compact' && activities.length > 0 && (
                <div className="pointer-events-auto mb-1 w-full">
                    <div className={cn('space-y-2', trayMode === 'expanded' && 'max-h-[300px] overflow-y-auto p-1')}>
                        {visibleActivities.map((activity, index) => (
                            <ActivityCard
                                key={activity.session.id}
                                activity={activity}
                                followUpOpen={followUpSessionId === activity.session.id}
                                followUp={followUp}
                                sending={sending}
                                stacked={trayMode === 'summary' && activities.length > 1 && index === 0}
                                t={t}
                                onCardClick={() => {
                                    if (trayMode === 'summary' && activities.length > 1) {
                                        setTrayMode('expanded')
                                    } else {
                                        openSession(activity.session.id)
                                    }
                                }}
                                onFollowUp={() => {
                                    setFollowUpSessionId((current) => current === activity.session.id ? null : activity.session.id)
                                    setFollowUp('')
                                }}
                                onFollowUpChange={setFollowUp}
                                onSubmit={() => void submitFollowUp(activity)}
                                onStop={() => void stopSession(novelId, activity.session.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div
                className="pointer-events-auto cursor-grab touch-none select-none active:cursor-grabbing"
                title={t('drag')}
                onPointerDown={startDragging}
                onPointerMove={continueDragging}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onLostPointerCapture={stopDragging}
            >
                <CodexPetSprite
                    spriteUrl={pet.spriteUrl}
                    animation={animation}
                    width={154}
                    label={pet.displayName}
                    className="drop-shadow-[0_8px_10px_rgba(15,23,42,0.22)]"
                />
            </div>

            {trayMode === 'compact' ? (
                <button
                    type="button"
                    className="pointer-events-auto group mt-1 flex h-7 w-8 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setTrayMode('summary')}
                    title={t('showSummary')}
                    aria-label={t('showSummary')}
                >
                    <span className={cn(
                        'flex h-1.5 w-5 items-center justify-center overflow-hidden rounded-full border shadow-sm transition-all duration-150 group-hover:h-7 group-hover:w-7',
                        activities.length > 0
                            ? 'border-emerald-600/40 bg-emerald-500 text-white'
                            : 'border-border bg-white text-foreground'
                    )}>
                        <span className="text-xs font-semibold opacity-0 transition-opacity group-hover:opacity-100">
                            {activities.length}
                        </span>
                    </span>
                </button>
            ) : (
                <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="pointer-events-auto mt-1 h-9 w-9 rounded-full border bg-background/80 shadow-lg backdrop-blur"
                    onClick={() => setTrayMode(trayMode === 'expanded' ? 'summary' : 'compact')}
                    title={trayMode === 'expanded' ? t('showSummary') : t('minimize')}
                    aria-label={trayMode === 'expanded' ? t('showSummary') : t('minimize')}
                >
                    <ChevronDown className="h-5 w-5" />
                </Button>
            )}
        </div>
    )
}

function ActivityCard({
    activity,
    followUpOpen,
    followUp,
    sending,
    stacked,
    t,
    onCardClick,
    onFollowUp,
    onFollowUpChange,
    onSubmit,
    onStop,
}: {
    activity: PetActivity
    followUpOpen: boolean
    followUp: string
    sending: boolean
    stacked: boolean
    t: ReturnType<typeof useTranslations<'editor.codex.pet'>>
    onCardClick: () => void
    onFollowUp: () => void
    onFollowUpChange: (value: string) => void
    onSubmit: () => void
    onStop: () => void
}) {
    const title = getSessionTitle(activity.session, t('untitled'))
    const preview = getSessionPreview(activity.session, t(`status.${activity.status}`))
    const StatusIcon = activity.status === 'running'
        ? Loader2
        : activity.status === 'blocked'
            ? CircleAlert
            : Check

    return (
        <div className={cn('relative', stacked && 'mb-3')}>
            {stacked && (
                <div className="absolute inset-x-3 -bottom-3 h-8 rounded-[24px] border bg-background/55 shadow-sm backdrop-blur-xl" />
            )}
            <div
                role="button"
                tabIndex={0}
                className="group relative rounded-[26px] border bg-background/82 px-5 py-4 shadow-xl backdrop-blur-xl transition-colors hover:bg-background/92 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onCardClick}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onCardClick()
                }}
            >
                <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{title}</div>
                        <div className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{preview}</div>
                    </div>
                    <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                            onClick={onFollowUp}
                            title={t('followUp')}
                            aria-label={t('followUp')}
                        >
                            <MessageCircleReply className="h-4 w-4" />
                        </Button>
                        {activity.session.status === 'running' && (
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="h-8 w-8 rounded-full text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                                onClick={onStop}
                                title={t('stop')}
                                aria-label={t('stop')}
                            >
                                <Square className="h-3.5 w-3.5 fill-current" />
                            </Button>
                        )}
                        <span className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full',
                            activity.status === 'blocked'
                                ? 'bg-destructive/12 text-destructive'
                                : activity.status === 'running'
                                    ? 'bg-primary/12 text-primary'
                                    : 'bg-emerald-500/15 text-emerald-600'
                        )}>
                            <StatusIcon className={cn('h-4 w-4', activity.status === 'running' && 'animate-spin')} />
                        </span>
                    </div>
                </div>

                {followUpOpen && (
                    <div
                        className="mt-3 flex items-center gap-2"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Input
                            autoFocus
                            value={followUp}
                            onChange={(event) => onFollowUpChange(event.target.value)}
                            placeholder={t('followUpPlaceholder')}
                            disabled={sending}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') onFollowUp()
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault()
                                    onSubmit()
                                }
                            }}
                        />
                        <Button
                            type="button"
                            size="icon"
                            className="shrink-0"
                            disabled={!followUp.trim() || sending}
                            onClick={onSubmit}
                            title={t('send')}
                            aria-label={t('send')}
                        >
                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

function getSessionTitle(session: CodexSession, fallback: string) {
    if (session.title?.trim()) return session.title.trim()
    const latestUser = [...session.messages].reverse().find((message) => message.role === 'user' && message.content.trim())
    return latestUser?.content.trim().replace(/\s+/g, ' ').slice(0, 60) || fallback
}

function getSessionPreview(session: CodexSession, fallback: string) {
    const message = [...session.messages].reverse().find((item) => item.role !== 'event' && item.content.trim())
    return message?.content.trim().replace(/\s+/g, ' ') || fallback
}

function activityAnimation(status: ActivityStatus | undefined): PetAnimationName {
    if (status === 'needs-input') return 'waiting'
    if (status === 'blocked') return 'failed'
    if (status === 'ready') return 'jumping'
    if (status === 'running') return 'running'
    return 'idle'
}

function clampPetPosition(position: PetPosition, root: HTMLDivElement): PetPosition {
    const rect = root.getBoundingClientRect()
    const maximumX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN)
    const maximumBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN)
    return {
        x: Math.min(Math.max(position.x, VIEWPORT_MARGIN), maximumX),
        bottom: Math.min(Math.max(position.bottom, VIEWPORT_MARGIN), maximumBottom),
    }
}

function readStoredPetPosition(): PetPosition | null {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(PET_POSITION_STORAGE_KEY) ?? 'null')
        if (!value || typeof value !== 'object') return null
        const position = value as Partial<PetPosition>
        if (!Number.isFinite(position.x) || !Number.isFinite(position.bottom)) return null
        return { x: position.x as number, bottom: position.bottom as number }
    } catch {
        return null
    }
}

function savePetPosition(position: PetPosition) {
    try {
        localStorage.setItem(PET_POSITION_STORAGE_KEY, JSON.stringify(position))
    } catch {
        // The pet remains draggable when browser storage is unavailable.
    }
}
