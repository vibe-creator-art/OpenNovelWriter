'use client'

import { Blocks, List, MessageCircle, PenLine, Sparkles, Wand2 } from 'lucide-react'

import type { Prompt } from '@/lib/api'
import { countStringArgCallsFromMessages } from '@/lib/prompt-template'
import { extractIncludeNamesFromMessages, flattenIncludesInText, type PromptBundleV1, type PromptBundlePromptV1 } from '@/lib/prompt-bundle'
import type { PromptTemplateRenderWarning } from '@/lib/prompt-template-render'
import type { PromptCategory, PromptMessage } from '@/lib/prompts'

import {
    CATEGORY_ORDER,
    collectPromptIncludeWarnings,
    coerceCategory,
    normalizeKey,
    type BundlePromptSource,
    type PromptCategoryListItem,
    type PromptClipboardExportAnalysis,
    type PromptClipboardImportAnalysis,
    type PromptDraft,
    type PromptTranslateFn,
} from '@/components/editor/prompts/middle-panel-prompts-shared'

export function buildPromptCategories(t: PromptTranslateFn): readonly PromptCategoryListItem[] {
    return [
        { id: 'default', label: t('categories.default'), Icon: Sparkles },
        { id: 'scene_continuation', label: t('categories.sceneContinuation'), Icon: PenLine },
        { id: 'scene_action', label: t('categories.sceneAction'), Icon: List },
        { id: 'text_replacement', label: t('categories.textReplacement'), Icon: Wand2 },
        { id: 'ai_chat', label: t('categories.aiChat'), Icon: MessageCircle },
        { id: 'component', label: t('categories.components'), Icon: Blocks },
    ]
}

export function filterPromptsByQuery(prompts: Prompt[], normalizedQuery: string) {
    if (!normalizedQuery) return prompts

    return prompts.filter((prompt) => {
        const name = prompt.name?.toLowerCase() ?? ''
        const content = (prompt.messages ?? []).map((message) => message.content?.toLowerCase() ?? '').join('\n')
        return name.includes(normalizedQuery) || content.includes(normalizedQuery)
    })
}

