'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { renderSimpleMarkdown } from '@/lib/simple-markdown'
import { ImageViewerBoundary } from '@/components/image/image-viewer-dialog'

type TermEntryMarkdownProps = {
    content: string | null | undefined
    className?: string
    emptyClassName?: string
}

export function TermEntryMarkdown({ content, className, emptyClassName }: TermEntryMarkdownProps) {
    const normalized = (content ?? '').trim()
    const rendered = useMemo(() => renderSimpleMarkdown(normalized), [normalized])

    if (!normalized) {
        return <div className={cn('text-sm text-muted-foreground', emptyClassName)}>—</div>
    }

    return (
        <div
            className={cn(
                'min-w-0 max-w-full overflow-x-hidden text-inherit leading-7 break-words [overflow-wrap:anywhere]',
                '[&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:break-words [&_h1]:[overflow-wrap:anywhere]',
                '[&_h2]:mt-0 [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:break-words [&_h2]:[overflow-wrap:anywhere]',
                '[&_h3]:mt-0 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:leading-tight [&_h3]:break-words [&_h3]:[overflow-wrap:anywhere]',
                '[&_h4]:mt-0 [&_h4]:mb-3 [&_h4]:text-lg [&_h4]:font-semibold [&_h4]:leading-tight [&_h4]:break-words [&_h4]:[overflow-wrap:anywhere]',
                '[&_h5]:mt-0 [&_h5]:mb-2 [&_h5]:text-base [&_h5]:font-semibold [&_h5]:break-words [&_h5]:[overflow-wrap:anywhere]',
                '[&_h6]:mt-0 [&_h6]:mb-2 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-wide [&_h6]:break-words [&_h6]:[overflow-wrap:anywhere]',
                '[&_p]:my-0 [&_p]:whitespace-normal [&_p]:break-words [&_p]:[overflow-wrap:anywhere]',
                '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:break-words [&_ul]:[overflow-wrap:anywhere]',
                '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:break-words [&_ol]:[overflow-wrap:anywhere]',
                '[&_li]:my-1 [&_li]:break-words [&_li]:[overflow-wrap:anywhere] [&_li>ul]:mt-2 [&_li>ol]:mt-2',
                '[&_ul_ul]:list-[circle] [&_ul_ul]:pl-5',
                '[&_ul_ul_ul]:list-[square]',
                '[&_table]:my-3 [&_table]:w-full [&_table]:min-w-max [&_table]:border-collapse [&_table]:text-sm',
                '[&_thead_th]:bg-muted/50 [&_thead_th]:font-semibold',
                '[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:align-top',
                '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
                '[&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3',
                '[&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]',
                '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-inherit [&_pre_code]:break-words [&_pre_code]:[overflow-wrap:anywhere]',
                '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:break-words [&_blockquote]:[overflow-wrap:anywhere]',
                '[&_a]:break-all [&_a]:text-primary [&_strong]:font-semibold',
                className
            )}
        >
            <ImageViewerBoundary>{rendered}</ImageViewerBoundary>
        </div>
    )
}
