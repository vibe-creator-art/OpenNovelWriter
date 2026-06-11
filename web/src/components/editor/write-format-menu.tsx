'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Settings, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
    WRITE_FONT_FAMILY_STACK,
    useWriteFormatStore,
    type WriteAiOutputStyle,
    type WriteFontFamily,
    type WriteLineHeight,
    type WriteParagraphSpacing,
    type WriteTextIndent,
    type WriteTextSize,
} from './write-format-store'

function FormatTileButton({
    selected,
    onClick,
    children,
    title,
    className,
}: {
    selected: boolean
    onClick: () => void
    children: React.ReactNode
    title: string
    className?: string
}) {
    return (
        <button
            type="button"
            className={cn(
                'h-11 w-11 rounded-md border bg-background hover:bg-accent hover:text-accent-foreground transition-colors grid place-items-center',
                selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'border-input',
                className
            )}
            onClick={onClick}
            aria-label={title}
            title={title}
        >
            {children}
        </button>
    )
}

function TextIndentIcon({ indent }: { indent: WriteTextIndent }) {
    const firstLineIndent = indent === 'none' ? 'ml-0' : indent === 'sm' ? 'ml-1.5' : 'ml-3'
    return (
        <div className="w-7 space-y-1">
            <div className={cn('h-[2px] bg-muted-foreground/70 rounded', firstLineIndent)} />
            <div className="h-[2px] bg-muted-foreground/50 rounded" />
            <div className="h-[2px] bg-muted-foreground/50 rounded" />
        </div>
    )
}

function LineHeightIcon({ lineHeight }: { lineHeight: WriteLineHeight }) {
    const gap = lineHeight === 'tight' ? 2 : lineHeight === 'normal' ? 4 : lineHeight === 'relaxed' ? 6 : 8
    return (
        <div className="w-7 flex flex-col" style={{ gap }}>
            <div className="h-[2px] bg-muted-foreground/70 rounded" />
            <div className="h-[2px] bg-muted-foreground/50 rounded" />
            <div className="h-[2px] bg-muted-foreground/50 rounded" />
        </div>
    )
}

function ParagraphSpacingIcon({ spacing }: { spacing: WriteParagraphSpacing }) {
    const paragraphGap = spacing === 'none' ? 2 : spacing === 'sm' ? 6 : spacing === 'md' ? 10 : 14
    return (
        <div className="w-7 flex flex-col" style={{ gap: paragraphGap }}>
            <div className="flex flex-col gap-2">
                <div className="h-[2px] bg-muted-foreground/70 rounded" />
                <div className="h-[2px] bg-muted-foreground/50 rounded" />
            </div>
            <div className="flex flex-col gap-2">
                <div className="h-[2px] bg-muted-foreground/70 rounded" />
                <div className="h-[2px] bg-muted-foreground/50 rounded" />
            </div>
        </div>
    )
}

function textSizePreviewClass(textSize: WriteTextSize) {
    if (textSize === 'sm') return 'text-xs'
    if (textSize === 'lg') return 'text-base'
    if (textSize === 'xl') return 'text-lg'
    return 'text-sm'
}

function OutputStyleCard({
    selected,
    onClick,
    title,
    description,
    style,
}: {
    selected: boolean
    onClick: () => void
    title: string
    description: string
    style: WriteAiOutputStyle
}) {
    return (
        <button
            type="button"
            className={cn(
                'rounded-xl border px-3 py-3 text-left transition-colors',
                selected ? 'border-foreground bg-accent/60 shadow-sm' : 'border-input hover:bg-accent/40'
            )}
            onClick={onClick}
        >
            <div className="space-y-3">
                <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <div
                    className={cn(
                        'rounded-lg border px-3 py-2',
                        style === 'card'
                            ? 'border-amber-200/70 bg-gradient-to-br from-amber-50/80 via-background to-orange-50/60'
                            : 'border-dashed bg-muted/20'
                    )}
                >
                    <div className="space-y-1.5">
                        <div className="h-2.5 w-24 rounded bg-muted-foreground/50" />
                        <div className="h-2 w-full rounded bg-muted-foreground/30" />
                        <div className="h-2 w-4/5 rounded bg-muted-foreground/30" />
                    </div>
                </div>
            </div>
        </button>
    )
}

