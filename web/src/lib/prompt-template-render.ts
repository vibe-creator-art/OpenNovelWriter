import nunjucks, { type ILoader, type LoaderSource } from 'nunjucks'

import { extractNunjucksIncludeNamesFromText, extractReferencedInputNamesFromText } from '@/lib/prompt-template'

export type PromptTemplateRenderContext = {
    novelLanguage?: string | null
    novelOutlineStorySoFar?: string | null
    novelOutlineFull?: string | null
    sceneText?: string | null
    sceneContinuePreviousText?: string | null
    sceneContinueFollowText?: string | null
    sceneContinueHasPreviousText?: boolean | null
    sceneContinueHasFollowText?: boolean | null
    instructionText?: string | null
    instructionTerms?: string[] | null
    chatUserInput?: string | null
    chatUserInputTerms?: string[] | null
    chatHistoryText?: string | null
    chatHistoryTerms?: string[] | null
}

export type PromptTemplateRenderWarning =
    | { type: 'missing_input'; name: string }
    | { type: 'invalid_include'; name: string }
    | { type: 'include_cycle'; name: string }
    | { type: 'include_depth_exceeded'; name: string }
    | { type: 'invalid_input_syntax'; name: string; expr: string }
    | { type: 'invalid_include_syntax'; name: string; expr: string }
    | { type: 'unsupported_template_syntax'; name: string; expr: string }
    | { type: 'unclosed_template_expr'; name: string; open: '{{'; pos: number }
    | { type: 'unsupported_variable_expr'; name: string; expr: string }

export type PromptTemplateRenderOptions = {
    maxDepth?: number
}

export type PromptTemplateRenderListItem = {
    text?: string | null
    value?: string | null
}

export type PromptTemplateRenderResolvers = {
    resolveInput: (name: string) => string | null | undefined
    resolveInclude: (name: string) => string | null | undefined
    resolveInputTermIds?: (name: string) => string[] | null | undefined
    resolveInputTermTagTermIds?: (name: string) => string[] | null | undefined
    resolveInputSnippets?: (name: string) => PromptTemplateRenderListItem[] | null | undefined
    resolveInputFullNovels?: (name: string) => PromptTemplateRenderListItem[] | null | undefined
    resolveInputActs?: (name: string) => PromptTemplateRenderListItem[] | null | undefined
    resolveInputChapters?: (name: string) => PromptTemplateRenderListItem[] | null | undefined
    resolveInputScenes?: (name: string) => PromptTemplateRenderListItem[] | null | undefined
    resolveTermText?: (termId: string) => string | null | undefined
    resolveTermValue?: (termId: string) => string | null | undefined
}

type TemplateListValue = {
    count: number
    text: string
    value: string
    toString: () => string
}

type TemplateTermCollection = TemplateListValue & {
    ids: string[]
}

type TemplateInputValue = {
    text: string
    value: string
    term: TemplateTermCollection
    termTag: TemplateTermCollection
    snippet: TemplateListValue
    fullNovel: TemplateListValue
    act: TemplateListValue
    chapter: TemplateListValue
    scene: TemplateListValue
}

type TemplateStringValue = {
    full?: string
    storysofar?: string
    terms?: TemplateTermCollection
    toString: () => string
    valueOf: () => string
    [Symbol.toPrimitive]: () => string
}

type EncodedIncludePayload = {
    name: string
    depth: number
    stack: string[]
}

