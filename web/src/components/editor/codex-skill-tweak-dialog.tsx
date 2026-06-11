'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Eye, Send, SlidersHorizontal, Sparkles } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
import { cn } from '@/lib/utils'
import { promptApi, type Prompt, type Skill } from '@/lib/api'
import { useInputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { PreviewInputCard } from '@/components/editor/prompt-inputs-editor/preview-input-card'
import { PreviewRenderedSection } from '@/components/editor/prompt-inputs-editor/preview-rendered-section'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { buildTermMentionMatcher, findMentionedTermIds } from '@/components/editor/terms/term-mentions-utils'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import type { TermEntry } from '@/components/editor/terms/types'
import { resolveTrackedTermIds } from '@/lib/term-template'

export type CodexRenderedBlock = { role: string; text: string }

interface CodexSkillTweakDialogProps {
    novelId: string
    sessionId: string | null
    /** The mentioned ai_chat skill that has a bound prompt. */
    skill: Skill
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The text the user is composing as the bound prompt's `{{ chat.userInput }}` (lifted so it
     * survives closing the dialog). Term mentions inside it are auto-injected. */
    chatInput: string
    onChatInputChange: (value: string) => void
    /** Reports the resolved conversation blocks (overview + terms already baked in) upward so the
     * composer can ship them as the message's `promptArtifact`. */
    onBlocksChange: (blocks: CodexRenderedBlock[]) => void
    /** Sends the composer message (with the staged artifact) and closes the dialog. */
    onSend: () => void
    disabled?: boolean
}

