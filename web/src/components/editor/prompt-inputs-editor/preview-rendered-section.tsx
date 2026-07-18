'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { PromptTemplateRenderWarning } from '@/lib/prompt-template-render'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollBar } from '@/components/ui/scroll-area'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { countWordsByLanguage } from '@/lib/word-count'
import { cn } from '@/lib/utils'
import { ChevronDown, Copy } from 'lucide-react'

function formatFence(text: string) {
    const matches = text.match(/`+/g) ?? []
    const longest = matches.reduce((max, run) => Math.max(max, run.length), 0)
    return '`'.repeat(Math.max(3, longest + 1))
}

function xmlCdataEscape(text: string) {
    return text.replaceAll(']]>', ']]]]><![CDATA[>')
}

function yamlBlockScalar(text: string) {
    if (!text) return "''"
    const normalized = text.replace(/\r\n/g, '\n')
    const indented = normalized
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n')
    return `|-\n${indented}`
}

function formatWarning(t: InputsEditorModel['t'], warning: PromptTemplateRenderWarning) {
    if (warning.type === 'missing_input') return t('advanced.preview.warningMissingInput', { name: warning.name })
    if (warning.type === 'invalid_include') return t('advanced.preview.warningInvalidInclude', { name: warning.name })
    if (warning.type === 'include_cycle') return t('advanced.preview.warningIncludeCycle', { name: warning.name })
    if (warning.type === 'include_depth_exceeded') return t('advanced.preview.warningIncludeDepth', { name: warning.name })
    if (warning.type === 'invalid_input_syntax') return t('advanced.preview.warningInvalidInputSyntax', { expr: warning.expr })
    if (warning.type === 'invalid_include_syntax') return t('advanced.preview.warningInvalidIncludeSyntax', { expr: warning.expr })
    if (warning.type === 'unsupported_template_syntax') {
        return t('advanced.preview.warningUnsupportedTemplateSyntax', { expr: warning.expr })
    }
    if (warning.type === 'unclosed_template_expr') return t('advanced.preview.warningUnclosedTemplateExpr', { pos: warning.pos })
    if (warning.type === 'unsupported_variable_expr') {
        return t('advanced.preview.warningUnsupportedVariableExpr', { expr: warning.expr })
    }
    const unknownWarning = warning as unknown as { type?: string; name?: string }
    return `${unknownWarning.type ?? 'warning'}: ${unknownWarning.name ?? ''}`.trim()
}

export function PreviewRenderedSection({
    model,
    showInputs,
    fillHeight = false,
}: {
    model: InputsEditorModel
    showInputs: boolean
    fillHeight?: boolean
}) {
    const { t, renderedMessages, renderedWarnings, missingRequiredInputNames, novelLanguage } = model
    const tCommon = useTranslations('common')

    const renderedHistory = useMemo(() => {
        return renderedMessages.map((message) => ({ role: message.role, content: message.content }))
    }, [renderedMessages])

    const totalRenderedWordCount = useMemo(() => {
        return renderedHistory.reduce((sum, message) => sum + countWordsByLanguage(message.content, novelLanguage), 0)
    }, [novelLanguage, renderedHistory])

    const totalRenderedWordCountLabel = useMemo(() => {
        const unit = tCommon(totalRenderedWordCount === 1 ? 'word' : 'words')
        return t('advanced.preview.totalWordCountLabel', {
            count: totalRenderedWordCount.toLocaleString(),
            unit,
        })
    }, [t, tCommon, totalRenderedWordCount])

    const formatRenderedHistory = (format: 'json' | 'yaml' | 'markdown' | 'xml') => {
        if (format === 'json') {
            return JSON.stringify(renderedHistory, null, 2)
        }

        if (format === 'yaml') {
            if (renderedHistory.length === 0) return '[]'
            return renderedHistory
                .map((message) => {
                    const role = String(message.role)
                    return `- role: ${role}\n  content: ${yamlBlockScalar(message.content)}`
                })
                .join('\n')
        }

        if (format === 'xml') {
            const items = renderedHistory
                .map((message) => {
                    const role = String(message.role)
                    const content = xmlCdataEscape(message.content)
                    return `  <message role="${role}"><![CDATA[${content}]]></message>`
                })
                .join('\n')
            return `<messages>\n${items}\n</messages>`
        }

        return renderedHistory
            .map((message) => {
                const fence = formatFence(message.content)
                return `## ${message.role}\n\n${fence}text\n${message.content}\n${fence}`
            })
            .join('\n\n')
    }

    const handleCopyRenderedHistory = async (format: 'json' | 'yaml' | 'markdown' | 'xml') => {
        try {
            await navigator.clipboard.writeText(formatRenderedHistory(format))
        } catch (e) {
            console.error(e)
        }
    }

    return (
        <>
            {showInputs && <div className="h-px bg-border" />}

            <div className={cn('min-w-0', fillHeight && 'flex min-h-0 flex-1 flex-col')}>
                <div className="space-y-2">
                    <div className="text-sm font-medium">{t('advanced.preview.renderedTitle')}</div>
                    <div className="text-xs text-muted-foreground">{t('advanced.preview.renderedHint')}</div>

                    {renderedWarnings.length > 0 && (
                        <div className="rounded-md border bg-yellow-50 px-3 py-3 text-sm text-yellow-900 space-y-2 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200">
                            <div className="font-medium">{t('advanced.preview.warningsTitle')}</div>
                            <ul className="list-disc pl-5 text-xs text-yellow-900/80 space-y-1 min-w-0 dark:text-yellow-300">
                                {renderedWarnings.map((warning) => (
                                    <li key={`${warning.type}:${warning.name}`} className="[overflow-wrap:anywhere]">
                                        {formatWarning(t, warning)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1 min-w-0">
                                    <Copy className="h-4 w-4" />
                                    {t('actions.copyToClipboard')}
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuLabel>{t('actions.copyToClipboard')}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => void handleCopyRenderedHistory('json')}>JSON</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void handleCopyRenderedHistory('yaml')}>YAML</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void handleCopyRenderedHistory('markdown')}>Markdown</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void handleCopyRenderedHistory('xml')}>XML</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <div className="ml-auto min-w-0 text-sm text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                            {totalRenderedWordCountLabel}
                        </div>
                    </div>
                </div>

                <ScrollAreaPrimitive.Root
                    type="auto"
                    className={cn(
                        'min-w-0 overflow-hidden',
                        fillHeight ? 'mt-3 min-h-0 flex-1' : 'mt-2 max-h-[60vh]'
                    )}
                >
                    <ScrollAreaPrimitive.Viewport
                        className={cn(
                            'w-full min-w-0 overscroll-contain [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full',
                            fillHeight ? 'h-full' : 'max-h-[60vh]'
                        )}
                    >
                        <div className="space-y-3 min-w-0 w-full">
                            {renderedMessages.map((message, idx) => {
                                const roleLabel =
                                    message.role === 'system'
                                        ? t('badges.system')
                                        : message.role === 'assistant'
                                            ? t('roles.ai')
                                            : t('roles.user')
                                const missingRequiredLabel =
                                    idx === 0 && missingRequiredInputNames.length > 0
                                        ? t('advanced.preview.missingRequiredBadge', {
                                              names: missingRequiredInputNames.join(', '),
                                          })
                                        : null

                                const wordCount = countWordsByLanguage(message.content, novelLanguage)
                                const wordUnit = tCommon(wordCount === 1 ? 'word' : 'words')

                                return (
                                    <div
                                        key={message.id}
                                        className={cn(
                                            'rounded-md border bg-background py-3 pl-3 pr-2 space-y-2 min-w-0',
                                            fillHeight && 'flex min-h-0 flex-col'
                                        )}
                                    >
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <div className="min-w-0 flex flex-wrap items-center gap-2">
                                                <Badge variant="secondary" className="text-sm px-3 py-1">
                                                    {roleLabel}
                                                </Badge>
                                                {missingRequiredLabel && (
                                                    <Badge
                                                        variant="destructive"
                                                        className="text-sm px-3 py-1 min-w-0 max-w-full shrink whitespace-normal break-words [overflow-wrap:anywhere]"
                                                    >
                                                        {missingRequiredLabel}
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="ml-auto min-w-0 flex flex-wrap items-center justify-end gap-2">
                                                <span className="text-xs text-muted-foreground tabular-nums">
                                                    {wordCount.toLocaleString()} {wordUnit}
                                                </span>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-1 min-w-0"
                                                    onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(message.content)
                                                        } catch (e) {
                                                            console.error(e)
                                                        }
                                                    }}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                    {t('actions.copy')}
                                                </Button>
                                            </div>
                                        </div>
                                        <ScrollAreaPrimitive.Root
                                            type="auto"
                                            className={cn(
                                                'min-w-0 overflow-hidden rounded-md',
                                                fillHeight ? 'max-h-[360px]' : 'max-h-[280px]'
                                            )}
                                        >
                                            <ScrollAreaPrimitive.Viewport
                                                className={cn(
                                                    'w-full min-w-0 [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full',
                                                    fillHeight ? 'max-h-[360px]' : 'max-h-[280px]'
                                                )}
                                            >
                                                <pre className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] pr-3 font-mono text-xs leading-relaxed">
                                                    {message.content}
                                                </pre>
                                            </ScrollAreaPrimitive.Viewport>
                                            <ScrollBar />
                                            <ScrollAreaPrimitive.Corner />
                                        </ScrollAreaPrimitive.Root>
                                    </div>
                                )
                            })}
                        </div>
                    </ScrollAreaPrimitive.Viewport>
                    <ScrollBar />
                    <ScrollAreaPrimitive.Corner />
                </ScrollAreaPrimitive.Root>
            </div>
        </>
    )
}
