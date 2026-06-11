'use client'

import { useTranslations } from 'next-intl'
import { Novel } from '@/lib/api'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreVertical, Edit, Trash2, BookOpen } from 'lucide-react'
import { CroppedImage } from '@/components/image/cropped-image'
import { parseImageCrop } from '@/lib/image-crop'

const CATEGORY_KEYS = ['fantasy', 'urban', 'scifi', 'wuxia', 'romance', 'mystery', 'history', 'game'] as const

// Placeholder gradient (used when a novel has no cover) tinted by category.
const CATEGORY_GRADIENTS: Record<string, string> = {
    fantasy: 'from-purple-500 to-indigo-600',
    urban: 'from-sky-500 to-blue-600',
    scifi: 'from-cyan-500 to-blue-700',
    wuxia: 'from-amber-500 to-orange-600',
    romance: 'from-pink-500 to-rose-600',
    mystery: 'from-slate-600 to-gray-800',
    history: 'from-stone-500 to-amber-700',
    game: 'from-emerald-500 to-teal-600',
}
const DEFAULT_COVER_GRADIENT = 'from-purple-500 to-indigo-600'

function coverGradient(category: string | null) {
    return (category && CATEGORY_GRADIENTS[category]) || DEFAULT_COVER_GRADIENT
}

interface NovelCardProps {
    novel: Novel
    onEdit: (novel: Novel) => void
    onDelete: (novel: Novel) => void
    onClick?: (novel: Novel) => void
}

export function NovelCard({ novel, onEdit, onDelete, onClick }: NovelCardProps) {
    const chapterCount = novel._count?.chapters ?? 0
    const t = useTranslations('novelCard')
    const tBookshelf = useTranslations('bookshelf')
    const tCategories = useTranslations('novel.categories')

    const handleClick = () => {
        if (onClick) {
            onClick(novel)
        }
    }

    return (
        <Card className="group overflow-hidden transition-all hover:shadow-lg hover:-translate-y-1">
            <div
                className="cursor-pointer"
                onClick={handleClick}
            >
                <div className={`aspect-[1/1.6] bg-gradient-to-br ${coverGradient(novel.category)} relative overflow-hidden`}>
                    {novel.coverImage ? (
                        <CroppedImage
                            src={novel.coverImage}
                            crop={parseImageCrop(novel.coverCrop)}
                            aspectRatio={1 / 1.6}
                            className="absolute inset-0 h-full w-full"
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <BookOpen className="w-12 h-12 text-white/50" />
                        </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </div>
            </div>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                    <div className="flex-1 cursor-pointer" onClick={handleClick}>
                        <h3 className="font-semibold text-lg line-clamp-1 hover:text-primary transition-colors">
                            {novel.title}
                        </h3>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(novel)}>
                                <Edit className="mr-2 h-4 w-4" />
                                {t('edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onDelete(novel)}
                                className="text-red-600 focus:text-red-600"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('delete')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="pb-2">
                {novel.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                        {novel.description}
                    </p>
                )}
            </CardContent>
            <CardFooter className="pt-0">
                <div className="flex items-center gap-2 w-full">
                    {novel.category && (
                        <Badge variant="secondary" className="text-xs">
                            {CATEGORY_KEYS.includes(novel.category as (typeof CATEGORY_KEYS)[number])
                                ? tCategories(novel.category)
                                : novel.category}
                        </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                        {tBookshelf('chapters', { count: chapterCount })}
                    </span>
                </div>
            </CardFooter>
        </Card>
    )
}
