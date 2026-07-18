'use client'

import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { AnyExtension, Editor } from '@tiptap/core'
import { TextSelection } from 'prosemirror-state'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Bold, Italic } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { EMPTY_TERM_MENTION_MATCHER } from '@/components/editor/terms/term-mentions-utils'
import { TermMentionsExtension, termMentionsPluginKey } from '@/components/editor/terms/term-mentions-extension'
import { EditorCommandMenu, type EditorCommandMenuItem } from '@/components/editor/editor-command-menu'

interface TipTapEditorProps {
    content: string
    onChange: (content: string) => void
    placeholder?: string
    className?: string
    autoFocus?: boolean
    termMentionMatcher?: TermMentionMatcher | null
    onTermMentionClick?: (termId: string, anchorEl: HTMLElement) => void
    extraExtensions?: AnyExtension[]
    onEditorReady?: (editor: Editor | null) => void
    onSelectionUpdate?: (editor: Editor) => void
    showSelectionFormatMenu?: boolean
    typewriter?: {
        enabled: boolean
        smooth?: boolean
    }
    commandMenu?: {
        items: EditorCommandMenuItem[]
        onSelect: (id: string, editor: Editor) => void
        triggerKeys?: Array<'tab' | 'slash'>
    }
}

function SelectionFormatMenu({ editor }: { editor: Editor }) {
    const t = useTranslations('editor.markdownToolbar')
    const activeMarks = useEditorState({
        editor,
        selector: ({ editor: currentEditor }) => ({
            bold: currentEditor.isActive('bold'),
            italic: currentEditor.isActive('italic'),
        }),
    })
    const controls = [
        {
            id: 'bold',
            label: t('bold'),
            icon: Bold,
            active: activeMarks.bold,
            toggle: () => editor.chain().focus().toggleBold().run(),
        },
        {
            id: 'italic',
            label: t('italic'),
            icon: Italic,
            active: activeMarks.italic,
            toggle: () => editor.chain().focus().toggleItalic().run(),
        },
    ] as const

    return (
        <BubbleMenu
            editor={editor}
            pluginKey="selectionFormatMenu"
            updateDelay={0}
            shouldShow={({ editor: currentEditor, state, from, to }) => (
                currentEditor.isFocused
                && state.selection instanceof TextSelection
                && !state.selection.empty
                && state.doc.textBetween(from, to, ' ').trim().length > 0
            )}
            options={{
                placement: 'bottom',
                offset: 9,
                flip: { fallbackPlacements: ['top'] },
                shift: { padding: 12 },
                inline: true,
            }}
        >
            <div
                data-selection-format-menu="true"
                className="relative z-50 flex items-center gap-0.5 rounded-xl border border-border/70 bg-popover/95 p-1 text-popover-foreground shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl"
            >
                {controls.map((control) => {
                    const Icon = control.icon
                    return (
                        <Button
                            key={control.id}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                                'size-8 rounded-lg transition-colors',
                                control.active && 'bg-foreground text-background hover:bg-foreground/90 hover:text-background'
                            )}
                            aria-label={control.label}
                            aria-pressed={control.active}
                            title={control.label}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={control.toggle}
                        >
                            <Icon className="size-4" />
                        </Button>
                    )
                })}
            </div>
        </BubbleMenu>
    )
}

