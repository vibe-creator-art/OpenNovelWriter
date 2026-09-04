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

function NovelCardMenu({
    novel,
    onEdit,
    onDelete,
    overlay,
}: {
    novel: Novel
    onEdit: (novel: Novel) => void
    onDelete: (novel: Novel) => void
    overlay?: boolean
}) {
    const t = useTranslations('novelCard')

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={
                        overlay
                            ? 'h-10 w-10 bg-black/45 text-white hover:bg-black/60 hover:text-white'
                            : 'h-8 w-8 -mr-2'
                    }
                    onClick={(event) => event.stopPropagation()}
                >
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">{t('menu')}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={() => onEdit(novel)}>
                    <Edit className="mr-2 h-4 w-4" />
                    {t('edit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => onDelete(novel)}
                    className="min-h-11 text-red-600 focus:text-red-600 md:min-h-0"
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('delete')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function NovelCard({ novel, onEdit, onDelete, onClick }: NovelCardProps) {
    const chapterCount = novel._count?.chapters ?? 0
    const tBookshelf = useTranslations('bookshelf')
    const tCategories = useTranslations('novel.categories')

    const handleClick = () => {
        if (onClick) {
            onClick(novel)
        }
    }

    return (
        <Card className="group overflow-hidden gap-0 py-0 transition-all hover:shadow-lg hover:-translate-y-1 md:gap-6 md:py-6">
            <div className="relative">
                <div className="cursor-pointer" onClick={handleClick}>
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
                                <BookOpen className="h-8 w-8 text-white/50 md:h-12 md:w-12" />
                            </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                </div>
                <div className="absolute top-1.5 right-1.5 z-10 md:hidden">
                    <NovelCardMenu novel={novel} onEdit={onEdit} onDelete={onDelete} overlay />
                </div>
            </div>
            <CardHeader className="px-2.5 py-2 md:px-6 md:pb-2">
                <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={handleClick}>
                        <h3 className="font-semibold text-sm leading-snug line-clamp-2 hover:text-primary transition-colors md:text-lg md:line-clamp-1">
                            {novel.title}
                        </h3>
                    </div>
                    <div className="hidden md:block">
                        <NovelCardMenu novel={novel} onEdit={onEdit} onDelete={onDelete} />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="hidden pb-2 md:block">
                {novel.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                        {novel.description}
                    </p>
                ) : null}
            </CardContent>
            <CardFooter className="px-2.5 pb-2.5 pt-0 md:px-6 md:pt-0">
                <div className="flex min-w-0 items-center gap-2 w-full">
                    {novel.category && (
                        <Badge variant="secondary" className="max-w-[60%] truncate text-[10px] md:text-xs">
                            {CATEGORY_KEYS.includes(novel.category as (typeof CATEGORY_KEYS)[number])
                                ? tCategories(novel.category)
                                : novel.category}
                        </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0 md:text-xs">
                        {tBookshelf('chapters', { count: chapterCount })}
                    </span>
                </div>
            </CardFooter>
        </Card>
    )
}