export function buildPromptsByCategory(filteredPrompts: Prompt[]) {
    const result: Record<PromptCategory, Prompt[]> = {
        default: [],
        scene_continuation: [],
        scene_action: [],
        text_replacement: [],
        ai_chat: [],
        component: [],
    }

    filteredPrompts.forEach((prompt) => {
        const category = coerceCategory(String(prompt.category))
        if (!category || category === 'default') return
        result[category].push(prompt)
    })

    CATEGORY_ORDER.forEach((category) => {
        result[category].sort(
            (left, right) =>
                (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
                right.updatedAt.localeCompare(left.updatedAt)
        )
    })

    return result
}

export function buildIncludeCallCounts(prompts: Prompt[]) {
    const map = new Map<string, number>()

    for (const prompt of prompts) {
        const category = coerceCategory(String(prompt.category))
        if (!category || category === 'default') continue

        const counts = countStringArgCallsFromMessages(prompt.messages ?? [], 'include')
        for (const [arg, count] of counts.entries()) {
            const key = arg.trim().toLowerCase()
            if (!key) continue
            map.set(key, (map.get(key) ?? 0) + count)
        }
    }

    return map
}

export function buildComponentContentByNameKey(prompts: Prompt[], draft: PromptDraft | null) {
    const map = new Map<string, string>()

    for (const prompt of prompts) {
        const category = coerceCategory(String(prompt.category))
        if (category !== 'component') continue
        const key = normalizeKey(prompt.name ?? '')
        if (!key || map.has(key)) continue
        map.set(key, prompt.messages?.[0]?.content ?? '')
    }

    if (draft && coerceCategory(String(draft.category)) === 'component') {
        const key = normalizeKey(draft.name ?? '')
        if (key) map.set(key, draft.messages?.[0]?.content ?? '')
    }

    return map
}

export function buildComponentPromptByNameKey(prompts: Prompt[], draft: PromptDraft | null) {
    const map = new Map<string, BundlePromptSource>()

    for (const prompt of prompts) {
        const category = coerceCategory(String(prompt.category))
        if (category !== 'component') continue
        const key = normalizeKey(prompt.name ?? '')
        if (!key || map.has(key)) continue
        map.set(key, prompt)
    }

    if (draft && coerceCategory(String(draft.category)) === 'component') {
        const key = normalizeKey(draft.name ?? '')
        if (key) map.set(key, draft)
    }

    return map
}

export function buildIncludeWarningsByPromptId(
    prompts: Prompt[],
    draft: PromptDraft | null,
    componentContentByNameKey: Map<string, string>
) {
    const map = new Map<string, PromptTemplateRenderWarning[]>()
    const resolveInclude = (name: string) => {
        const key = normalizeKey(name ?? '')
        if (!key) return null
        return componentContentByNameKey.get(key) ?? null
    }

    for (const prompt of prompts) {
        const effectiveMessages = draft && draft.id === prompt.id ? draft.messages : (prompt.messages ?? [])
        const warnings = collectPromptIncludeWarnings({ messages: effectiveMessages, resolveInclude })
        if (warnings.length > 0) map.set(prompt.id, warnings)
    }

    if (draft && !prompts.some((prompt) => prompt.id === draft.id)) {
        const warnings = collectPromptIncludeWarnings({ messages: draft.messages, resolveInclude })
        if (warnings.length > 0) map.set(draft.id, warnings)
    }

    return map
}

export function analyzeClipboardExport(
    draft: PromptDraft | null,
    componentContentByNameKey: Map<string, string>,
    componentPromptByNameKey: Map<string, BundlePromptSource>
): PromptClipboardExportAnalysis {
    const empty: PromptClipboardExportAnalysis = {
        directIncludes: [],
        dependencyPrompts: [],
        missingIncludes: [],
        flattenMissingIncludes: [],
        flattenCycles: [],
        flattenDepthExceeded: false,
    }
    if (!draft) return empty

    const directIncludes = extractIncludeNamesFromMessages(draft.messages ?? [])
    const entryKey = normalizeKey(draft.name ?? '')

    const dependencyPrompts: BundlePromptSource[] = []
    const missing = new Set<string>()
    const visited = new Set<string>()
    const stack: string[] = []
    const maxDepth = 10

    const visitMessages = (messages: PromptMessage[], depth: number) => {
        const includes = extractIncludeNamesFromMessages(messages ?? [])
        for (const includeName of includes) {
            const key = normalizeKey(includeName)
            if (!key) continue
            if (entryKey && key === entryKey) continue
            const found = componentPromptByNameKey.get(key) ?? null
            if (!found) {
                missing.add(includeName)
                continue
            }
            if (stack.includes(key) || visited.has(key)) continue
            visited.add(key)
            if (depth >= maxDepth) continue

            stack.push(key)
            visitMessages(found.messages ?? [], depth + 1)
            stack.pop()
            dependencyPrompts.push(found)
        }
    }

    visitMessages(draft.messages ?? [], 0)

    const flattenMissing = new Set<string>()
    const flattenCycles = new Set<string>()
    let flattenDepthExceeded = false
    const resolveInclude = (name: string) => {
        const key = normalizeKey(name ?? '')
        if (!key) return null
        return componentContentByNameKey.get(key) ?? null
    }

    for (const message of draft.messages ?? []) {
        const result = flattenIncludesInText({ text: message.content ?? '', resolveInclude, maxDepth })
        for (const name of result.missing) flattenMissing.add(name)
        for (const name of result.cycles) flattenCycles.add(name)
        if (result.depthExceeded) flattenDepthExceeded = true
    }

    return {
        directIncludes,
        dependencyPrompts,
        missingIncludes: [...missing],
        flattenMissingIncludes: [...flattenMissing],
        flattenCycles: [...flattenCycles],
        flattenDepthExceeded,
    }
}

export function analyzeClipboardImport(clipboardImportBundle: PromptBundleV1 | null): PromptClipboardImportAnalysis {
    if (!clipboardImportBundle) {
        return { entry: null, dependencies: [], missing: [] }
    }

    const entryKey = normalizeKey(clipboardImportBundle.entryName)
    const entry = clipboardImportBundle.prompts.find((prompt) => normalizeKey(prompt.name) === entryKey) ?? null
    if (!entry) {
        return { entry: null, dependencies: [], missing: [] }
    }

    const componentByNameKey = new Map<string, PromptBundlePromptV1>()
    for (const prompt of clipboardImportBundle.prompts) {
        const category = coerceCategory(String(prompt.category))
        if (category !== 'component') continue
        const key = normalizeKey(prompt.name ?? '')
        if (!key || componentByNameKey.has(key)) continue
        componentByNameKey.set(key, prompt)
    }

    const dependencies: PromptBundlePromptV1[] = []
    const missing = new Set<string>()
    const visited = new Set<string>()
    const stack: string[] = []
    const maxDepth = 10

    const visitMessages = (messages: PromptMessage[], depth: number) => {
        const includes = extractIncludeNamesFromMessages(messages ?? [])
        for (const includeName of includes) {
            const key = normalizeKey(includeName)
            if (!key || key === entryKey) continue
            const found = componentByNameKey.get(key) ?? null
            if (!found) {
                missing.add(includeName)
                continue
            }
            if (stack.includes(key) || visited.has(key)) continue
            visited.add(key)
            if (depth >= maxDepth) continue

            stack.push(key)
            visitMessages(found.messages ?? [], depth + 1)
            stack.pop()
            dependencies.push(found)
        }
    }

    visitMessages(entry.messages ?? [], 0)

    return { entry, dependencies, missing: [...missing] }
}

export function buildIncludeUsages(params: {
    draftId: string | null
    draftName: string
    isComponent: boolean
    prompts: Prompt[]
}) {
    if (!params.draftId || !params.isComponent || !params.draftName) {
        return { totalCalls: 0, items: [] as Array<{ prompt: Prompt; calls: number }> }
    }

    const targetKey = params.draftName.toLowerCase()
    const items: Array<{ prompt: Prompt; calls: number }> = []
    let totalCalls = 0

    for (const prompt of params.prompts) {
        if (prompt.id === params.draftId) continue
        const category = coerceCategory(String(prompt.category))
        if (!category || category === 'default') continue

        const counts = countStringArgCallsFromMessages(prompt.messages ?? [], 'include')
        let calls = 0
        for (const [arg, count] of counts.entries()) {
            if (arg.trim().toLowerCase() !== targetKey) continue
            calls += count
        }

        if (calls <= 0) continue
        totalCalls += calls
        items.push({ prompt, calls })
    }

    items.sort((left, right) => right.calls - left.calls || right.prompt.updatedAt.localeCompare(left.prompt.updatedAt))
    return { totalCalls, items }
}