const INTERNAL_INCLUDE_PREFIX = '__onw_nunjucks_include__:'
const REWRITABLE_INCLUDE_TAG_RE = /\{%(\-)?(\s*)include(\s+)(['"])([\s\S]*?)\4([\s\S]*?)(\-)?%\}/g

function normalizeName(value: string) {
    return value.trim()
}

function normalizeTextValue(value: string | null | undefined) {
    return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function normalizeTermIds(values: string[] | null | undefined) {
    if (!Array.isArray(values) || values.length === 0) return [] as string[]

    const seen = new Set<string>()
    const normalized: string[] = []
    for (const value of values) {
        if (typeof value !== 'string') continue
        const trimmed = value.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        normalized.push(trimmed)
    }
    return normalized
}

function renderNormalizedTermIds(termIds: string[], resolvers: PromptTemplateRenderResolvers, mode: 'text' | 'value') {
    if (termIds.length === 0) return ''

    const resolveTerm =
        mode === 'value'
            ? (resolvers.resolveTermValue ?? resolvers.resolveTermText)
            : (resolvers.resolveTermText ?? resolvers.resolveTermValue)
    if (!resolveTerm) return termIds.join('\n')

    const parts: string[] = []
    for (const termId of termIds) {
        const resolved = resolveTerm(termId)
        const text = normalizeTextValue(resolved).trim()
        if (!text) continue
        parts.push(text)
    }

    return parts.join('\n\n').trim()
}

function normalizeListItems(values: PromptTemplateRenderListItem[] | null | undefined) {
    if (!Array.isArray(values) || values.length === 0) return [] as Array<{ text: string; value: string }>

    const out: Array<{ text: string; value: string }> = []
    const seen = new Set<string>()
    for (const item of values) {
        if (!item || typeof item !== 'object') continue
        const text = normalizeTextValue(item.text).trim()
        const value = normalizeTextValue(item.value ?? item.text).trim()
        if (!text && !value) continue
        const key = JSON.stringify([text, value])
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ text, value })
    }
    return out
}

function createTemplateListValue(items: PromptTemplateRenderListItem[] | null | undefined): TemplateListValue {
    const normalized = normalizeListItems(items)
    const text = normalized.map((item) => item.text).filter(Boolean).join('\n').trim()
    const value = normalized.map((item) => item.value).filter(Boolean).join('\n\n').trim()
    return {
        count: normalized.length,
        text,
        value,
        toString: () => value,
    }
}

function createTemplateTermCollection(termIds: string[] | null | undefined, resolvers: PromptTemplateRenderResolvers): TemplateTermCollection {
    const ids = normalizeTermIds(termIds)
    return {
        ids,
        ...createTemplateListValue(
            ids.map((termId) => ({
                text: renderNormalizedTermIds([termId], resolvers, 'text'),
                value: renderNormalizedTermIds([termId], resolvers, 'value'),
            }))
        ),
    }
}

function createTemplateStringValue(
    value: string | null | undefined,
    aliases?: {
        full?: string | null | undefined
        storysofar?: string | null | undefined
        terms?: TemplateTermCollection | null | undefined
    }
): TemplateStringValue {
    const normalizedValue = normalizeTextValue(value).trim()
    return {
        ...(aliases?.full !== undefined ? { full: normalizeTextValue(aliases.full).trim() } : {}),
        ...(aliases?.storysofar !== undefined ? { storysofar: normalizeTextValue(aliases.storysofar).trim() } : {}),
        ...(aliases?.terms !== undefined && aliases.terms !== null ? { terms: aliases.terms } : {}),
        toString: () => normalizedValue,
        valueOf: () => normalizedValue,
        [Symbol.toPrimitive]: () => normalizedValue,
    }
}

function isTemplateTermCollection(value: unknown): value is TemplateTermCollection {
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    return (
        Array.isArray(record.ids) &&
        typeof record.count === 'number' &&
        typeof record.text === 'string' &&
        typeof record.value === 'string'
    )
}

function extractTemplateTermIds(value: unknown) {
    if (isTemplateTermCollection(value)) return normalizeTermIds(value.ids)
    if (Array.isArray(value)) return normalizeTermIds(value)
    return [] as string[]
}

function unionTemplateTermCollections(left: unknown, right: unknown, resolvers: PromptTemplateRenderResolvers) {
    return createTemplateTermCollection([...extractTemplateTermIds(left), ...extractTemplateTermIds(right)], resolvers)
}

function dedupeWarnings(warnings: PromptTemplateRenderWarning[]) {
    const unique: PromptTemplateRenderWarning[] = []
    const seen = new Set<string>()

    for (const warning of warnings) {
        const key = JSON.stringify(warning)
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(warning)
    }

    return unique
}

function encodeIncludePayload(payload: EncodedIncludePayload) {
    return `${INTERNAL_INCLUDE_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`
}

function decodeIncludePayload(value: string): EncodedIncludePayload | null {
    if (!value.startsWith(INTERNAL_INCLUDE_PREFIX)) return null
    try {
        return JSON.parse(decodeURIComponent(value.slice(INTERNAL_INCLUDE_PREFIX.length))) as EncodedIncludePayload
    } catch {
        return null
    }
}

function rewriteIncludeTagsForLoader(text: string, state: { depth: number; stack: string[] }) {
    return (text ?? '').replace(REWRITABLE_INCLUDE_TAG_RE, (_raw, openTrim = '', spacing = '', includeGap = ' ', quote = '"', rawName = '', suffix = '', closeTrim = '') => {
        const name = normalizeName(String(rawName ?? ''))
        if (!name) return ''

        const encodedName = encodeIncludePayload({
            name,
            depth: state.depth + 1,
            stack: state.stack,
        })

        return `{%${openTrim}${spacing}include${includeGap}${quote}${encodedName}${quote}${suffix}${closeTrim}%}`
    })
}

function collectTemplateAnalysis(params: {
    text: string
    resolvers: PromptTemplateRenderResolvers
    maxDepth: number
    depth: number
    includeStack: string[]
    inputNames: Set<string>
    warnings: PromptTemplateRenderWarning[]
}) {
    const { text, resolvers, maxDepth, depth, includeStack, inputNames, warnings } = params

    for (const rawName of extractReferencedInputNamesFromText(text ?? '')) {
        const name = normalizeName(rawName)
        if (name) inputNames.add(name)
    }

    for (const rawName of extractNunjucksIncludeNamesFromText(text ?? '')) {
        const name = normalizeName(rawName)
        if (!name) continue

        const key = name.toLowerCase()
        if (includeStack.includes(key)) {
            warnings.push({ type: 'include_cycle', name })
            continue
        }

        if (depth + 1 > maxDepth) {
            warnings.push({ type: 'include_depth_exceeded', name })
            continue
        }

        const included = resolvers.resolveInclude(name)
        if (included == null) {
            warnings.push({ type: 'invalid_include', name })
            continue
        }

        collectTemplateAnalysis({
            text: included,
            resolvers,
            maxDepth,
            depth: depth + 1,
            includeStack: [...includeStack, key],
            inputNames,
            warnings,
        })
    }
}

function buildInputsContext(inputNames: Iterable<string>, resolvers: PromptTemplateRenderResolvers, warnings: PromptTemplateRenderWarning[]) {
    const inputs: Record<string, TemplateInputValue> = {}

    for (const name of inputNames) {
        const resolved = resolvers.resolveInput(name)
        if (resolved == null) warnings.push({ type: 'missing_input', name })

        const termIds = normalizeTermIds(resolvers.resolveInputTermIds?.(name))
        const termTagTermIds = normalizeTermIds(resolvers.resolveInputTermTagTermIds?.(name))

        inputs[name] = {
            text: normalizeTextValue(resolved),
            value: normalizeTextValue(resolved),
            term: createTemplateTermCollection(termIds, resolvers),
            termTag: createTemplateTermCollection(termTagTermIds, resolvers),
            snippet: createTemplateListValue(resolvers.resolveInputSnippets?.(name)),
            fullNovel: createTemplateListValue(resolvers.resolveInputFullNovels?.(name)),
            act: createTemplateListValue(resolvers.resolveInputActs?.(name)),
            chapter: createTemplateListValue(resolvers.resolveInputChapters?.(name)),
            scene: createTemplateListValue(resolvers.resolveInputScenes?.(name)),
        }
    }

    return inputs
}

function buildTemplateContext(context: PromptTemplateRenderContext, inputs: Record<string, TemplateInputValue>, resolvers: PromptTemplateRenderResolvers) {
    return {
        novel: {
            language: context.novelLanguage ?? '',
            outline: createTemplateStringValue(context.novelOutlineStorySoFar, {
                full: context.novelOutlineFull,
                storysofar: context.novelOutlineStorySoFar,
            }),
        },
        scene: {
            text: context.sceneText ?? '',
            previousText: context.sceneContinuePreviousText ?? '',
            followText: context.sceneContinueFollowText ?? '',
            hasPreviousText: !!context.sceneContinueHasPreviousText,
            hasFollowText: !!context.sceneContinueHasFollowText,
        },
        instruction: {
            text: context.instructionText ?? '',
            terms: createTemplateTermCollection(context.instructionTerms ?? [], resolvers),
        },
        chat: {
            userInput: createTemplateStringValue(context.chatUserInput ?? '', {
                terms: createTemplateTermCollection(context.chatUserInputTerms ?? [], resolvers),
            }),
            history: createTemplateStringValue(context.chatHistoryText ?? '', {
                terms: createTemplateTermCollection(context.chatHistoryTerms ?? [], resolvers),
            }),
        },
        inputs,
    }
}

function createIncludeLoader(params: {
    resolvers: PromptTemplateRenderResolvers
    maxDepth: number
    initialDepth: number
    initialStack: string[]
}): ILoader {
    return {
        async: false,
        getSource(name: string): LoaderSource {
            const decoded = decodeIncludePayload(name)
            const includeName = normalizeName(decoded?.name ?? name)
            const includeDepth = decoded?.depth ?? params.initialDepth + 1
            const includeStack = decoded?.stack ?? params.initialStack

            if (!includeName) {
                return { src: '', path: name, noCache: true }
            }

            const key = includeName.toLowerCase()
            if (includeStack.includes(key) || includeDepth > params.maxDepth) {
                return { src: '', path: name, noCache: true }
            }

            const included = params.resolvers.resolveInclude(includeName)
            if (included == null) {
                return { src: '', path: name, noCache: true }
            }

            return {
                src: rewriteIncludeTagsForLoader(included, {
                    depth: includeDepth,
                    stack: [...includeStack, key],
                }),
                path: name,
                noCache: true,
            }
        },
    }
}

function toSyntaxWarning(error: unknown): PromptTemplateRenderWarning {
    const message = error instanceof Error ? error.message : String(error)
    return {
        type: 'unsupported_template_syntax',
        name: message,
        expr: message,
    }
}

export function renderPromptTemplateText(params: {
    text: string
    context: PromptTemplateRenderContext
    resolvers: PromptTemplateRenderResolvers
    options?: PromptTemplateRenderOptions
    depth?: number
    includeStack?: string[]
}): { text: string; warnings: PromptTemplateRenderWarning[] } {
    const {
        text,
        context,
        resolvers,
        options,
        depth = 0,
        includeStack = [],
    } = params

    const maxDepth = options?.maxDepth ?? 5
    const inputNames = new Set<string>()
    const warnings: PromptTemplateRenderWarning[] = []

    collectTemplateAnalysis({
        text: text ?? '',
        resolvers,
        maxDepth,
        depth,
        includeStack,
        inputNames,
        warnings,
    })

    const templateContext = buildTemplateContext(context, buildInputsContext(inputNames, resolvers, warnings), resolvers)
    const loader = createIncludeLoader({
        resolvers,
        maxDepth,
        initialDepth: depth,
        initialStack: includeStack,
    })

    const environment = new nunjucks.Environment(loader, {
        autoescape: false,
        throwOnUndefined: false,
        trimBlocks: false,
        lstripBlocks: false,
    })
    environment.addFilter('union', (left: unknown, right: unknown) => unionTemplateTermCollections(left, right, resolvers))

    try {
        const rendered = environment.renderString(
            rewriteIncludeTagsForLoader(text ?? '', { depth, stack: includeStack }),
            templateContext
        )
        return { text: rendered, warnings: dedupeWarnings(warnings) }
    } catch (error) {
        warnings.push(toSyntaxWarning(error))
        return { text: text ?? '', warnings: dedupeWarnings(warnings) }
    }
}
