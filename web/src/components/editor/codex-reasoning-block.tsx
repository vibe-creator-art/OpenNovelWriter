'use client'

import { memo, useId } from 'react'
import { useTranslations } from 'next-intl'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import type { CodexSessionMessage } from '@/lib/api'
import { renderSimpleMarkdown } from '@/lib/simple-markdown'

export const CodexReasoningBlock = memo(function CodexReasoningBlock({ message, running, expanded, onExpandedChange }: {
    message: CodexSessionMessage
    running: boolean
    expanded: boolean | undefined
    onExpandedChange: (id: string, expanded: boolean) => void
}) {
    const t = useTranslations('editor.codex.reasoningBlock')
    const detailsId = useId()
    const active = running && message.workStatus === 'running'
    const open = expanded ?? active
    if (!message.content.trim()) return null
    return (
        <div className="min-w-0 rounded-lg border bg-muted/20" data-codex-reasoning={message.id}>
            <button
                type="button"
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-expanded={open}
                aria-controls={open ? detailsId : undefined}
                onClick={() => onExpandedChange(message.id, !open)}
            >
                <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{t(active ? 'thinking' : 'label')}</span>
                {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            {open && (
                <div id={detailsId} className="max-h-80 space-y-2 overflow-auto break-words border-t px-3 py-2 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {renderSimpleMarkdown(message.content)}
                </div>
            )}
        </div>
    )
})
