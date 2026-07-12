import { prisma } from '@/lib/db'
import { htmlToText } from '@/lib/html-to-text'
import { buildNovelOutlineTexts } from '@/lib/novel-outline'
import { renderPromptTemplateMessages, type PromptTemplateRenderResolvers } from '@/lib/prompt-template-render'
import type { PromptInputDefinition } from '@/lib/prompt-inputs'
import { getTermStateEntries } from '@/lib/term-state'
import {
    renderTermTemplateText,
    renderTermTemplateValue,
    resolveTrackedTermIds,
} from '@/lib/term-template'
import { buildTermMentionMatcher, findMentionedTermIds } from '@/components/editor/terms/term-mentions-utils'
import type { CustomTermCategory, TermEntry } from '@/components/editor/terms/types'
import { toPromptDto } from '@/lib/server/prompt-helpers'

/**
 * Server-side equivalent of what the scene-continuation panel does on the client: resolve a saved
 * prompt against a concrete scene + a Codex-supplied instruction and inputs, and render it into a
 * `## system` / `## user` conversation markdown. Lets Codex assemble the exact same artifact the
 * panel would — without a real panel. The two MCP tools (`describe_prompt`, `compose_scene_continuation`)
 * back onto these functions.
 *
 * Scope: `custom` and `checkbox` inputs are filled from Codex-provided values (falling back to
 * their defaults); `content_selection` inputs are always left at their default (empty) — Codex does
 * not pick extra content. A required `content_selection` cannot be satisfied this way, so it is
 * surfaced as unsupported.
 */

type ComposeInputs = {
    custom?: Record<string, string>
    checkbox?: Record<string, boolean>
}

export type DescribedPromptInput =
    | {
          name: string
          type: 'custom'
          required: boolean
          allowFreeText: boolean
          allowMultiple: boolean
          dropdownOptions: Array<{ label: string; content: string }>
          defaultValue: string
      }
    | {
          name: string
          type: 'checkbox'
          required: boolean
          displayName: string
          defaultChecked: boolean
      }
    | {
          name: string
          type: 'content_selection'
          required: boolean
          /** Always false: Codex cannot fill content_selection inputs (left at default). */
          fillable: false
      }

export type DescribedPrompt = {
    name: string
    category: string
    groups: Array<{ id: string; name: string }>
    inputs: DescribedPromptInput[]
    /**
     * Names of required `content_selection` inputs. When non-empty, this prompt cannot be assembled
     * by Codex (a real panel is required); tell the author it is not supported yet.
     */
    unsupportedRequiredContentSelection: string[]
}

export type ComposedContinuation = {
    markdown: string
    promptName: string
    groups: Array<{ id: string; name: string }>
    /** Names of required custom inputs that had no value and no default. */
    missingInputs: string[]
    /** Names of required content_selection inputs (left empty — not supported). */
    unsupportedRequiredContentSelection: string[]
}

function normalizeKey(value: string) {
    return value.trim().toLowerCase()
}

function buildDefaultCustomValue(input: Extract<PromptInputDefinition, { type: 'custom' }>) {
    const state = input.custom.defaultContent
    const allowMultiple = input.custom.dropdown.allowMultiple
    const selectedIds = allowMultiple ? state.dropdownOptionIds : state.dropdownOptionIds.slice(0, 1)
    const options = input.custom.dropdown.options ?? []

    const optionParts = selectedIds
        .map((id) => options.find((option) => option.id === id) ?? null)
        .filter((option): option is NonNullable<typeof option> => option !== null)
        .map((option) => (option.content?.trim() ? option.content.trim() : option.label.trim()))
        .filter(Boolean)

    const textPart = state.text?.trim() ?? ''
    return [...optionParts, textPart].filter((part) => part.trim()).join('\n\n').trim()
}