export function TipTapEditor({
    content,
    onChange,
    placeholder = '开始写作...',
    className = '',
    autoFocus = false,
    termMentionMatcher = null,
    onTermMentionClick,
    extraExtensions,
    onEditorReady,
    onSelectionUpdate,
    showSelectionFormatMenu = false,
    typewriter,
    commandMenu,
}: TipTapEditorProps) {
    const isInitializing = useRef(true)
    const [commandMenuOpen, setCommandMenuOpen] = useState(false)
    const [commandMenuAnchor, setCommandMenuAnchor] = useState<{ top: number; left: number } | null>(null)
    const typewriterScrollRafRef = useRef<number | null>(null)
    const typewriterRef = useRef<TipTapEditorProps['typewriter']>(typewriter)

    useEffect(() => {
        typewriterRef.current = typewriter
    }, [typewriter])

    const extensions = useMemo(
        () => [
            StarterKit,
            Placeholder.configure({
                placeholder,
            }),
            TermMentionsExtension,
            ...(extraExtensions ?? []),
        ],
        [extraExtensions, placeholder]
    )

    const editor = useEditor({
        extensions,
        content,
        parseOptions: {
            preserveWhitespace: 'full',
        },
        immediatelyRender: false, // Fix SSR hydration mismatch
        editorProps: {
            attributes: {
                class: `prose prose-sm sm:prose max-w-none focus:outline-none min-h-[200px] ${className}`,
            },
        },
        autofocus: autoFocus,
        onUpdate: ({ editor }) => {
            if (!isInitializing.current) {
                onChange(editor.getHTML())
            }

            if (!isInitializing.current) scheduleTypewriterScroll(editor)
        },
        onSelectionUpdate: ({ editor }) => {
            onSelectionUpdate?.(editor)
            if (!isInitializing.current) scheduleTypewriterScroll(editor)
        },
    })

    const scheduleTypewriterScroll = useCallback(
        (currentEditor: Editor) => {
            const config = typewriterRef.current
            if (!config?.enabled) return
            if (!currentEditor.isFocused) return

            if (typewriterScrollRafRef.current !== null) {
                cancelAnimationFrame(typewriterScrollRafRef.current)
            }

            typewriterScrollRafRef.current = requestAnimationFrame(() => {
                typewriterScrollRafRef.current = null
                try {
                    const scrollContainer = currentEditor.view.dom.closest?.('.onw-editor-scrollbar') as HTMLElement | null
                    if (!scrollContainer) return

                    const selectionPos = currentEditor.state.selection.from
                    const coords = currentEditor.view.coordsAtPos(selectionPos)
                    const cursorY = (coords.top + coords.bottom) / 2

                    const containerRect = scrollContainer.getBoundingClientRect()
                    const cursorRelY = cursorY - containerRect.top
                    const targetRelY = containerRect.height / 2
                    const delta = cursorRelY - targetRelY

                    if (Math.abs(delta) < 24) return

                    const nextTop = scrollContainer.scrollTop + delta
                    scrollContainer.scrollTo({
                        top: nextTop,
                        behavior: config.smooth ? 'smooth' : 'auto',
                    })
                } catch (error) {
                    console.error('Typewriter scroll failed:', error)
                }
            })
        },
        []
    )

    useEffect(() => {
        onEditorReady?.(editor ?? null)
        return () => onEditorReady?.(null)
    }, [editor, onEditorReady])

    useEffect(() => {
        return () => {
            if (typewriterScrollRafRef.current !== null) {
                cancelAnimationFrame(typewriterScrollRafRef.current)
            }
        }
    }, [])

    const commandMenuTriggerKeys = useMemo(() => commandMenu?.triggerKeys ?? ['tab'], [commandMenu?.triggerKeys])

    // Sync content when it changes externally
    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            isInitializing.current = true
            editor.commands.setContent(content, {
                emitUpdate: false,
                parseOptions: { preserveWhitespace: 'full' },
            })
            // Allow a moment for the content to be set
            setTimeout(() => {
                isInitializing.current = false
            }, 100)
        }
    }, [editor, content])

    // Mark initialization as done after first render
    useEffect(() => {
        if (editor) {
            const timer = setTimeout(() => {
                isInitializing.current = false
            }, 100)
            return () => clearTimeout(timer)
        }
    }, [editor])

    // Refresh mention decorations when the matcher changes (e.g., alias/color updates).
    useEffect(() => {
        if (!editor) return
        const matcher = termMentionMatcher ?? EMPTY_TERM_MENTION_MATCHER
        editor.view.dispatch(editor.state.tr.setMeta(termMentionsPluginKey, { matcher }))
    }, [editor, termMentionMatcher])

    const openCommandMenu = useCallback(() => {
        if (!commandMenu || !editor) return
        try {
            const selectionPos = editor.state.selection.from
            const coords = editor.view.coordsAtPos(selectionPos)
            setCommandMenuAnchor({ top: coords.bottom + 8, left: coords.left })
            setCommandMenuOpen(true)
        } catch (error) {
            console.error('Failed to open editor command menu:', error)
        }
    }, [commandMenu, editor])

    const handleKeyDownCapture = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (!commandMenu || commandMenu.items.length === 0) return
            const target = event.target as HTMLElement | null
            if (target) {
                const tag = target.tagName
                if (
                    tag === 'INPUT' ||
                    tag === 'TEXTAREA' ||
                    tag === 'SELECT' ||
                    tag === 'BUTTON' ||
                    target.closest?.('[contenteditable="false"]')
                ) {
                    return
                }
            }

            if (commandMenuOpen) {
                if (event.key === 'Escape') {
                    event.preventDefault()
                    setCommandMenuOpen(false)
                }
                return
            }

            const wantsTab = commandMenuTriggerKeys.includes('tab') && event.key === 'Tab'
            const wantsSlash =
                commandMenuTriggerKeys.includes('slash') &&
                event.key === '/' &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey

            if (!wantsTab && !wantsSlash) return

            event.preventDefault()
            event.stopPropagation()
            openCommandMenu()
        },
        [commandMenu, commandMenuOpen, commandMenuTriggerKeys, openCommandMenu]
    )

    const handleClickCapture = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            if (!onTermMentionClick) return
            if (!editor || !editor.state.selection.empty) return
            const target = event.target as HTMLElement | null
            if (!target) return
            const mentionEl = target.closest?.('[data-term-mention="true"][data-term-id]') as HTMLElement | null
            if (!mentionEl) return
            const termId = mentionEl.getAttribute('data-term-id')
            if (!termId) return
            onTermMentionClick(termId, mentionEl)
        },
        [editor, onTermMentionClick]
    )

    return (
        <div className="w-full" onClickCapture={handleClickCapture} onKeyDownCapture={handleKeyDownCapture}>
            <EditorContent editor={editor} className="w-full" />
            {showSelectionFormatMenu && editor && <SelectionFormatMenu editor={editor} />}
            {commandMenu && (
                <EditorCommandMenu
                    open={commandMenuOpen}
                    items={commandMenu.items}
                    anchor={commandMenuAnchor}
                    onSelect={(id) => {
                        setCommandMenuOpen(false)
                        if (!editor) return
                        commandMenu.onSelect(id, editor)
                    }}
                    onClose={() => setCommandMenuOpen(false)}
                />
            )}
        </div>
    )
}
