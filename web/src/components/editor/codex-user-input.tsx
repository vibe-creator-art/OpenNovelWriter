'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, CircleHelp, Loader2, Pencil, X } from 'lucide-react'
import type { CodexUserInputRequest, CodexUserInputResponse } from '@/lib/codex-user-input'
import { cn } from '@/lib/utils'

export function CodexUserInputPanel({ request, onAnswer, onExpired }: {
    request: CodexUserInputRequest
    onAnswer: (response: CodexUserInputResponse) => Promise<void>
    onExpired: () => Promise<void>
}) {
    const t = useTranslations('editor.codex.questions')
    const [hidden, setHidden] = useState(false)
    const [index, setIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, { option: string | null; text: string }>>({})
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const question = request.questions[index]
    const waitsForResponse = request.delivery === 'tool-response'
    const current = answers[question.id] ?? { option: null, text: '' }
    const complete = request.questions.every((item) => answers[item.id]?.option || answers[item.id]?.text.trim())

    const submit = async (skip = false) => {
        if (submitting) return
        setSubmitting(true)
        setError(null)
        try {
            await onAnswer({ answers: skip ? {} : Object.fromEntries(request.questions.map((item) => [
                item.id, { answers: [answers[item.id].text.trim() || answers[item.id].option!] },
            ])) })
        } catch (error) {
            setError(error instanceof Error ? error.message : t('failed'))
            await onExpired().catch(() => {})
        } finally {
            setSubmitting(false)
        }
    }

    if (hidden) return (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setHidden(false)} className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm hover:bg-muted">
                <CircleHelp className="h-4 w-4" aria-hidden="true" />{t('reopen')}
            </button>
            {waitsForResponse && <span className="text-xs text-muted-foreground">{t('waiting')}</span>}
        </div>
    )

    return (
        <section className="mb-3 min-w-0 rounded-[1.6rem] border bg-background p-3 sm:p-4" aria-label={t('title')} data-codex-question={request.id}>
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                <span>{t('title')}</span>
                {request.questions.length > 1 && <span>{t('progress', { current: index + 1, total: request.questions.length })}</span>}
                <button type="button" onClick={() => setHidden(true)} disabled={submitting} className="ml-auto rounded-full p-1 hover:bg-muted" aria-label={t('hide')}>
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
            <p className="mb-3 whitespace-pre-wrap break-words text-sm leading-6" id={`question-${request.id}-${index}`}>{question.question}</p>
            <div className="max-h-64 space-y-1 overflow-y-auto" role="radiogroup" aria-labelledby={`question-${request.id}-${index}`}>
                {question.options?.map((option, optionIndex) => (
                    <button
                        key={optionIndex}
                        type="button"
                        role="radio"
                        aria-checked={current.option === option.label}
                        disabled={submitting}
                        onClick={() => setAnswers((values) => ({ ...values, [question.id]: { option: option.label, text: '' } }))}
                        className={cn('flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring', current.option === option.label && 'bg-muted')}
                    >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted/50 text-xs text-muted-foreground">
                            {current.option === option.label ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : optionIndex + 1}
                        </span>
                        <span className="min-w-0 pt-0.5">
                            <span className="block break-words text-sm">{option.label}</span>
                            {option.description && <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{option.description}</span>}
                        </span>
                    </button>
                ))}
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2 rounded-2xl bg-muted/70 px-3 py-2">
                <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                    type={question.isSecret ? 'password' : 'text'}
                    aria-label={t('freeText')}
                    placeholder={t('freeText')}
                    value={current.text}
                    disabled={submitting}
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/70"
                    onChange={(event) => setAnswers((values) => ({ ...values, [question.id]: { option: null, text: event.target.value } }))}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            if (complete) void submit()
                            else if (current.text.trim() && index < request.questions.length - 1) setIndex(index + 1)
                        }
                    }}
                />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {request.questions.length > 1 && <>
                    <button type="button" disabled={index === 0 || submitting} onClick={() => setIndex(index - 1)} className="rounded-full border px-3 py-1.5 text-sm disabled:opacity-40">{t('back')}</button>
                    <button type="button" disabled={index === request.questions.length - 1 || submitting} onClick={() => setIndex(index + 1)} className="rounded-full border px-3 py-1.5 text-sm disabled:opacity-40">{t('next')}</button>
                </>}
                <button type="button" disabled={submitting} onClick={() => waitsForResponse ? void submit(true) : setHidden(true)} className="ml-auto rounded-full border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40">
                    {t(waitsForResponse ? 'skipContinue' : 'skip')}
                </button>
                <button type="button" disabled={!complete || submitting} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40">
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('send')}
                </button>
            </div>
            {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
        </section>
    )
}
