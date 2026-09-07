'use client'

import type { Editor } from '@tiptap/core'
import type { SelectionBookmark } from 'prosemirror-state'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { EditorCommandMenuItem } from '@/components/editor/editor-command-menu'

export function MobileEditorCommands({ editor, items, onSelect }: {
    editor: Editor
    items: EditorCommandMenuItem[]
    onSelect: (id: string, editor: Editor) => void
}) {
    const t = useTranslations('editor.scene')
    const isMobile = useIsMobile()
    const [focused, setFocused] = useState(false)
    const [open, setOpen] = useState(false)
    const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number; width: number } | null>(null)
    const selectionRef = useRef<SelectionBookmark | null>(null)
    const selectedCommandRef = useRef<string | null>(null)

    useEffect(() => {
        if (!isMobile) return
        const handleFocus = () => setFocused(true)
        const handleBlur = () => setFocused(false)
        editor.on('focus', handleFocus)
        editor.on('blur', handleBlur)
        return () => {
            editor.off('focus', handleFocus)
            editor.off('blur', handleBlur)
        }
    }, [editor, isMobile])

    useLayoutEffect(() => {
        if (!isMobile || !focused) return
        const viewport = window.visualViewport
        const updatePosition = () => {
            setToolbarPosition({
                top: viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
                left: viewport?.offsetLeft ?? 0,
                width: viewport?.width ?? window.innerWidth,
            })
        }
        updatePosition()
        viewport?.addEventListener('resize', updatePosition)
        viewport?.addEventListener('scroll', updatePosition)
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition)
        return () => {
            viewport?.removeEventListener('resize', updatePosition)
            viewport?.removeEventListener('scroll', updatePosition)
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition)
        }
    }, [focused, isMobile])

    const openCommands = () => {
        selectionRef.current = editor.state.selection.getBookmark()
        selectedCommandRef.current = null
        setOpen(true)
        editor.commands.blur()
    }

    if (!isMobile || items.length === 0) return null

    return (
        <>
            {focused && !open && toolbarPosition && createPortal(
                <div
                    role="toolbar"
                    aria-label={t('aiActions')}
                    className="fixed z-40 flex -translate-y-full justify-end border-t bg-background/95 px-3 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] shadow-sm backdrop-blur md:hidden"
                    style={toolbarPosition}
                >
                    <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 gap-2 px-4"
                        aria-label={t('aiActions')}
                        aria-haspopup="dialog"
                        onPointerDown={(event) => {
                            if (event.button !== 0 || !event.isPrimary) return
                            event.preventDefault()
                            openCommands()
                        }}
                        onClick={openCommands}
                    >
                        <Sparkles className="size-4" />
                        AI
                    </Button>
                </div>,
                document.body
            )}
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent
                    side="bottom"
                    className="max-h-[70dvh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
                    aria-describedby={undefined}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        const commandId = selectedCommandRef.current
                        selectedCommandRef.current = null
                        if (!commandId || !selectionRef.current || editor.isDestroyed) return
                        editor.view.dispatch(editor.state.tr.setSelection(selectionRef.current.resolve(editor.state.doc)))
                        onSelect(commandId, editor)
                        editor.commands.scrollIntoView()
                    }}
                >
                    <SheetHeader className="pr-14">
                        <SheetTitle>{t('aiActions')}</SheetTitle>
                    </SheetHeader>
                    <div className="min-h-0 overflow-y-auto overscroll-contain px-3">
                        {items.map((item) => (
                            <Button
                                key={item.id}
                                type="button"
                                variant="ghost"
                                className="h-auto min-h-12 w-full justify-start gap-3 whitespace-normal px-3 py-3 text-left"
                                disabled={item.disabled}
                                onClick={() => {
                                    selectedCommandRef.current = item.id
                                    setOpen(false)
                                }}
                            >
                                <span className="shrink-0" aria-hidden>{item.icon}</span>
                                <span>
                                    <span className="block">{item.title}</span>
                                    {item.description && <span className="block text-muted-foreground">{item.description}</span>}
                                </span>
                            </Button>
                        ))}
                    </div>
                </SheetContent>
            </Sheet>
        </>
    )
}
