'use client'

import { memo, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, CircleAlert, FilePenLine, Image, Search, Terminal, Wrench } from 'lucide-react'
import type { CodexSessionMessage } from '@/lib/api'
import { formatWorkEventOutput, getWorkEventBody, getWorkEventTitle } from '@/lib/codex-work-events'
import { cn } from '@/lib/utils'
import { CodexSessionIdContext } from '@/components/editor/codex-session-context'
import { useCodexWorkDetailsStore } from '@/components/editor/codex-work-details-store'
import { ImageThumbnails } from '@/components/image/image-thumbnails'

export type WorkGroupState = { expanded: boolean; openItemId: string | null }
export type WorkGroupStates = Record<string, WorkGroupState>
export type ChangeWorkGroup = (id: string, state: WorkGroupState) => void
const closedGroup: WorkGroupState = { expanded: false, openItemId: null }
const previewSize = 4_000

function WorkIcon({ kind }: { kind?: string | null }) {
    const Icon = kind === 'command' ? Terminal : kind === 'file' ? FilePenLine : kind === 'web_search' ? Search : kind === 'image_view' ? Image : Wrench
    return <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
}

function displayTitle(message: CodexSessionMessage) {
    if (message.kind === 'image_view') return getWorkEventBody(message.content).split(/[/\\]/u).at(-1) ?? ''
    return getWorkEventTitle(message.content).replace(/\s+/gu, ' ').trim()
}

function DetailText({ label, value }: { label: string; value: string }) {
    const t = useTranslations('editor.codex.activity')
    const [limit, setLimit] = useState(previewSize)
    return (
        <div className="min-w-0 space-y-1.5">
            <div className="text-xs text-muted-foreground">{label}</div>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 [overflow-wrap:anywhere]">{value.slice(0, limit)}</pre>
            {value.length > limit && (
                <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setLimit((current) => current + 16_000)}>
                    {t('showMore', { count: value.length - limit })}
                </button>
            )}
        </div>
    )
}

const WorkEventDetails = memo(function WorkEventDetails({ message }: { message: CodexSessionMessage }) {
    const t = useTranslations('editor.codex.activity')
    const [raw, setRaw] = useState(false)
    const body = getWorkEventBody(message.content)
    const formatted = useMemo(() => raw ? body : formatWorkEventOutput(body), [body, raw])
    return (
        <div className="my-1 ml-5 min-w-0 space-y-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-muted-foreground" data-work-details>
            {(message.workStatus === 'failed' || message.workStatus === 'declined') && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    {t(message.workStatus)}
                </div>
            )}
            <DetailText label={t(message.kind === 'command' ? 'command' : 'action')} value={getWorkEventTitle(message.content)} />
            {message.toolInput && <DetailText label={t('input')} value={message.toolInput} />}
            {body && body !== message.toolInput && (
                <>
                    <DetailText key={raw ? 'raw' : 'formatted'} label={t('output')} value={formatted} />
                    <button type="button" aria-pressed={raw} className="text-xs underline underline-offset-2 hover:text-foreground" onClick={() => setRaw((current) => !current)}>
                        {t(raw ? 'formattedResult' : 'rawResult')}
                    </button>
                </>
            )}
            <ImageThumbnails urls={message.attachments} className="mt-2" />
        </div>
    )
})

function LazyWorkEventDetails({ message }: { message: CodexSessionMessage }) {
    const t = useTranslations('common')
    const sessionId = useContext(CodexSessionIdContext)
    const details = useCodexWorkDetailsStore((state) => sessionId ? state.details[sessionId]?.[message.id] : undefined)
    const load = useCodexWorkDetailsStore((state) => state.load)
    const version = message.detailVersion
    useEffect(() => {
        if (sessionId && version) void load(sessionId, message.id, version)
    }, [load, message.id, sessionId, version])
    if (!version) return <WorkEventDetails message={message} />
    if (details?.version === version && details.message) return <WorkEventDetails message={details.message} />
    return (
        <div className="my-1 ml-5 space-y-2 rounded-lg border px-3 py-2.5 text-xs text-muted-foreground" role="status">
            {details?.version === version && details.error ? <>
                <div>{details.error}</div>
                <button type="button" className="underline underline-offset-2" onClick={() => { if (sessionId) void load(sessionId, message.id, version) }}>{t('retry')}</button>
            </> : t('loading')}
        </div>
    )
}

