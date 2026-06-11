'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor } from '@tiptap/core'
import { useTranslations } from 'next-intl'
import { Bold, Code2, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EMPTY_TERM_MENTION_MATCHER, type TermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { TermMentionsExtension, termMentionsPluginKey } from '@/components/editor/terms/term-mentions-extension'
import { htmlToMarkdown } from '@/lib/html-to-markdown'
import { markdownToHtml } from '@/lib/simple-markdown'

type MarkdownToolbarEditorProps = {
    id?: string
    value: string
    valueFormat: 'html' | 'markdown'
    placeholder?: string
    className?: string
    contentClassName?: string
    editorClassName?: string
    termMentionMatcher?: TermMentionMatcher | null
    onTermMentionClick?: (termId: string, anchorEl: HTMLElement) => void
    onChange: (value: string) => void
}

const MARKDOWN_CONTROLS = [
    { id: 'bold', icon: Bold, run: (editor: Editor) => editor.chain().focus().toggleBold().run() },
    { id: 'italic', icon: Italic, run: (editor: Editor) => editor.chain().focus().toggleItalic().run() },
    {
        id: 'strike',
        icon: Strikethrough,
        run: (editor: Editor) => editor.chain().focus().toggleStrike().run(),
    },
    { id: 'code', icon: Code2, run: (editor: Editor) => editor.chain().focus().toggleCode().run() },
    { id: 'bullet', icon: List, run: (editor: Editor) => editor.chain().focus().toggleBulletList().run() },
    {
        id: 'ordered',
        icon: ListOrdered,
        run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    { id: 'quote', icon: Quote, run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run() },
] as const

type MarkdownControlId = typeof MARKDOWN_CONTROLS[number]['id']
type HeadingControlId = 'heading1' | 'heading2' | 'heading3'

const HEADING_CONTROLS: Array<{
    id: HeadingControlId
    level: 1 | 2 | 3
    icon: typeof Heading1
}> = [
    { id: 'heading1', level: 1, icon: Heading1 },
    { id: 'heading2', level: 2, icon: Heading2 },
    { id: 'heading3', level: 3, icon: Heading3 },
]

function isMarkdownLikePaste(text: string) {
    const normalized = text.trim()
    if (!normalized) return false
    return (
        normalized.includes('**') ||
        normalized.includes('__') ||
        normalized.includes('~~') ||
        normalized.includes('`') ||
        /^#{1,6}\s/m.test(normalized) ||
        /^>\s/m.test(normalized) ||
        /^[-*+]\s/m.test(normalized) ||
        /^\d+\.\s/m.test(normalized)
    )
}

function toEditorHtml(value: string, valueFormat: MarkdownToolbarEditorProps['valueFormat']) {
    return valueFormat === 'markdown' ? markdownToHtml(value) : value
}

function fromEditorHtml(html: string, valueFormat: MarkdownToolbarEditorProps['valueFormat']) {
    return valueFormat === 'markdown' ? htmlToMarkdown(html) : html
}

export function MarkdownToolbarEditor({
    id,
    value,
    valueFormat,
    placeholder = 'Write here...',
    className,
    contentClassName,
    editorClassName,
    termMentionMatcher = null,
    onTermMentionClick,
    onChange,
}: MarkdownToolbarEditorProps) {
    const t = useTranslations('editor')
    const editorRef = useRef<Editor | null>(null)
    const lastEmittedValueRef = useRef(value)
    const [, setSelectionTick] = useState(0)
    const editorAttributes = useMemo(
        () => ({
            ...(id ? { id } : {}),
            class: cn(
                'min-h-56 min-w-0 px-3 py-2 text-sm leading-7 focus:outline-none',
                '[&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:break-words [&_h1]:[overflow-wrap:anywhere]',
                '[&_h2]:my-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:break-words [&_h2]:[overflow-wrap:anywhere]',
                '[&_h3]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-tight [&_h3]:break-words [&_h3]:[overflow-wrap:anywhere]',
                '[&_p]:my-0 [&_p]:break-words [&_p]:[overflow-wrap:anywhere]',
                '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6',
                '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6',
                '[&_li]:my-1 [&_li]:break-words [&_li]:[overflow-wrap:anywhere]',
                '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
                '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:px-3 [&_pre]:py-2',
                '[&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]',
                '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
                '[&_hr]:my-4 [&_hr]:border-border',
                '[&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground/60 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
                editorClassName
            ),
        }),
        [editorClassName, id]
    )

    const extensions = useMemo(
        () => [
            StarterKit,
            Placeholder.configure({
                placeholder,
            }),
            TermMentionsExtension,
        ],
        [placeholder]
    )

    const editor = useEditor({
        extensions,
        content: toEditorHtml(value, valueFormat),
        parseOptions: {
            preserveWhitespace: 'full',
        },
        immediatelyRender: false,
        editorProps: {
            attributes: editorAttributes,
            handlePaste: (_view, event) => {
                const editorInstance = editorRef.current
                if (!editorInstance) return false

                const text = event.clipboardData?.getData('text/plain') ?? ''
                if (!text.trim()) return false
                if (!isMarkdownLikePaste(text)) return false

                const nextHtml = markdownToHtml(text)
                if (!nextHtml) return false

                event.preventDefault()
                editorInstance.commands.insertContent(nextHtml)
                return true
            },
        },
        autofocus: false,
        onCreate: ({ editor }) => {
            editorRef.current = editor
        },
        onUpdate: ({ editor }) => {
            const nextValue = fromEditorHtml(editor.getHTML(), valueFormat)
            lastEmittedValueRef.current = nextValue
            onChange(nextValue)
        },
        onSelectionUpdate: () => {
            setSelectionTick((current) => current + 1)
        },
    })

    useEffect(() => {
        editorRef.current = editor
    }, [editor])

    useEffect(() => {
        if (!editor) return
        const matcher = termMentionMatcher ?? EMPTY_TERM_MENTION_MATCHER
        editor.view.dispatch(editor.state.tr.setMeta(termMentionsPluginKey, { matcher }))
    }, [editor, termMentionMatcher])

    useEffect(() => {
        if (!editor) return
        if (value === lastEmittedValueRef.current) return

        const nextHtml = toEditorHtml(value, valueFormat)
        if (nextHtml === editor.getHTML()) return

        editor.commands.setContent(nextHtml, {
            emitUpdate: false,
            parseOptions: { preserveWhitespace: 'full' },
        })
        lastEmittedValueRef.current = value
    }, [editor, value, valueFormat])

    const handleClickCapture = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!onTermMentionClick) return
            const target = event.target as HTMLElement | null
            if (!target) return
            const mentionEl = target.closest?.('[data-term-mention="true"][data-term-id]') as HTMLElement | null
            if (!mentionEl) return
            const termId = mentionEl.getAttribute('data-term-id')
            if (!termId) return
            onTermMentionClick(termId, mentionEl)
        },
        [onTermMentionClick]
    )

    if (!editor) {
        return (
            <div className={cn('flex flex-col rounded-md border bg-background', className)}>
                <div className="h-11 border-b" />
                <div className="min-h-56 px-3 py-2" />
            </div>
        )
    }

    return (
        <div className={cn('flex flex-col rounded-md border bg-background', className)} onClickCapture={handleClickCapture}>
            <div className="shrink-0 flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
                {HEADING_CONTROLS.map((control) => {
                    const Icon = control.icon
                    const label = t(`markdownToolbar.${control.id}`)
                    const active = editor.isActive('heading', { level: control.level })

                    return (
                        <Button
                            key={control.id}
                            type="button"
                            variant={active ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            className="h-8 w-8 shrink-0"
                            title={label}
                            aria-label={label}
                            onClick={() => editor.chain().focus().toggleHeading({ level: control.level }).run()}
                        >
                            <Icon className="h-4 w-4" />
                        </Button>
                    )
                })}

                {MARKDOWN_CONTROLS.map((control) => {
                    const Icon = control.icon
                    const label = t(`markdownToolbar.${control.id as MarkdownControlId}`)
                    const active =
                        control.id === 'bold'
                            ? editor.isActive('bold')
                            : control.id === 'italic'
                                ? editor.isActive('italic')
                                : control.id === 'strike'
                                    ? editor.isActive('strike')
                                    : control.id === 'code'
                                        ? editor.isActive('code')
                                        : control.id === 'bullet'
                                            ? editor.isActive('bulletList')
                                            : control.id === 'ordered'
                                                ? editor.isActive('orderedList')
                                                : control.id === 'quote'
                                                    ? editor.isActive('blockquote')
                                                    : false

                    return (
                        <Button
                            key={control.id}
                            type="button"
                            variant={active ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            className="h-8 w-8 shrink-0"
                            title={label}
                            aria-label={label}
                            onClick={() => control.run(editor)}
                        >
                            <Icon className="h-4 w-4" />
                        </Button>
                    )
                })}
            </div>

            <EditorContent editor={editor} className={cn('min-h-0 w-full flex-1 min-w-0 overflow-auto', contentClassName)} />
        </div>
    )
}
