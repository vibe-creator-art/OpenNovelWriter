import { createPromptContentResolvers } from '@/lib/prompt-content-resolvers'
import { continuationConversationMarkdown, type ContinuationInputs } from '@/lib/continuation-prompt'
import { prisma } from '@/lib/db'
import { htmlToText } from '@/lib/html-to-text'
import { buildNovelOutlineTexts } from '@/lib/novel-outline'
import { collectIncludedComponentPrompts, extractStringArgCallsFromMessages } from '@/lib/prompt-template'
import { renderPromptTemplateMessages, type PromptTemplateRenderResolvers } from '@/lib/prompt-template-render'
import { deduplicateContentSelections, indexPromptInputs, normalizePromptInputValue, renderPromptCustomInputValue } from '@/lib/prompt-inputs'
import { getTermStateEntries } from '@/lib/term-state'
import {
    renderTermTemplateText,
    renderTermTemplateValue,
} from '@/lib/term-template'
import { buildTermMentionMatcher, findMentionedTermIds } from '@/components/editor/terms/term-mentions-utils'
import type { CustomTermCategory, TermEntry } from '@/components/editor/terms/types'
import { toPromptDto } from '@/lib/server/prompt-helpers'

export type ComposedContinuation = {
    markdown: string
    promptName: string
    groups: Array<{ id: string; name: string }>
    missingInputs: string[]
}

function normalizeKey(value: string) {
    return value.trim().toLowerCase()
}

async function loadAgentPromptByName(ownerId: string, promptName: string) {
    const wanted = normalizeKey(promptName)
    if (!wanted) return null
    const records = await prisma.prompt.findMany({ where: { ownerId } })
    const dtos = records.map(toPromptDto)
    const prompt = dtos.find((item) => normalizeKey(item.name) === wanted) ?? null
    if (!prompt || prompt.category !== 'scene_continuation') return { dtos, prompt: null }
    return { dtos, prompt }
}

async function resolveBoundGroups(ownerId: string, modelGroupIds: string[]) {
    const boundGroupIds = modelGroupIds.filter((id) => id.trim())
    if (boundGroupIds.length === 0) return []
    const records = await prisma.aiModelGroup.findMany({
        where: { id: { in: boundGroupIds }, ownerId },
        select: { id: true, name: true },
    })
    const byId = new Map(records.map((record) => [record.id, record]))
    return boundGroupIds
        .map((id) => byId.get(id) ?? null)
        .filter((group): group is { id: string; name: string } => group !== null)
}

function toTermEntry(raw: Record<string, unknown>): TermEntry | null {
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id) return null
    // Term state stores TermEntry-shaped records; pass them through (the consuming helpers only read
    // title/aliases/categoryId/subtitle/description/experiences/researchNotes/archived/color/aiContextPolicy).
    return raw as unknown as TermEntry
}

/** Split the scene prose so a virtual continuation panel sits right after `afterText`. */
function splitSceneAtAnchor(sceneText: string, afterText: string) {
    const anchor = afterText.trim()
    if (!anchor) {
        // Empty anchor = insert at the very front (panel before all prose).
        return { previousText: '', followText: sceneText.trim() }
    }
    const first = sceneText.indexOf(anchor)
    if (first === -1) {
        throw new Error(`afterParagraph was not found in the scene prose. Copy an exact run of existing scene text, or omit it to insert at the front.`)
    }
    if (sceneText.indexOf(anchor, first + anchor.length) !== -1) {
        throw new Error(`afterParagraph "${anchor.slice(0, 40)}…" matches more than one place in the scene. Add surrounding context so it is unique.`)
    }
    const splitAt = first + anchor.length
    return {
        previousText: sceneText.slice(0, splitAt).trim(),
        followText: sceneText.slice(splitAt).trim(),
    }
}