const WorkEventRow = memo(function WorkEventRow({ message, running, open, onToggle }: {
    message: CodexSessionMessage
    running: boolean
    open: boolean
    onToggle: (id: string) => void
}) {
    const t = useTranslations('editor.codex.activity')
    const detailsId = useId()
    const active = running && message.workStatus === 'running'
    const status = message.workStatus === 'running' && !running ? 'stopped' : message.workStatus
    return (
        <div className="min-w-0">
            <button
                type="button"
                className="group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-expanded={open}
                aria-controls={open ? detailsId : undefined}
                onClick={() => onToggle(message.id)}
            >
                <WorkIcon kind={message.kind} />
                <span className={cn('min-w-0 flex-1 truncate', active && 'codex-activity-running')}>{message.kind === 'image_view' ? t('viewedImage', { title: displayTitle(message) }) : displayTitle(message)}</span>
                {(status === 'running' || status === 'stopped') && <span className="shrink-0 text-xs">{t(status)}</span>}
                {open ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
            </button>
            {open && <div id={detailsId}><LazyWorkEventDetails message={message} /></div>}
        </div>
    )
})

export const CodexWorkEventGroup = memo(function CodexWorkEventGroup({ messages, running, state = closedGroup, onChange }: {
    messages: CodexSessionMessage[]
    running: boolean
    state?: WorkGroupState
    onChange: ChangeWorkGroup
}) {
    const t = useTranslations('editor.codex.activity')
    const listId = useId()
    const groupId = messages[0].id
    const activeMessages = running ? messages.filter((message) => message.workStatus === 'running') : []
    const active = activeMessages.at(-1)
    const stoppedCount = running ? 0 : messages.filter((message) => message.workStatus === 'running').length
    const kinds = [...new Set(messages.map((message) => message.kind))]
    const summary = kinds.map((kind) => t(kind === 'command' ? 'commands' : kind === 'file' ? 'files' : kind === 'web_search' ? 'searches' : kind === 'image_view' ? 'imageViews' : 'tools')).join(t('separator'))
    const title = active ? t(active.kind === 'command' ? 'runningCommand' : active.kind === 'web_search' ? 'searching' : active.kind === 'file' ? 'editing' : active.kind === 'image_view' ? 'viewingImage' : 'callingTool', { title: displayTitle(active) }) : summary
    const onToggle = useCallback((id: string) => onChange(groupId, { expanded: true, openItemId: state.openItemId === id ? null : id }), [groupId, onChange, state.openItemId])

    return (
        <div className="min-w-0" data-work-group={groupId}>
            <button
                type="button"
                className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-expanded={state.expanded}
                aria-controls={state.expanded ? listId : undefined}
                onClick={() => onChange(groupId, { ...state, expanded: !state.expanded })}
            >
                <WorkIcon kind={active?.kind ?? messages[0].kind} />
                <span className={cn('min-w-0 truncate', active && 'codex-activity-running')}>{title}</span>
                {activeMessages.length > 1 && <span className="shrink-0 text-xs">{t('moreRunning', { count: activeMessages.length - 1 })}</span>}
                {stoppedCount > 0 && <span className="shrink-0 text-xs">{t('stoppedCount', { count: stoppedCount })}</span>}
                {state.expanded ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            </button>
            {state.expanded && (
                <div id={listId} className="mt-1 max-h-96 min-w-0 space-y-0.5 overflow-y-auto overscroll-contain" role="group" aria-label={summary}>
                    {messages.map((message) => <WorkEventRow key={message.id} message={message} running={running} open={state.openItemId === message.id} onToggle={onToggle} />)}
                </div>
            )}
        </div>
    )
}, (previous, next) => previous.running === next.running && previous.state === next.state && previous.onChange === next.onChange && previous.messages.length === next.messages.length && previous.messages.every((message, index) => message === next.messages[index]))