export function WriteFormatMenu() {
    const tEditor = useTranslations('editor')
    const t = useTranslations('editor.formatMenu')
    const [activeTab, setActiveTab] = useState<'typography' | 'aiOutput'>('typography')
    const {
        fontFamily,
        textSize,
        lineHeight,
        paragraphSpacing,
        textIndent,
        planningStyle,
        reasoningStyle,
        jumpPosition,
        rememberCursor,
        typewriterMode,
        smoothFollow,
        setFontFamily,
        setTextSize,
        setLineHeight,
        setParagraphSpacing,
        setTextIndent,
        setPlanningStyle,
        setReasoningStyle,
        setJumpPosition,
        setRememberCursor,
        setTypewriterMode,
        setSmoothFollow,
        reset,
    } = useWriteFormatStore()

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 data-[state=open]:bg-accent">
                    <Settings className="h-4 w-4" />
                    {tEditor('header.format')}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-[360px] p-4"
                onInteractOutside={(event) => {
                    const target = event.target as HTMLElement | null
                    if (target?.closest?.('[data-slot="select-content"]')) {
                        event.preventDefault()
                    }
                }}
            >
                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-1">
                        <button
                            type="button"
                            className={cn(
                                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                activeTab === 'typography' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setActiveTab('typography')}
                        >
                            {t('tabs.typography')}
                        </button>
                        <button
                            type="button"
                            className={cn(
                                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                activeTab === 'aiOutput' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setActiveTab('aiOutput')}
                        >
                            <span className="inline-flex items-center gap-1.5">
                                <Sparkles className="h-4 w-4" />
                                {t('tabs.aiOutput')}
                            </span>
                        </button>
                    </div>

                    {activeTab === 'typography' ? (
                        <>
                            <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                                {t('typography')}
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('fontFamily')}</div>
                                <Select value={fontFamily} onValueChange={(value) => setFontFamily(value as WriteFontFamily)}>
                                    <SelectTrigger className="w-full" style={{ fontFamily: WRITE_FONT_FAMILY_STACK[fontFamily] }}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent align="start" className="z-[60]">
                                        <SelectGroup>
                                            <SelectLabel>{t('fontFamilyGroups.serif')}</SelectLabel>
                                            {(['serif', 'times', 'georgia', 'palatino'] as const).map((value) => (
                                                <SelectItem
                                                    key={value}
                                                    value={value}
                                                    style={{ fontFamily: WRITE_FONT_FAMILY_STACK[value] }}
                                                >
                                                    {t(`fontFamilyOptions.${value}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                        <SelectSeparator />
                                        <SelectGroup>
                                            <SelectLabel>{t('fontFamilyGroups.sans')}</SelectLabel>
                                            {(['sans', 'systemSans', 'arial', 'helvetica'] as const).map((value) => (
                                                <SelectItem
                                                    key={value}
                                                    value={value}
                                                    style={{ fontFamily: WRITE_FONT_FAMILY_STACK[value] }}
                                                >
                                                    {t(`fontFamilyOptions.${value}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                        <SelectSeparator />
                                        <SelectGroup>
                                            <SelectLabel>{t('fontFamilyGroups.mono')}</SelectLabel>
                                            {(['mono', 'menlo', 'consolas', 'courier'] as const).map((value) => (
                                                <SelectItem
                                                    key={value}
                                                    value={value}
                                                    style={{ fontFamily: WRITE_FONT_FAMILY_STACK[value] }}
                                                >
                                                    {t(`fontFamilyOptions.${value}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('textSize')}</div>
                                <div className="flex items-center gap-2">
                                    {(['sm', 'md', 'lg', 'xl'] as const).map((value) => (
                                        <FormatTileButton
                                            key={value}
                                            selected={textSize === value}
                                            onClick={() => setTextSize(value)}
                                            title={t(`textSizeOptions.${value}`)}
                                        >
                                            <span className={cn('font-semibold', textSizePreviewClass(value))}>Ab</span>
                                        </FormatTileButton>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('lineHeight')}</div>
                                <div className="flex items-center gap-2">
                                    {(['tight', 'normal', 'relaxed', 'loose'] as const).map((value) => (
                                        <FormatTileButton
                                            key={value}
                                            selected={lineHeight === value}
                                            onClick={() => setLineHeight(value)}
                                            title={t(`lineHeightOptions.${value}`)}
                                        >
                                            <LineHeightIcon lineHeight={value} />
                                        </FormatTileButton>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('paragraphSpacing')}</div>
                                <div className="flex items-center gap-2">
                                    {(['none', 'sm', 'md', 'lg'] as const).map((value) => (
                                        <FormatTileButton
                                            key={value}
                                            selected={paragraphSpacing === value}
                                            onClick={() => setParagraphSpacing(value)}
                                            title={t(`paragraphSpacingOptions.${value}`)}
                                        >
                                            <ParagraphSpacingIcon spacing={value} />
                                        </FormatTileButton>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('textIndent')}</div>
                                <div className="flex items-center gap-2">
                                    {(['none', 'sm', 'md'] as const).map((value) => (
                                        <FormatTileButton
                                            key={value}
                                            selected={textIndent === value}
                                            onClick={() => setTextIndent(value)}
                                            title={t(`textIndentOptions.${value}`)}
                                        >
                                            <TextIndentIcon indent={value} />
                                        </FormatTileButton>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-2">
                                <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                                    {t('cursor')}
                                </div>

                                <div className="mt-3 space-y-4">
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium">{t('jumpPosition')}</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['start', 'end'] as const).map((value) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    className={cn(
                                                        'h-9 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                                                        jumpPosition === value ? 'bg-accent text-accent-foreground border-foreground/40' : 'border-input'
                                                    )}
                                                    onClick={() => setJumpPosition(value)}
                                                >
                                                    {t(`jumpPositionOptions.${value}`)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-input accent-foreground"
                                            checked={rememberCursor}
                                            onChange={(e) => setRememberCursor(e.target.checked)}
                                        />
                                        <span>{t('rememberCursor')}</span>
                                    </label>

                                    <div className="space-y-2">
                                        <div className="text-sm font-medium">{t('typewriterMode')}</div>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-input accent-foreground"
                                                checked={typewriterMode}
                                                onChange={(e) => setTypewriterMode(e.target.checked)}
                                            />
                                            <span>{t('enableTypewriterMode')}</span>
                                        </label>
                                        <label className={cn('flex items-center gap-2 text-sm', !typewriterMode && 'opacity-50')}>
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-input accent-foreground"
                                                checked={smoothFollow}
                                                disabled={!typewriterMode}
                                                onChange={(e) => setSmoothFollow(e.target.checked)}
                                            />
                                            <span>{t('enableSmoothFollow')}</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-5">
                            <div className="space-y-1">
                                <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                                    {t('aiOutput')}
                                </div>
                                <div className="text-sm text-muted-foreground">{t('aiOutputHint')}</div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('planningStyle')}</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <OutputStyleCard
                                        selected={planningStyle === 'none'}
                                        onClick={() => setPlanningStyle('none')}
                                        title={t('outputStyleOptions.none')}
                                        description={t('planningStyleDescription.none')}
                                        style="none"
                                    />
                                    <OutputStyleCard
                                        selected={planningStyle === 'card'}
                                        onClick={() => setPlanningStyle('card')}
                                        title={t('outputStyleOptions.card')}
                                        description={t('planningStyleDescription.card')}
                                        style="card"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('reasoningStyle')}</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <OutputStyleCard
                                        selected={reasoningStyle === 'none'}
                                        onClick={() => setReasoningStyle('none')}
                                        title={t('outputStyleOptions.none')}
                                        description={t('reasoningStyleDescription.none')}
                                        style="none"
                                    />
                                    <OutputStyleCard
                                        selected={reasoningStyle === 'card'}
                                        onClick={() => setReasoningStyle('card')}
                                        title={t('outputStyleOptions.card')}
                                        description={t('reasoningStyleDescription.card')}
                                        style="card"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="pt-3 border-t flex items-center justify-end">
                        <Button variant="ghost" size="sm" className="gap-1" onClick={reset}>
                            <RotateCcw className="h-4 w-4" />
                            {t('reset')}
                        </Button>
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
