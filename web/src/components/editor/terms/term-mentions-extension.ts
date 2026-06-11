import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { EMPTY_TERM_MENTION_MATCHER, getMentionDecoration, toMentionPhraseKey, type TermMentionMatcher } from './term-mentions-utils'

export const termMentionsPluginKey = new PluginKey('termMentions')

export type TermMentionsMeta = {
    matcher?: TermMentionMatcher | null
    refresh?: boolean
}

function buildDecorations(doc: Parameters<typeof DecorationSet.create>[0], matcher: TermMentionMatcher) {
    if (!matcher.regex || matcher.tokenByPhraseKey.size === 0) {
        return DecorationSet.empty
    }

    const decorations: Decoration[] = []
    const regex = matcher.regex

    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return

        const text = node.text
        regex.lastIndex = 0

        let m: RegExpExecArray | null = null
        while ((m = regex.exec(text))) {
            const value = m[0] ?? ''
            if (!value) {
                regex.lastIndex = (m.index ?? 0) + 1
                continue
            }

            const token = matcher.tokenByPhraseKey.get(toMentionPhraseKey(value))
            if (!token) continue

            const from = pos + (m.index ?? 0)
            const to = from + value.length
            const { className, style } = getMentionDecoration(token)

            const attrs: Record<string, string> = {
                class: className,
                'data-term-id': token.termId,
                'data-term-mention': 'true',
            }
            if (style) attrs.style = style

            decorations.push(
                Decoration.inline(from, to, {
                    ...attrs,
                })
            )
        }
    })

    return DecorationSet.create(doc, decorations)
}

type TermMentionsPluginState = {
    matcher: TermMentionMatcher
    decorations: DecorationSet
}

export const TermMentionsExtension = Extension.create({
    name: 'termMentions',

    addProseMirrorPlugins() {
        return [
            new Plugin<TermMentionsPluginState>({
                key: termMentionsPluginKey,
                state: {
                    init: (_config, state) => {
                        const matcher = EMPTY_TERM_MENTION_MATCHER
                        return { matcher, decorations: buildDecorations(state.doc, matcher) }
                    },
                    apply: (tr, old, _oldState, newState) => {
                        const meta = tr.getMeta(termMentionsPluginKey) as TermMentionsMeta | undefined
                        const nextMatcher = meta?.matcher ? meta.matcher : meta?.matcher === null ? EMPTY_TERM_MENTION_MATCHER : old.matcher
                        const matcherChanged = nextMatcher !== old.matcher

                        if (tr.docChanged || meta?.refresh || matcherChanged) {
                            return { matcher: nextMatcher, decorations: buildDecorations(newState.doc, nextMatcher) }
                        }
                        return { matcher: nextMatcher, decorations: old.decorations.map(tr.mapping, tr.doc) }
                    },
                },
                props: {
                    decorations: (state) => termMentionsPluginKey.getState(state)?.decorations,
                },
            }),
        ]
    },
})
