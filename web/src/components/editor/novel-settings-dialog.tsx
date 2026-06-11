'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { labelApi, Novel, NovelLabel, novelApi, uploadApi } from '@/lib/api'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    closestCorners,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownAZ, Ban, Check, GripVertical, Info, Plus, Upload, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

interface NovelSettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    novel: Novel | null
    onUpdate: (novel: Novel) => void
    labels: NovelLabel[]
    onLabelsChange: (labels: NovelLabel[]) => void
    initialTab?: 'metadata' | 'writing'
}

const LANGUAGES = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: 'Chinese (Simplified)' },
    { value: 'zh-TW', label: 'Chinese (Traditional)' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
]

const LABEL_COLORS = [
    '#111827', // slate-900
    '#1e3a8a', // blue-900
    '#0c4a6e', // sky-900
    '#064e3b', // emerald-900
    '#14532d', // green-900
    '#7f1d1d', // red-900
    '#7c2d12', // orange-900
    '#78350f', // amber-900
    '#4c1d95', // purple-900
    '#701a75', // fuchsia-900
]

function normalizeLabelOrder(list: NovelLabel[]) {
    return list.map((label, idx) => ({ ...label, sortOrder: idx }))
}

function SortableLabelRow({
    label,
    savedName,
    labelsBusy,
    tCommon,
    t,
    onNameChange,
    onNameCommit,
    onDelete,
    onColorChange,
}: {
    label: NovelLabel
    savedName: string
    labelsBusy: boolean
    tCommon: (key: string) => string
    t: (key: string) => string
    onNameChange: (labelId: string, value: string) => void
    onNameCommit: (labelId: string, value: string) => void
    onDelete: (labelId: string) => void
    onColorChange: (labelId: string, color: string | null) => void
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: label.id, disabled: labelsBusy })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }
    const currentColor = label.color ?? null

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2 py-2 ${isDragging ? 'opacity-70 shadow-lg ring-2 ring-muted' : ''
                }`}
        >
            <button
                type="button"
                className="order-1 shrink-0 p-2 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing disabled:opacity-40"
                {...attributes}
                {...listeners}
                disabled={labelsBusy}
                aria-label={t('writing.dragToSort')}
                title={t('writing.dragToSort')}
            >
                <GripVertical className="h-4 w-4" />
            </button>

            <Input
                value={label.name}
                onChange={(e) => onNameChange(label.id, e.target.value)}
                onBlur={(e) => onNameCommit(label.id, e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        ; (e.target as HTMLInputElement).blur()
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault()
                        onNameChange(label.id, savedName)
                        ; (e.target as HTMLInputElement).value = savedName
                        ; (e.target as HTMLInputElement).blur()
                    }
                }}
                placeholder={t('writing.labelsNamePlaceholder')}
                className="order-2 h-9 flex-1 min-w-[180px]"
                disabled={labelsBusy}
            />

            <Button
                variant="ghost"
                size="icon"
                className="order-3 sm:order-4 h-9 w-9 shrink-0"
                onClick={() => onDelete(label.id)}
                disabled={labelsBusy}
                title={tCommon('delete')}
            >
                <Trash2 className="h-4 w-4" />
            </Button>

            <div className="order-4 sm:order-3 w-full sm:w-auto sm:max-w-[240px] flex items-start gap-2 justify-start sm:justify-end">
                <button
                    type="button"
                    className={`h-7 w-7 rounded-md border flex items-center justify-center ${currentColor === null ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''
                        }`}
                    onClick={() => onColorChange(label.id, null)}
                    disabled={labelsBusy}
                    aria-label={t('writing.clearColor')}
                    title={t('writing.clearColor')}
                >
                    <Ban className="h-4 w-4 text-muted-foreground" />
                </button>
                <div className="grid grid-cols-5 gap-1">
                    {LABEL_COLORS.map((color) => (
                        <button
                            key={color}
                            type="button"
                            className={`h-7 w-7 rounded-md border flex items-center justify-center ${currentColor === color ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''
                                }`}
                            style={{ backgroundColor: color, borderColor: color }}
                            onClick={() => onColorChange(label.id, color)}
                            disabled={labelsBusy}
                            aria-label={t('writing.setColor')}
                            title={t('writing.setColor')}
                        >
                            {currentColor === color ? (
                                <Check className="h-4 w-4 text-white drop-shadow" />
                            ) : null}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export function NovelSettingsDialog({
    open,
    onOpenChange,
    novel,
    onUpdate,
    labels,
    onLabelsChange,
    initialTab = 'metadata',
}: NovelSettingsDialogProps) {
    const t = useTranslations('novelSettings')
    const tCommon = useTranslations('common')
    const locale = useLocale()
    const defaultNovelLanguage = useMemo(() => {
        if (locale?.toLowerCase().startsWith('zh')) return 'zh-CN'
        return 'en'
    }, [locale])
    const [activeTab, setActiveTab] = useState<'metadata' | 'writing'>('metadata')
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [labelsBusy, setLabelsBusy] = useState(false)

    // Form state
    const [title, setTitle] = useState('')
    const [authorName, setAuthorName] = useState('')
    const [series, setSeries] = useState('')
    const [seriesIndex, setSeriesIndex] = useState('')
    const [description, setDescription] = useState('')
    const [coverImage, setCoverImage] = useState('')
    const [language, setLanguage] = useState(defaultNovelLanguage)
    const [draftLabels, setDraftLabels] = useState<NovelLabel[]>([])
    const draftLabelsRef = useRef<NovelLabel[]>([])

    useEffect(() => {
        if (!open) return
        setActiveTab(initialTab)
    }, [open, initialTab])

    // Initialize form when novel changes
    useEffect(() => {
        if (novel) {
            setTitle(novel.title || '')
            setAuthorName(novel.authorName || '')
            setSeries(novel.series || '')
            setSeriesIndex(novel.seriesIndex?.toString() || '')
            setDescription(novel.description || '')
            setCoverImage(novel.coverImage || '')
            setLanguage(novel.language || defaultNovelLanguage)
        }
    }, [defaultNovelLanguage, novel])

    useEffect(() => {
        if (!open) return
        setDraftLabels([...labels].sort((a, b) => a.sortOrder - b.sortOrder))
    }, [labels, open])

    useEffect(() => {
        draftLabelsRef.current = draftLabels
    }, [draftLabels])

    const labelIds = useMemo(() => draftLabels.map((l) => l.id), [draftLabels])
    const savedLabelNamesById = useMemo(() => new Map(labels.map((l) => [l.id, l.name])), [labels])

    const handleAddLabel = async () => {
        if (!novel || labelsBusy) return
        setLabelsBusy(true)
        try {
            const baseName = t('writing.labelsNewDefault')
            const existingNames = new Set(draftLabels.map((l) => l.name.toLowerCase()))
            let name = baseName
            let counter = 2
            while (existingNames.has(name.toLowerCase())) {
                name = `${baseName} ${counter}`
                counter += 1
            }

            const created = await labelApi.create(novel.id, { name })
            const next = [...draftLabels, created]
            setDraftLabels(next)
            onLabelsChange(next)
        } catch (error) {
            console.error('Failed to add label:', error)
        } finally {
            setLabelsBusy(false)
        }
    }

    const handleRenameLabel = async (labelId: string, nextNameRaw: string) => {
        if (!novel) return
        const nextName = nextNameRaw.trim()
        const saved = labels.find((l) => l.id === labelId)
        if (!saved) return
        if (!nextName) {
            // Reset invalid name
            setDraftLabels((prev) => prev.map((l) => (l.id === labelId ? { ...l, name: saved.name } : l)))
            return
        }
        if (nextName === saved.name) return

        try {
            const updated = await labelApi.update(novel.id, labelId, { name: nextName })
            const latest = draftLabelsRef.current
            const next = latest.map((l) => (l.id === labelId ? { ...l, name: updated.name, updatedAt: updated.updatedAt } : l))
            setDraftLabels(next)
            onLabelsChange(next)
        } catch (error) {
            console.error('Failed to rename label:', error)
            // Revert on failure
            setDraftLabels((prev) => prev.map((l) => (l.id === labelId ? { ...l, name: saved.name } : l)))
        }
    }

    const persistLabelOrder = useCallback(async (nextLabels: NovelLabel[], previousLabels: NovelLabel[]) => {
        if (!novel) return
        const previousOrder = new Map(previousLabels.map((l) => [l.id, l.sortOrder]))
        const changed = nextLabels.filter((l) => previousOrder.get(l.id) !== l.sortOrder)
        if (changed.length === 0) return

        await Promise.all(changed.map((label) => labelApi.update(novel.id, label.id, { sortOrder: label.sortOrder })))
    }, [novel])

    const commitLabelOrder = useCallback(async (nextOrdered: NovelLabel[], previous: NovelLabel[]) => {
        const normalized = normalizeLabelOrder(nextOrdered)
        setDraftLabels(normalized)
        onLabelsChange(normalized)

        if (!novel) return
        setLabelsBusy(true)
        try {
            await persistLabelOrder(normalized, previous)
        } catch (error) {
            console.error('Failed to reorder labels:', error)
            setDraftLabels(previous)
            onLabelsChange(previous)
        } finally {
            setLabelsBusy(false)
        }
    }, [novel, onLabelsChange, persistLabelOrder])

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over) return
        if (active.id === over.id) return

        const previous = draftLabels
        const oldIndex = previous.findIndex((l) => l.id === active.id)
        const newIndex = previous.findIndex((l) => l.id === over.id)
        if (oldIndex === -1 || newIndex === -1) return

        const next = arrayMove(previous, oldIndex, newIndex)
        await commitLabelOrder(next, previous)
    }, [commitLabelOrder, draftLabels])

    const handleSortLabels = useCallback(async () => {
        const previous = draftLabels
        const next = [...previous].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        await commitLabelOrder(next, previous)
    }, [commitLabelOrder, draftLabels])

    const handleChangeLabelColor = useCallback(async (labelId: string, color: string | null) => {
        if (!novel || labelsBusy) return
        const previous = draftLabels
        const next = previous.map((l) => (l.id === labelId ? { ...l, color } : l))
        setDraftLabels(next)
        onLabelsChange(next)

        setLabelsBusy(true)
        try {
            await labelApi.update(novel.id, labelId, { color })
        } catch (error) {
            console.error('Failed to update label color:', error)
            setDraftLabels(previous)
            onLabelsChange(previous)
        } finally {
            setLabelsBusy(false)
        }
    }, [draftLabels, labelsBusy, novel, onLabelsChange])

    const handleDeleteLabel = async (labelId: string) => {
        if (!novel || labelsBusy) return
        setLabelsBusy(true)
        try {
            const previous = draftLabels
            await labelApi.delete(novel.id, labelId)
            const next = normalizeLabelOrder(previous.filter((l) => l.id !== labelId))
            setDraftLabels(next)
            onLabelsChange(next)
            await persistLabelOrder(next, previous)
        } catch (error) {
            console.error('Failed to delete label:', error)
        } finally {
            setLabelsBusy(false)
        }
    }

    const handleSave = async () => {
        if (!novel) return

        setSaving(true)
        try {
            const updated = await novelApi.update(novel.id, {
                title,
                authorName: authorName || null,
                series: series || null,
                seriesIndex: seriesIndex ? parseInt(seriesIndex) : null,
                description: description || null,
                coverImage: coverImage || null,
                language,
            })
            onUpdate(updated)
            onOpenChange(false) // Close dialog after successful save
        } catch (error) {
            console.error('Failed to save settings:', error)
        } finally {
            setSaving(false)
        }
    }

    const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(true)
        try {
            const result = await uploadApi.image(file)
            setCoverImage(result.url)
        } catch (error) {
            console.error('Failed to upload cover:', error)
        } finally {
            setUploading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
                <DialogHeader>
                    <DialogTitle className="sr-only">{t('title')}</DialogTitle>
                </DialogHeader>

                {/* Tab Navigation */}
                <div className="flex gap-6 border-b pb-0 -mt-2">
                    <button
                        onClick={() => setActiveTab('metadata')}
                        className={`flex items-center gap-2 pb-3 px-1 border-b-2 transition-colors ${activeTab === 'metadata'
                            ? 'border-primary text-primary font-medium'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Info className="h-4 w-4" />
                        {t('tabs.metadata')}
                    </button>
                    <button
                        onClick={() => setActiveTab('writing')}
                        className={`flex items-center gap-2 pb-3 px-1 border-b-2 transition-colors ${activeTab === 'writing'
                            ? 'border-primary text-primary font-medium'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <span className="text-lg">✏️</span>
                        {t('tabs.writing')}
                    </button>
                </div>

                {/* Tab Content */}
                <div className="mt-6">
                    {activeTab === 'metadata' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Left Column - Metadata */}
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold mb-1">{t('metadata.title')}</h3>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        {t('metadata.description')}
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <Label htmlFor="title">{t('metadata.novelTitle')}</Label>
                                        <Input
                                            id="title"
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            placeholder={t('metadata.novelTitlePlaceholder')}
                                            className="mt-1"
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="author">{t('metadata.author')}</Label>
                                        <Input
                                            id="author"
                                            value={authorName}
                                            onChange={(e) => setAuthorName(e.target.value)}
                                            placeholder={t('metadata.authorPlaceholder')}
                                            className="mt-1"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <Label htmlFor="series">{t('metadata.series')}</Label>
                                            <Input
                                                id="series"
                                                value={series}
                                                onChange={(e) => setSeries(e.target.value)}
                                                placeholder={t('metadata.seriesPlaceholder')}
                                                className="mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="seriesIndex">{t('metadata.seriesIndex')}</Label>
                                            <Input
                                                id="seriesIndex"
                                                type="number"
                                                value={seriesIndex}
                                                onChange={(e) => setSeriesIndex(e.target.value)}
                                                placeholder={t('metadata.seriesIndexPlaceholder')}
                                                className="mt-1"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <Label htmlFor="description">{t('metadata.descriptionLabel')}</Label>
                                        <Textarea
                                            id="description"
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            placeholder={t('metadata.descriptionPlaceholder')}
                                            className="mt-1 min-h-[100px]"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Right Column - Cover */}
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-semibold mb-1">{t('cover.title')}</h3>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        {t('cover.description')}
                                    </p>
                                </div>

                                <div className="flex flex-col items-center gap-4">
                                    <label className="cursor-pointer">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleCoverUpload}
                                        />
                                        <Button variant="outline" size="sm" disabled={uploading} asChild>
                                            <span>
                                                <Upload className="h-4 w-4 mr-2" />
                                                {uploading ? t('cover.uploading') : t('cover.upload')}
                                            </span>
                                        </Button>
                                    </label>
                                    <span className="text-xs text-muted-foreground">
                                        {t('cover.dragDrop')}
                                    </span>

                                    {coverImage && (
                                        <div className="relative w-full max-w-[200px] aspect-[2/3] rounded-lg overflow-hidden border">
                                            <Image
                                                src={coverImage}
                                                alt="Cover"
                                                fill
                                                sizes="200px"
                                                unoptimized
                                                className="object-cover"
                                            />
                                            <Button
                                                variant="destructive"
                                                size="icon"
                                                className="absolute top-2 right-2 h-6 w-6"
                                                onClick={() => setCoverImage('')}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'writing' && (
                        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-8">
                            {/* Left Column - Labels/Markers */}
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold mb-1 flex items-center gap-1">
                                        {t('writing.labelsTitle')}
                                        <Info className="h-3 w-3 text-muted-foreground" />
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        {t('writing.labelsDescription')}
                                    </p>
                                </div>

                                <div className="border rounded-lg p-4 bg-muted/20">
                                    {draftLabels.length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center py-6">
                                            {t('writing.labelsEmpty')}
                                        </p>
                                    ) : (
                                        <DndContext
                                            sensors={sensors}
                                            collisionDetection={closestCorners}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <SortableContext items={labelIds} strategy={verticalListSortingStrategy}>
                                                <div className="space-y-2">
                                                    {draftLabels.map((label) => (
                                                        <SortableLabelRow
                                                            key={label.id}
                                                            label={label}
                                                            savedName={savedLabelNamesById.get(label.id) ?? label.name}
                                                            labelsBusy={labelsBusy}
                                                            tCommon={tCommon}
                                                            t={t}
                                                            onNameChange={(labelId, value) => {
                                                                setDraftLabels((prev) => prev.map((l) => (l.id === labelId ? { ...l, name: value } : l)))
                                                            }}
                                                            onNameCommit={handleRenameLabel}
                                                            onDelete={handleDeleteLabel}
                                                            onColorChange={handleChangeLabelColor}
                                                        />
                                                    ))}
                                                </div>
                                            </SortableContext>
                                        </DndContext>
                                    )}

                                    <div className="pt-4 flex gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="justify-center gap-1"
                                            onClick={handleAddLabel}
                                            disabled={!novel || labelsBusy}
                                        >
                                            <Plus className="h-4 w-4" />
                                            {t('writing.addLabel')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="justify-center gap-1"
                                            onClick={handleSortLabels}
                                            disabled={draftLabels.length < 2 || labelsBusy}
                                        >
                                            <ArrowDownAZ className="h-4 w-4" />
                                            {t('writing.sortLabels')}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column - Prose Settings */}
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold mb-4">{t('writing.proseTitle')}</h3>
                                </div>

                                <div className="space-y-6">
                                    {/* Language */}
                                    <div>
                                        <Label className="text-sm font-medium">{t('writing.language')}</Label>
                                        <p className="text-xs text-muted-foreground mb-2">
                                            {t('writing.languageDescription')}
                                        </p>
                                        <Select value={language} onValueChange={setLanguage}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder={t('writing.languagePlaceholder')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {LANGUAGES.map((lang) => (
                                                    <SelectItem key={lang.value} value={lang.value}>
                                                        {lang.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Save Button */}
                <div className="flex justify-end mt-6 pt-4 border-t">
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? t('saving') : t('saveChanges')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