async function loadAgentPromptByName(ownerId: string, promptName: string) {
    const wanted = normalizeKey(promptName)
    if (!wanted) return null
    const records = await prisma.prompt.findMany({ where: { ownerId } })
    const dtos = records.map(toPromptDto)
    const prompt = dtos.find((item) => normalizeKey(item.name) === wanted) ?? null
    // Only prompts that opted into Codex call (allowAgentCall) and are not components can back a skill.
    if (!prompt || prompt.category === 'component' || prompt.allowAgentCall !== true) return { dtos, prompt: null }
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

export async function describePromptForAgent(params: {
    ownerId: string
    promptName: string
}): Promise<{ ok: true; prompt: DescribedPrompt } | { ok: false; detail: string }> {
    const loaded = await loadAgentPromptByName(params.ownerId, params.promptName)
    if (!loaded || !loaded.prompt) {
        return {
            ok: false,
            detail: `No Codex-callable prompt named "${params.promptName}" was found. The prompt must exist and have "允许 Agent 调用" enabled.`,
        }
    }
    const prompt = loaded.prompt

    const unsupportedRequiredContentSelection: string[] = []
    const inputs: DescribedPromptInput[] = (prompt.inputs ?? []).map((input): DescribedPromptInput => {
        if (input.type === 'checkbox') {
            return {
                name: input.name,
                type: 'checkbox',
                required: input.required,
                displayName: (input.checkbox.displayName || input.name).trim(),
                defaultChecked: input.checkbox.defaultChecked,
            }
        }
        if (input.type === 'content_selection') {
            if (input.required) unsupportedRequiredContentSelection.push(input.name)
            return { name: input.name, type: 'content_selection', required: input.required, fillable: false }
        }
        return {
            name: input.name,
            type: 'custom',
            required: input.required,
            allowFreeText: Boolean(input.custom.text?.enabled),
            allowMultiple: Boolean(input.custom.dropdown.allowMultiple),
            dropdownOptions: (input.custom.dropdown.options ?? []).map((option) => ({
                label: option.label,
                content: option.content ?? '',
            })),
            defaultValue: buildDefaultCustomValue(input),
        }
    })

    return {
        ok: true,
        prompt: {
            name: prompt.name,
            category: prompt.category,
            groups: await resolveBoundGroups(params.ownerId, prompt.modelGroupIds ?? []),
            inputs,
            unsupportedRequiredContentSelection,
        },
    }
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
    inputs?: ComposeInputs
    afterParagraph?: string
}): Promise<{ ok: true; result: ComposedContinuation } | { ok: false; detail: string }> {
    const loaded = await loadAgentPromptByName(params.ownerId, params.promptName)
    if (!loaded || !loaded.prompt) {
        return {
            ok: false,
            detail: `No Codex-callable prompt named "${params.promptName}" was found. The prompt must exist and have "允许 Agent 调用" enabled.`,
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

    const [novel, termState, chapterOutline, actOutline] = await Promise.all([
        prisma.novel.findFirst({
            where: { id: params.novelId, ownerId: params.ownerId },
            select: {
                language: true,
                acts: { select: { number: true, title: true, summary: true } },
                chapters: {
                    select: {
                        id: true,
                        title: true,
                        actNumber: true,
                        order: true,
                        scenes: { select: { id: true, order: true, summary: true } },
                    },
                },
            },
        }),
        prisma.novelTermState.findUnique({ where: { novelId: params.novelId }, select: { stateJson: true } }),
        prisma.outline.findFirst({
            where: { novelId: params.novelId, type: 'chapter', chapterId: scene.chapterId },
            select: { content: true },
        }),
        scene.chapter.actNumber != null
            ? prisma.outline.findFirst({
                  where: { novelId: params.novelId, type: 'act', actNumber: scene.chapter.actNumber },
                  select: { content: true },
              })
            : Promise.resolve(null),
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
    const instructionTermIds = resolveTrackedTermIds({
        mentionedTermIds: findMentionedTermIds(params.instruction, matcher),
        termsById,
    })

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

    const chapterOutlineText = htmlToText(chapterOutline?.content ?? '', { paragraphSeparator: '\n' }).trim()
    const actOutlineText = htmlToText(actOutline?.content ?? '', { paragraphSeparator: '\n' }).trim()

    // Input resolution: custom/checkbox from Codex values (else default); content_selection stays default.
    const inputByKey = new Map<string, PromptInputDefinition>()
    for (const input of prompt.inputs ?? []) {
        const key = normalizeKey(input.name)
        if (key) inputByKey.set(key, input)
    }
    const customByKey = new Map<string, string>()
    for (const [name, value] of Object.entries(params.inputs?.custom ?? {})) {
        if (typeof value === 'string') customByKey.set(normalizeKey(name), value)
    }
    const checkboxByKey = new Map<string, boolean>()
    for (const [name, value] of Object.entries(params.inputs?.checkbox ?? {})) {
        if (typeof value === 'boolean') checkboxByKey.set(normalizeKey(name), value)
    }

    const missingInputs: string[] = []
    // Authoritative: any required content_selection cannot be filled by Codex (it stays empty).
    const unsupportedRequiredContentSelection = (prompt.inputs ?? [])
        .filter((input) => input.type === 'content_selection' && input.required)
        .map((input) => input.name)

    const resolveInput = (name: string): string | null => {
        const input = inputByKey.get(normalizeKey(name))
        if (!input) return null

        if (input.type === 'checkbox') {
            const key = normalizeKey(input.name)
            const checked = checkboxByKey.has(key) ? checkboxByKey.get(key)! : input.checkbox.defaultChecked
            return checked ? (input.checkbox.displayName || input.name).trim() : ''
        }

        if (input.type === 'content_selection') {
            // Always default (empty); required ones are surfaced via unsupportedRequiredContentSelection above.
            return ''
        }

        const key = normalizeKey(input.name)
        if (customByKey.has(key)) {
            const provided = (customByKey.get(key) ?? '').trim()
            if (!provided && input.required) missingInputs.push(input.name)
            return provided
        }
        const fallback = buildDefaultCustomValue(input)
        if (fallback) return fallback
        if (input.required) missingInputs.push(input.name)
        return ''
    }

    const componentByKey = new Map<string, (typeof dtos)[number]>()
    for (const item of dtos) {
        if (item.category !== 'component') continue
        const key = normalizeKey(item.name)
        if (key) componentByKey.set(key, item)
    }
    const resolveInclude = (name: string): string | null => {
        const component = componentByKey.get(normalizeKey(name))
        return component?.messages?.[0]?.content ?? null
    }

    const resolvers: PromptTemplateRenderResolvers = {
        resolveInput,
        resolveInclude,
        // content_selection is always empty in this path, so these return nothing.
        resolveInputTermIds: () => [],
        resolveInputTermTagTermIds: () => [],
        resolveInputSnippets: () => [],
        resolveInputFullNovels: () => [],
        resolveInputActs: () => [],
        resolveInputChapters: () => [],
        resolveInputScenes: () => [],
        resolveInputActOutlines: () => [],
        resolveInputChapterOutlines: () => [],
        resolveTermText: (termId) => renderTermTemplateText(termsById.get(termId) ?? null) || null,
        resolveTermValue: (termId) =>
            renderTermTemplateValue({ entry: termsById.get(termId) ?? null, locale: novel.language, customCategories }) || null,
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
    const markdown = buildConversationMarkdown({
        promptName: prompt.name,
        groups,
        sceneRef: `${scene.chapter.id}:${scene.id}`,
        blocks: renderedBlocks,
    })

    return {
        ok: true,
        result: {
            markdown,
            promptName: prompt.name,
            groups,
            missingInputs: [...new Set(missingInputs)],
            unsupportedRequiredContentSelection: [...new Set(unsupportedRequiredContentSelection)],
        },
    }
}

function buildConversationMarkdown(params: {
    promptName: string
    groups: Array<{ id: string; name: string }>
    sceneRef: string
    blocks: Array<{ role: string; text: string }>
}) {
    const groupsLine = params.groups.length > 0
        ? `groups: ${params.groups
              .map((group, index) => `${group.id} (${group.name})${index === 0 ? ' (default)' : ''}`)
              .join(', ')}`
        : 'groups: (none — 调用 run_llm 时用用户 @ 的模型组)'

    const header = [
        '<!-- onw-continuation-prompt',
        `prompt: ${params.promptName}`,
        groupsLine,
        `scene: ${params.sceneRef}`,
        '-->',
        '',
        `> 这是提示词「${params.promptName}」按给定 instruction 和输入拼好的对话草稿，可直接 run_llm。`,
        '',
    ].join('\n')

    const body = params.blocks
        .filter((block) => block.text)
        .map((block) => `## ${block.role}\n\n${block.text}`)
        .join('\n\n')

    return `${header}\n${body}\n`
}
