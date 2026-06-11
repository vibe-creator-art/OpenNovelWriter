'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Novel } from '@/lib/api'
import { ImageField } from '@/components/image/image-field'
import { parseImageCrop, serializeImageCrop } from '@/lib/image-crop'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'

// Category keys that map to translations
const CATEGORY_KEYS = ['fantasy', 'urban', 'scifi', 'wuxia', 'romance', 'mystery', 'history', 'game'] as const

interface NovelFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    novel?: Novel | null
    onSubmit: (data: { title: string; description?: string; category?: string; coverImage?: string; coverCrop?: string | null }) => Promise<void>
}

export function NovelFormDialog({ open, onOpenChange, novel, onSubmit }: NovelFormDialogProps) {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [category, setCategory] = useState('')
    const [coverImage, setCoverImage] = useState('')
    const [coverCrop, setCoverCrop] = useState<string | null>(null)
    const [customCategory, setCustomCategory] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const t = useTranslations('novel.form')
    const tCategories = useTranslations('novel.categories')
    const tCommon = useTranslations('common')

    const isEdit = !!novel

    useEffect(() => {
        if (open) {
            setTitle(novel?.title || '')
            setDescription(novel?.description || '')
            setCategory(novel?.category || '')
            setCoverImage(novel?.coverImage || '')
            setCoverCrop(novel?.coverCrop || null)
            setCustomCategory('')
            setError('')
        }
    }, [open, novel])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title.trim()) {
            setError(t('nameRequired'))
            return
        }

        setLoading(true)
        setError('')

        try {
            await onSubmit({
                title: title.trim(),
                description: description.trim() || undefined,
                category: (customCategory.trim() || category) || undefined,
                // Always send these keys (even empty) so clearing the cover persists.
                coverImage: coverImage,
                coverCrop: coverImage ? coverCrop : null,
            })
            onOpenChange(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : tCommon('operationFailed'))
        } finally {
            setLoading(false)
        }
    }

    // Get translated category name from key
    const getCategoryName = (key: string) => {
        if (CATEGORY_KEYS.includes(key as typeof CATEGORY_KEYS[number])) {
            return tCategories(key as typeof CATEGORY_KEYS[number])
        }
        return key // Return as-is if it's a custom category
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>{isEdit ? t('editTitle') : t('createTitle')}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? t('editDescription') : t('createDescription')}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        {error && (
                            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="title">{t('name')} *</Label>
                            <Input
                                id="title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder={t('namePlaceholder')}
                                required
                                autoFocus={false}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">{t('synopsis')}</Label>
                            <Textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('synopsisPlaceholder')}
                                rows={3}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>{t('category')}</Label>
                            <div className="flex gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" className="flex-1 justify-between">
                                            {category ? getCategoryName(category) : t('selectCategory')}
                                            <ChevronDown className="ml-2 h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-full">
                                        {CATEGORY_KEYS.map((key) => (
                                            <DropdownMenuItem
                                                key={key}
                                                onClick={() => {
                                                    setCategory(key)
                                                    setCustomCategory('')
                                                }}
                                            >
                                                {tCategories(key)}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Input
                                    placeholder={t('customCategory')}
                                    value={customCategory}
                                    onChange={(e) => {
                                        setCustomCategory(e.target.value)
                                        if (e.target.value) setCategory('')
                                    }}
                                    className="flex-1"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>{t('coverImage')}</Label>
                            <ImageField
                                aspect={1 / 1.6}
                                previewClassName="w-32"
                                value={coverImage ? { url: coverImage, crop: parseImageCrop(coverCrop) } : null}
                                onChange={(next) => {
                                    setCoverImage(next?.url || '')
                                    setCoverCrop(serializeImageCrop(next?.crop ?? null))
                                }}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {tCommon('cancel')}
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? tCommon('saving') : isEdit ? tCommon('save') : tCommon('create')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