export async function composeSceneContinuation(params: {
    ownerId: string
    promptName: string
    novelId: string
    sceneId: string
    instruction: string
    inputs?: ContinuationInputs
    afterParagraph?: string
}): Promise<{ ok: true; result: ComposedContinuation } | { ok: false; detail: string }> {
    const loaded = await loadAgentPromptByName(params.ownerId, params.promptName)
    if (!loaded || !loaded.prompt) {
        return {
            ok: false,
            detail: `No scene-continuation prompt named "${params.promptName}" was found.`,
        }
    }
    const { dtos, prompt } = loaded

    const scene = await prisma.scene.findFirst({
        where: { id: params.sceneId, chapter: { novelId: params.novelId, novel: { ownerId: params.ownerId } } },
        select: { id: true, content: true, chapterId: true, chapter: { select: { id: true, actNumber: true } } },
    })
    if (!scene) {
        return { ok: false, detail: `Scene ${params.sceneId} was not found in novel ${params.novelId}.` }
    }

    const [novel, termState, outlines, snippets] = await Promise.all([
        prisma.novel.findFirst({
            where: { id: params.novelId, ownerId: params.ownerId },
            select: {
                language: true,
                labels: { select: { id: true } },
                termContextIncludesRelations: true,
                termContextIncludesExperiences: true,
                acts: { select: { number: true, title: true, summary: true, labelIdsJson: true } },
                chapters: {
                    select: {
                        id: true,
                        title: true,
                        actNumber: true,
                        order: true,
                        scenes: { select: { id: true, order: true, summary: true, content: true, labelIdsJson: true } },
                    },
                },
            },
        }),
        prisma.novelTermState.findUnique({ where: { novelId: params.novelId }, select: { stateJson: true } }),
        prisma.outline.findMany({ where: { novelId: params.novelId } }),
        prisma.snippet.findMany({ where: { novelId: params.novelId }, select: { id: true, title: true, content: true } }),
    ])
    if (!novel) {
        return { ok: false, detail: `Novel ${params.novelId} was not found.` }
    }

    // Term context (for instruction.terms auto-detection + rendering), parsed the same way the editor does.
    let termState_parsed: unknown = {}
    try {
        termState_parsed = termState?.stateJson ? JSON.parse(termState.stateJson) : {}
    } catch {
        termState_parsed = {}
    }
    const termEntries = getTermStateEntries(termState_parsed)
        .map(toTermEntry)
        .filter((entry): entry is TermEntry => entry !== null)
    const termsById = new Map(termEntries.map((entry) => [entry.id, entry]))
    const customCategories = Array.isArray((termState_parsed as { customCategories?: unknown }).customCategories)
        ? ((termState_parsed as { customCategories?: CustomTermCategory[] }).customCategories ?? undefined)
        : undefined

    const matcher = buildTermMentionMatcher(termEntries)
    const instructionTermIds = [...findMentionedTermIds(params.instruction, matcher)]

    // Scene prose + the virtual insertion split (mirrors the manual panel: paragraphs joined by '\n').
    const sceneText = htmlToText(scene.content ?? '', { paragraphSeparator: '\n' })
    const { previousText, followText } = splitSceneAtAnchor(sceneText, params.afterParagraph ?? '')

    const outline = buildNovelOutlineTexts({
        acts: novel.acts,
        chapters: novel.chapters,
        currentChapterId: scene.chapterId,
        currentSceneId: scene.id,
        language: novel.language,
    })

    const outlineTextByChapterId = new Map(outlines.filter((item) => item.type === 'CHAPTER' && item.chapterId).map((item) => [item.chapterId!, htmlToText(item.content, { paragraphSeparator: '\n' }).trim()]))
    const outlineTextByActNumber = new Map(outlines.filter((item) => item.type === 'ACT' && item.actNumber != null).map((item) => [item.actNumber!, htmlToText(item.content, { paragraphSeparator: '\n' }).trim()]))
    const chapterOutlineText = outlineTextByChapterId.get(scene.chapterId) ?? ''
    const actOutlineText = outlineTextByActNumber.get(scene.chapter.actNumber) ?? ''
    const labelIds = (text: string): string[] => JSON.parse(text)
    const acts = novel.acts.map((act) => ({ ...act, labelIds: labelIds(act.labelIdsJson) }))
    const chapters = novel.chapters.map((chapter) => ({ ...chapter, scenes: chapter.scenes.map((item) => ({ ...item, labelIds: labelIds(item.labelIdsJson) })) }))
    const componentByKey = new Map<string, (typeof dtos)[number]>()
    for (const item of dtos) {
        if (item.category !== 'component') continue
        const key = normalizeKey(item.name)
        if (key && !componentByKey.has(key)) componentByKey.set(key, item)
    }
    const { included } = collectIncludedComponentPrompts({
        rootMessages: prompt.messages,
        resolveComponentByNameKey: (key) => componentByKey.get(key) ?? null,
    })
    const inputByKey = indexPromptInputs([
        ...prompt.inputs,
        ...included.flatMap((item) => item.prompt.inputs),
    ])
    const custom = new Map(Object.entries(params.inputs?.custom ?? {}).map(([name, value]) => [normalizeKey(name), value]))
    const checkbox = new Map(Object.entries(params.inputs?.checkbox ?? {}).map(([name, value]) => [normalizeKey(name), value]))
    const selected = new Map(Object.entries(params.inputs?.contentSelection ?? {}).map(([name, value]) => [normalizeKey(name), deduplicateContentSelections(value)]))
    for (const [values, type] of [[custom, 'custom'], [checkbox, 'checkbox'], [selected, 'content_selection']] as const) {
        for (const name of values.keys()) {
            if (inputByKey.get(name)?.type !== type) return { ok: false, detail: `Unknown or incorrectly typed prompt input: ${name}` }
        }
    }
    for (const [name, value] of custom) {
        const input = inputByKey.get(name)!
        if (input.type !== 'custom') continue
        const ids = value.dropdownOptionIds ?? []
        const text = value.text ?? ''
        const { dropdown, text: textConfig } = input.custom
        if (ids.length && !dropdown.enabled) return { ok: false, detail: `${input.name} does not allow dropdown selections.` }
        if (text && !textConfig.enabled) return { ok: false, detail: `${input.name} does not allow free text.` }
        if (!dropdown.allowMultiple && ids.length > 1) return { ok: false, detail: `${input.name} accepts one dropdown option.` }
        if (!dropdown.allowMultiple && ids.length && text) return { ok: false, detail: `${input.name} accepts either a dropdown option or free text, not both.` }
        if (new Set(ids).size !== ids.length) return { ok: false, detail: `${input.name} cannot select the same dropdown option twice.` }
        for (const id of ids) {
            if (!dropdown.options.some((option) => option.id === id)) return { ok: false, detail: `Unknown dropdown option ID in ${input.name}: ${id}` }
        }
    }
    for (const [name, refs] of selected) {
        const input = inputByKey.get(name)!
        if (input.type !== 'content_selection') continue
        if (!input.contentSelection.allowMultiple && refs.length > 1) return { ok: false, detail: `${input.name} accepts one selection.` }
        const options = input.contentSelection.options
        for (const ref of refs) {
            let valid = false
            switch (ref.kind) {
                case 'full_novel': valid = options.fullNovel.enabled; break
                case 'act': valid = options.act.enabled && acts.some((item) => item.number === ref.actNumber); break
                case 'chapter': valid = options.chapter.enabled && chapters.some((item) => item.id === ref.chapterId); break
                case 'scene': valid = options.scene.enabled && chapters.some((item) => item.scenes.some((scene) => scene.id === ref.sceneId)); break
                case 'act_outline': valid = options.outline.enabled && options.outline.act.enabled && outlineTextByActNumber.has(ref.actNumber); break
                case 'chapter_outline': valid = options.outline.enabled && options.outline.chapter.enabled && outlineTextByChapterId.has(ref.chapterId); break
                case 'snippet': valid = options.snippet.enabled && snippets.some((item) => item.id === ref.snippetId); break
                case 'label': valid = options.label.enabled && novel.labels.some((item) => item.id === ref.labelId); break
                case 'term_tag': valid = options.termTag.enabled && termEntries.some((item) => !item.archived && item.tags?.some((tag) => normalizeKey(tag) === normalizeKey(ref.tag))); break
                case 'term': {
                    const term = termsById.get(ref.termId)
                    const key = term && Object.hasOwn(options.term.allowedTypes, term.categoryId) ? term.categoryId as keyof typeof options.term.allowedTypes : 'others'
                    valid = options.term.enabled && Boolean(term && !term.archived) && options.term.allowedTypes[key]
                    break
                }
            }
            if (!valid) return { ok: false, detail: `Unavailable or disallowed selection in ${input.name}: ${JSON.stringify(ref)}` }
        }
    }
    const resolveTermValue = (termId: string) =>
        renderTermTemplateValue({
            entry: termsById.get(termId) ?? null,
            termsById,
            includeRelations: novel.termContextIncludesRelations,
            includeExperiences: novel.termContextIncludesExperiences,
            locale: novel.language,
            customCategories,
        }) || null

    const contentResolvers = createPromptContentResolvers({
        getInput: (name) => {
            const input = inputByKey.get(normalizeKey(name))
            if (input?.type !== 'content_selection') return null
            const value = normalizePromptInputValue(input, selected.get(normalizeKey(name)) ?? [])
            return { input, selections: value.kind === 'content_selection' ? value.selections : [] }
        },
        resources: {
            acts, chapters, chaptersById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
            scenesById: new Map(chapters.flatMap((chapter) => chapter.scenes.map((item) => [item.id, item] as const))),
            novelOutlineFull: outline.full, outlineTextByActNumber, outlineTextByChapterId,
        },
        termsById, snippets, resolveTermValue, locale: novel.language,
    })
    const resolveInput = (name: string): string | null => {
        const key = normalizeKey(name)
        const input = inputByKey.get(key)
        if (!input) return null
        if (input.type === 'content_selection') return contentResolvers.resolveValue(name)
        if (input.type === 'checkbox') return (checkbox.get(key) ?? input.checkbox.defaultChecked) ? (input.checkbox.displayName || input.name).trim() : ''
        const value = normalizePromptInputValue(input, custom.get(key))
        return value.kind === 'custom' ? renderPromptCustomInputValue(input, value) : ''
    }
    const resolveInclude = (name: string): string | null => {
        const component = componentByKey.get(normalizeKey(name))
        return component?.messages?.[0]?.content ?? null
    }
    const referencedInputs = new Set([prompt, ...included.map((item) => item.prompt)]
        .flatMap((item) => extractStringArgCallsFromMessages(item.messages, 'input')).map(normalizeKey))
    const missingInputs = [...referencedInputs].flatMap((key) => {
        const input = inputByKey.get(key)
        return input?.required && !resolveInput(input.name)?.trim() ? [input.name] : []
    })

    const resolvers: PromptTemplateRenderResolvers = {
        resolveInput,
        resolveInclude,
        ...contentResolvers.resolvers,
        resolveTextTermIds: (text) => [...findMentionedTermIds(text, matcher)],
        resolveTermText: (termId) => renderTermTemplateText(termsById.get(termId) ?? null) || null,
        resolveTermValue,
    }

    const context = {
        novelLanguage: novel.language ?? null,
        novelOutlineFull: outline.full,
        novelOutlineStorySoFar: outline.storysofar,
        sceneText,
        sceneContinuePreviousText: previousText,
        sceneContinueFollowText: followText,
        sceneContinueHasPreviousText: previousText.trim().length > 0,
        sceneContinueHasFollowText: followText.trim().length > 0,
        sceneChapterOutline: chapterOutlineText,
        sceneActOutline: actOutlineText,
        instructionText: params.instruction,
        instructionTerms: instructionTermIds,
    }

    const renderedMessages = renderPromptTemplateMessages({
        texts: (prompt.messages ?? []).map((message) => message.content ?? ''),
        context,
        resolvers,
    })
    const renderedBlocks = (prompt.messages ?? []).map((message, index) => ({
        role: message.role,
        text: (renderedMessages.texts[index] ?? '').trim(),
    }))

    const groups = await resolveBoundGroups(params.ownerId, prompt.modelGroupIds ?? [])
    const markdown = continuationConversationMarkdown(renderedBlocks.map((block) => ({ role: block.role, content: block.text })))

    return {
        ok: true,
        result: {
            markdown,
            promptName: prompt.name,
            groups,
            missingInputs: [...new Set(missingInputs)],
        },
    }
}