export function CodexSkillTweakDialog({
    novelId,
    sessionId,
    skill,
    open,
    onOpenChange,
    chatInput,
    onChatInputChange,
    onBlocksChange,
    onSend,
    disabled,
}: CodexSkillTweakDialogProps) {
    const t = useTranslations('editor')
    const tPrompts = useTranslations('prompts')
    const [tab, setTab] = useState<'tweak' | 'preview'>('tweak')
    const [boundPrompt, setBoundPrompt] = useState<Prompt | null>(null)
    const [componentPrompts, setComponentPrompts] = useState<Prompt[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const termEntries = useStoredTermEntries(novelId)
    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry])), [termEntries])
    const termMentionMatcher = useMemo(() => buildTermMentionMatcher(termEntries), [termEntries])

    // Resolve the skill's bound prompt by name (parallel to the scene-continuation panel). The
    // dialog is only mounted for skills that have a bound prompt, so there is nothing to resolve
    // when the name is missing.
    useEffect(() => {
        const promptName = skill.prompt?.trim()
        if (!promptName) return
        let cancelled = false
        const normalized = promptName.toLowerCase()
        void Promise.all([
            promptApi.list().then((result) => result.prompts ?? []).catch(() => [] as Prompt[]),
            promptApi.list({ category: 'component' }).then((result) => result.prompts ?? []).catch(() => [] as Prompt[]),
        ])
            .then(([all, components]) => {
                if (cancelled) return
                setBoundPrompt(all.find((prompt) => prompt.name.trim().toLowerCase() === normalized) ?? null)
                setComponentPrompts(components)
            })
            .catch((error) => {
                if (cancelled) return
                setLoadError(error instanceof Error ? error.message : String(error))
            })
        return () => {
            cancelled = true
        }
    }, [skill.id, skill.prompt])

    const detectedTermIds = useMemo(
        () => findMentionedTermIds(chatInput, termMentionMatcher),
        [chatInput, termMentionMatcher]
    )
    const chatUserInputTermIds = useMemo(
        () => resolveTrackedTermIds({ mentionedTermIds: [...detectedTermIds], termsById: termEntriesById }),
        [detectedTermIds, termEntriesById]
    )
    // The terms detected in the conversation input — shown as chips so the author can see exactly
    // which glossary entries will be injected into the assembled prompt.
    const detectedTermEntries = useMemo(() => {
        const used = [...detectedTermIds]
            .map((id) => termEntriesById.get(id) ?? null)
            .filter((entry): entry is TermEntry => entry !== null)
        used.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
        return used
    }, [detectedTermIds, termEntriesById])

    const previewStateStorageKey = useMemo(
        () => `onw.editor.codex.tweak.${novelId}.${sessionId ?? 'draft'}.${boundPrompt?.id ?? skill.id}`,
        [boundPrompt?.id, novelId, sessionId, skill.id]
    )

    const model = useInputsEditorModel({
        inputDefinitions: boundPrompt?.inputs ?? [],
        disabled: Boolean(disabled),
        onInputDefinitionsChange: () => undefined,
        messages: boundPrompt?.messages ?? [],
        promptId: boundPrompt?.id,
        promptCategory: String(boundPrompt?.category ?? 'ai_chat'),
        allPrompts: componentPrompts ?? undefined,
        novelId,
        previewStateStorageKey,
        chatUserInput: chatInput,
        chatUserInputTerms: chatUserInputTermIds,
    })

    const renderedBlocks = useMemo<CodexRenderedBlock[]>(
        () =>
            model.renderedMessages
                .map((message) => ({ role: message.role, text: message.content }))
                .filter((block) => block.text.trim()),
        [model.renderedMessages]
    )

    // Report blocks upward only when they actually change (renderedBlocks is a fresh array each
    // render); the composer keeps the latest set staged for the next send.
    const lastReportedRef = useRef<string>('')
    useEffect(() => {
        const serialized = JSON.stringify(renderedBlocks)
        if (serialized === lastReportedRef.current) return
        lastReportedRef.current = serialized
        onBlocksChange(renderedBlocks)
    }, [renderedBlocks, onBlocksChange])

    const canSend = renderedBlocks.length > 0 && !disabled

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Sparkles className="h-5 w-5" />
                            {skill.name}
                        </DialogTitle>
                        {loadError && <div className="truncate text-sm text-destructive">{loadError}</div>}
                    </div>

                    <div className="flex items-center gap-2 border-b">
                        <button
                            type="button"
                            className={cn(
                                'inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                                tab === 'tweak'
                                    ? 'border-foreground text-foreground'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                            )}
                            onClick={() => setTab('tweak')}
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                            {tPrompts('advanced.inputs.title')}
                        </button>
                        <button
                            type="button"
                            className={cn(
                                'inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                                tab === 'preview'
                                    ? 'border-foreground text-foreground'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                            )}
                            onClick={() => setTab('preview')}
                        >
                            <Eye className="h-4 w-4" />
                            {tPrompts('advanced.preview.title')}
                        </button>
                    </div>

                    {tab === 'tweak' ? (
                        <div className="space-y-4">
                            <div className="rounded-lg border bg-card p-4 space-y-2">
                                <div className="text-sm font-medium">{t('codexSkillTweak.chatInputLabel')}</div>
                                <AutoResizeTextarea
                                    value={chatInput}
                                    rows={3}
                                    disabled={disabled}
                                    placeholder={t('codexSkillTweak.chatInputPlaceholder')}
                                    className="min-h-20 text-sm"
                                    onChange={(event) => onChatInputChange(event.target.value)}
                                />
                                <div className="text-xs text-muted-foreground">{t('codexSkillTweak.chatInputHint')}</div>
                                {detectedTermEntries.length > 0 && (
                                    <div className="flex flex-wrap gap-1 border-t border-dashed border-muted-foreground/30 pt-2">
                                        {detectedTermEntries.map((entry) => {
                                            const colorId = getTermEntryColorId(entry.color)
                                            const colorClasses = getTermEntryColorClasses(colorId)
                                            const hasCustomColor = colorId !== 'black'
                                            return (
                                                <Badge
                                                    key={entry.id}
                                                    variant="outline"
                                                    className={cn(
                                                        'gap-1 font-medium',
                                                        colorClasses.subtleBg,
                                                        colorClasses.subtleBorder,
                                                        entry.archived && 'opacity-60'
                                                    )}
                                                >
                                                    <span className={cn('leading-none', hasCustomColor && colorClasses.text)}>
                                                        {entry.title}
                                                    </span>
                                                </Badge>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            {model.previewInputs.length === 0 ? (
                                <div className="rounded-md border bg-muted/20 px-3 py-6 text-sm text-muted-foreground text-center">
                                    {tPrompts('advanced.inputs.empty')}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {model.previewInputs.map((input) => (
                                        <PreviewInputCard key={input.id} input={input} model={model} />
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <PreviewRenderedSection model={model} showInputs={false} />
                    )}

                    <div className="flex items-center justify-end gap-2 border-t pt-4">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            {t('codexSkillTweak.done')}
                        </Button>
                        <Button type="button" disabled={!canSend} onClick={onSend} className="gap-2">
                            <Send className="h-4 w-4" />
                            {t('codexSkillTweak.send')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
