'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useMemo } from 'react'
import { SceneContinuationPanel } from '@/components/editor/scene-continuation-panel'
import { useSceneContinuationContext } from '@/components/editor/scene-continuation-context'
import { plainTextToTiptapHtml } from '@/lib/plain-text-to-tiptap-html'
import { subscribeContinuationPanelRemoved } from '@/lib/continuation-panel-events'

export function createSceneContinuationPanelId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }

    return `scp_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

function SceneContinuationNodeView({ editor, node, getPos, updateAttributes }: ReactNodeViewProps) {
    const ctx = useSceneContinuationContext()
    const panelId = useMemo(() => String(node.attrs.panelId ?? '').trim(), [node.attrs.panelId])
    const skillId = useMemo(() => String(node.attrs.skillId ?? '').trim(), [node.attrs.skillId])
    const codexSessionId = useMemo(() => String(node.attrs.codexSessionId ?? '').trim(), [node.attrs.codexSessionId])

    useEffect(() => {
        if (panelId) return
        updateAttributes({ panelId: createSceneContinuationPanelId() })
    }, [panelId, updateAttributes])

    const handleApplyContinuation = useCallback(
        (_sceneId: string, continuation: string) => {
            const continuationHtml = plainTextToTiptapHtml(continuation)
            if (!continuationHtml) return

            const pos = typeof getPos === 'function' ? getPos() : null
            if (typeof pos === 'number') {
                editor.commands.insertContentAt(pos + node.nodeSize, continuationHtml)
                return
            }

            editor.commands.insertContent(continuationHtml)
        },
        [editor.commands, getPos, node.nodeSize]
    )

    const removeNode = useCallback(() => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (typeof pos !== 'number') return
        editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize })
    }, [editor.commands, getPos, node.nodeSize])

    // When the paired Codex session is deleted elsewhere, the server already stripped this panel
    // from the stored scene HTML — drop the live node before the next autosave re-persists it.
    useEffect(() => {
        if (!panelId) return
        return subscribeContinuationPanelRemoved((removedPanelId) => {
            if (removedPanelId === panelId) removeNode()
        })
    }, [panelId, removeNode])

    const handleSetCodexSessionId = useCallback(
        (nextSessionId: string) => updateAttributes({ codexSessionId: nextSessionId }),
        [updateAttributes]
    )

    return (
        <NodeViewWrapper className="not-prose my-4 font-sans text-base leading-normal" contentEditable={false} data-panel-id={panelId || undefined}>
            <SceneContinuationPanel
                novelId={ctx.novelId}
                chapterId={ctx.chapterId}
                chapterTitle={ctx.chapterTitle}
                sceneId={ctx.sceneId}
                panelId={panelId || undefined}
                skillId={skillId || undefined}
                codexSessionId={codexSessionId || undefined}
                scenes={ctx.scenes}
                localEdits={ctx.localEdits}
                ensureComponentPrompts={ctx.ensureComponentPrompts}
                ensureNovelData={ctx.ensureNovelData}
                termMentionMatcher={ctx.termMentionMatcher}
                termEntries={ctx.termEntries}
                onApplyContinuation={handleApplyContinuation}
                onOpenRightSidebar={ctx.onOpenRightSidebar}
                onSetCodexSessionId={handleSetCodexSessionId}
                onClose={removeNode}
            />
        </NodeViewWrapper>
    )
}

export const SceneContinuationNode = Node.create({
    name: 'sceneContinuation',

    group: 'block',

    atom: true,
    selectable: true,
    draggable: true,
    isolating: true,
    defining: true,
    allowGapCursor: true,

    addAttributes() {
        return {
            panelId: {
                default: '',
                parseHTML: (element) => element.getAttribute('data-panel-id') ?? '',
                renderHTML: (attributes) => {
                    const value = String(attributes.panelId ?? '').trim()
                    if (!value) return {}
                    return { 'data-panel-id': value }
                },
            },
            skillId: {
                default: '',
                parseHTML: (element) => element.getAttribute('data-skill-id') ?? '',
                renderHTML: (attributes) => {
                    const value = String(attributes.skillId ?? '').trim()
                    if (!value) return {}
                    return { 'data-skill-id': value }
                },
            },
            codexSessionId: {
                default: '',
                parseHTML: (element) => element.getAttribute('data-codex-session-id') ?? '',
                renderHTML: (attributes) => {
                    const value = String(attributes.codexSessionId ?? '').trim()
                    if (!value) return {}
                    return { 'data-codex-session-id': value }
                },
            },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'onw-scene-continuation',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['onw-scene-continuation', mergeAttributes(HTMLAttributes)]
    },

    addNodeView() {
        return ReactNodeViewRenderer(SceneContinuationNodeView)
    },
})
