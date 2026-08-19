'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Loader2 } from 'lucide-react'
import { actApi, chapterApi, novelApi, type Act, type Chapter, type Novel } from '@/lib/api'
import { requestManuscriptFlush } from '@/lib/manuscript-flush-events'
import type { NovelExportFormat, NovelExportSceneDivider } from '@/lib/export/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

type NovelExportTabProps = {
    novel: Novel | null
    active: boolean
}

function TreeCheckbox({
    checked,
    indeterminate = false,
    disabled,
    onCheckedChange,
    children,
}: {
    checked: boolean
    indeterminate?: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
    children: React.ReactNode
}) {
    const ref = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (ref.current) ref.current.indeterminate = indeterminate && !checked
    }, [checked, indeterminate])

    return (
        <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
                ref={ref}
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onCheckedChange(event.target.checked)}
            />
            <span className="min-w-0 leading-5">{children}</span>
        </label>
    )
}

export function NovelExportTab({ novel, active }: NovelExportTabProps) {
    const t = useTranslations('novelSettings.export')
    const tEditor = useTranslations('editor')
    const [chapters, setChapters] = useState<Chapter[]>([])
    const [acts, setActs] = useState<Act[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [format, setFormat] = useState<NovelExportFormat>('txt')
    const [includeActTitles, setIncludeActTitles] = useState(true)
    const [sceneDivider, setSceneDivider] = useState<NovelExportSceneDivider>('asterisks')
    const [loading, setLoading] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [error, setError] = useState('')

    const loadOutline = useCallback(async () => {
        if (!novel) return
        setLoading(true)
        setError('')
        try {
            const [nextChapters, nextActs] = await Promise.all([
                chapterApi.list(novel.id),
                actApi.list(novel.id),
            ])
            const sorted = [...nextChapters].sort((a, b) => (
                a.actNumber !== b.actNumber ? a.actNumber - b.actNumber : a.order - b.order
            ))
            setChapters(sorted)
            setActs(nextActs)
            setSelectedIds(new Set(sorted.map((chapter) => chapter.id)))
        } catch (loadError) {
            console.error('Failed to load export outline:', loadError)
            setError(t('loadFailed'))
        } finally {
            setLoading(false)
        }
    }, [novel, t])

    useEffect(() => {
        if (!active || !novel) return
        void loadOutline()
    }, [active, loadOutline, novel])

    const actNumbers = useMemo(() => {
        const numbers = new Set<number>()
        for (const act of acts) numbers.add(act.number)
        for (const chapter of chapters) numbers.add(chapter.actNumber)
        return Array.from(numbers).sort((a, b) => a - b)
    }, [acts, chapters])

    const chaptersByAct = useMemo(() => {
        const grouped: Record<number, Chapter[]> = {}
        for (const chapter of chapters) {
            if (!grouped[chapter.actNumber]) grouped[chapter.actNumber] = []
            grouped[chapter.actNumber].push(chapter)
        }
        return grouped
    }, [chapters])

    const actTitleByNumber = useMemo(() => {
        const titles = new Map<number, string | null>()
        for (const act of acts) titles.set(act.number, act.title)
        return titles
    }, [acts])

    const getActTitle = useCallback((actNumber: number) => {
        return actTitleByNumber.get(actNumber)?.trim() || tEditor('act.defaultTitle', { number: actNumber })
    }, [actTitleByNumber, tEditor])

    const allSelected = chapters.length > 0 && chapters.every((chapter) => selectedIds.has(chapter.id))

    const toggleAll = () => {
        if (allSelected) {
            setSelectedIds(new Set())
            return
        }
        setSelectedIds(new Set(chapters.map((chapter) => chapter.id)))
    }

    const toggleAct = (actNumber: number, checked: boolean) => {
        const ids = (chaptersByAct[actNumber] ?? []).map((chapter) => chapter.id)
        setSelectedIds((current) => {
            const next = new Set(current)
            for (const id of ids) {
                if (checked) next.add(id)
                else next.delete(id)
            }
            return next
        })
    }

    const toggleChapter = (chapterId: string, checked: boolean) => {
        setSelectedIds((current) => {
            const next = new Set(current)
            if (checked) next.add(chapterId)
            else next.delete(chapterId)
            return next
        })
    }

    const handleExport = async () => {
        if (!novel || selectedIds.size === 0 || exporting) return
        setExporting(true)
        setError('')
        try {
            await requestManuscriptFlush()
            const { blob, filename } = await novelApi.export(novel.id, {
                chapterIds: Array.from(selectedIds),
                format,
                includeActTitles,
                sceneDivider,
            })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (exportError) {
            console.error('Failed to export novel:', exportError)
            setError(exportError instanceof Error ? exportError.message : t('failed'))
        } finally {
            setExporting(false)
        }
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h3 className="text-sm font-semibold">{t('title')}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('description')}</p>
            </div>

            <div className="space-y-3">
                <Button type="button" variant="outline" size="sm" onClick={toggleAll} disabled={loading || chapters.length === 0}>
                    {allSelected ? t('toggleNone') : t('toggleAll')}
                </Button>

                <ScrollArea className="h-72 rounded-lg border">
                    <div className="space-y-3 p-3">
                        {loading && (
                            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t('loading')}
                            </div>
                        )}
                        {!loading && chapters.length === 0 && (
                            <p className="py-8 text-sm text-muted-foreground">{t('empty')}</p>
                        )}
                        {!loading && actNumbers.map((actNumber) => {
                            const actChapters = chaptersByAct[actNumber] ?? []
                            const selectedCount = actChapters.filter((chapter) => selectedIds.has(chapter.id)).length
                            const actChecked = actChapters.length > 0 && selectedCount === actChapters.length
                            const actIndeterminate = selectedCount > 0 && selectedCount < actChapters.length
                            return (
                                <div key={actNumber} className="space-y-1.5">
                                    <TreeCheckbox
                                        checked={actChecked}
                                        indeterminate={actIndeterminate}
                                        disabled={actChapters.length === 0}
                                        onCheckedChange={(checked) => toggleAct(actNumber, checked)}
                                    >
                                        <span className="font-medium">{getActTitle(actNumber)}</span>
                                    </TreeCheckbox>
                                    {actChapters.map((chapter) => (
                                        <div key={chapter.id} className="pl-6">
                                            <TreeCheckbox
                                                checked={selectedIds.has(chapter.id)}
                                                onCheckedChange={(checked) => toggleChapter(chapter.id, checked)}
                                            >
                                                {chapter.title}
                                            </TreeCheckbox>
                                        </div>
                                    ))}
                                </div>
                            )
                        })}
                    </div>
                </ScrollArea>
            </div>

            <div className="space-y-2">
                <Label>{t('formatLabel')}</Label>
                <Select value={format} onValueChange={(value: NovelExportFormat) => setFormat(value)}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="txt">{t('formatTxt')}</SelectItem>
                        <SelectItem value="docx">{t('formatDocx')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <TreeCheckbox checked={includeActTitles} onCheckedChange={setIncludeActTitles}>
                <span>
                    <span className="block font-medium">{t('includeActTitles')}</span>
                    <span className="block text-xs text-muted-foreground">{t('includeActTitlesHint')}</span>
                </span>
            </TreeCheckbox>

            <div className="space-y-2">
                <Label>{t('sceneDividerLabel')}</Label>
                <Select value={sceneDivider} onValueChange={(value: NovelExportSceneDivider) => setSceneDivider(value)}>
                    <SelectTrigger className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="asterisks">{t('sceneDividerAsterisks')}</SelectItem>
                        <SelectItem value="headings">{t('sceneDividerHeadings')}</SelectItem>
                        <SelectItem value="none">{t('sceneDividerNone')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end mt-6 pt-4 border-t">
                <Button
                    type="button"
                    onClick={() => void handleExport()}
                    disabled={exporting || loading || selectedIds.size === 0}
                >
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {exporting ? t('exporting') : t('export')}
                </Button>
            </div>
        </div>
    )
}
