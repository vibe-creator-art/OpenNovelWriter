import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { mergeTags, normalizeTagKey, normalizeTagList, parseTagsInput } from '@/components/editor/terms/utils'

type TermEntryTagsProps = {
    tags?: string[]
    allTags?: string[]
    onChange: (nextTags: string[]) => void
}

export function TermEntryTags({ tags, allTags, onChange }: TermEntryTagsProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const normalizedTags = useMemo(() => normalizeTagList(tags), [tags])
    const [draft, setDraft] = useState('')
    const [open, setOpen] = useState(false)

    const draftTokens = useMemo(() => parseTagsInput(draft), [draft])
    const hasDraftTokens = draftTokens.length > 0

    const suggestions = useMemo(() => {
        const available = normalizeTagList(allTags)
        const current = new Set(normalizedTags.map((tag) => normalizeTagKey(tag)))
        return available.filter((tag) => !current.has(normalizeTagKey(tag)))
    }, [allTags, normalizedTags])

    const commitDraft = () => {
        if (!hasDraftTokens) return
        const next = mergeTags(normalizedTags, draftTokens)
        const isSame = next.length === normalizedTags.length && next.every((tag, idx) => tag === normalizedTags[idx])
        setDraft('')
        setOpen(false)
        if (isSame) return
        onChange(next)
    }

    const addExistingTag = (tag: string) => {
        const next = mergeTags(normalizedTags, [tag])
        const isSame = next.length === normalizedTags.length && next.every((t, idx) => t === normalizedTags[idx])
        setOpen(false)
        if (isSame) return
        onChange(next)
    }

    const removeTag = (tag: string) => {
        const key = normalizeTagKey(tag)
        const next = normalizedTags.filter((t) => normalizeTagKey(t) !== key)
        onChange(next)
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            {normalizedTags.map((tag) => (
                <Badge key={normalizeTagKey(tag)} variant="secondary" className="gap-1 pr-1">
                    <span className="max-w-[240px] truncate">{tag}</span>
                    <button
                        type="button"
                        className={cn(
                            'inline-flex items-center justify-center rounded-full',
                            'h-5 w-5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors'
                        )}
                        onClick={() => removeTag(tag)}
                        aria-label={tCommon('delete')}
                        title={tCommon('delete')}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </Badge>
            ))}

            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <Input
                    value={draft}
                    onChange={(e) => {
                        const next = e.target.value
                        setDraft(next)
                        if (open && parseTagsInput(next).length > 0) setOpen(false)
                    }}
                    onBlur={() => commitDraft()}
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        commitDraft()
                    }}
                    placeholder={t('terms.panel.tags.placeholder')}
                    className={cn(
                        'h-10 flex-1 text-sm',
                        'border-transparent shadow-none bg-transparent hover:border-border hover:bg-muted/20',
                        'focus-visible:bg-background'
                    )}
                />

                <DropdownMenu
                    modal={false}
                    open={open}
                    onOpenChange={(nextOpen) => {
                        setOpen(nextOpen)
                    }}
                >
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10 px-3"
                        >
                            {t('terms.panel.tags.add')}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" data-term-floating-panel="true" className="w-56">
                        {suggestions.length === 0 ? (
                            <DropdownMenuItem disabled>{t('terms.panel.tags.empty')}</DropdownMenuItem>
                        ) : (
                            suggestions.map((tag) => (
                                <DropdownMenuItem key={normalizeTagKey(tag)} onSelect={() => addExistingTag(tag)}>
                                    {tag}
                                </DropdownMenuItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}
