import type { PromptAgentCallMode, PromptCategory, PromptMessage } from '@/lib/prompts'
import type { PromptInputDefinition } from '@/lib/prompt-inputs'
import { extractNunjucksIncludeNamesFromText, extractStringArgCallsFromMessages } from '@/lib/prompt-template'

export const PROMPT_BUNDLE_CLIPBOARD_PREFIX = 'ONW_PROMPT_BUNDLE:'

export type PromptBundlePromptV1 = {
    name: string
    category: PromptCategory
    description: string | null
    messages: PromptMessage[]
    inputs: PromptInputDefinition[]
    isNsfw?: boolean
    modelGroupIds?: string[]
    modelSetIds?: string[]
    allowLlmCall?: boolean
    allowAgentCall?: boolean
    agentCallMode?: PromptAgentCallMode
}

export type PromptBundleV1 = {
    schema: 'open-novel-writer/prompt-bundle'
    version: 1
    exportedAt: string
    entryName: string
    prompts: PromptBundlePromptV1[]
}

const INCLUDE_TAG_RE = /\{%(\-)?(\s*)include(\s+)(['"])([\s\S]*?)\4([\s\S]*?)(\-)?%\}/g

export function toPromptNameKey(name: string) {
    return name.trim().toLowerCase()
}

export function serializePromptBundle(bundle: PromptBundleV1) {
    return `${PROMPT_BUNDLE_CLIPBOARD_PREFIX}\n${JSON.stringify(bundle, null, 2)}`
}

export function serializePromptBundleJson(bundle: PromptBundleV1) {
    return JSON.stringify(bundle, null, 2)
}

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function parsePromptBundleFromJsonValue(parsed: unknown):
    | { ok: true; bundle: PromptBundleV1 }
    | { ok: false; detail: string } {
    if (!parsed || typeof parsed !== 'object') return { ok: false, detail: 'Invalid prompt bundle JSON' }

    const obj = parsed as Record<string, unknown>
    if (obj.schema !== 'open-novel-writer/prompt-bundle') return { ok: false, detail: 'Unsupported prompt bundle schema' }
    if (obj.version !== 1) return { ok: false, detail: 'Unsupported prompt bundle version' }
    if (typeof obj.entryName !== 'string' || !obj.entryName.trim()) return { ok: false, detail: 'Invalid entryName' }
    if (!Array.isArray(obj.prompts) || obj.prompts.length === 0) return { ok: false, detail: 'Bundle has no prompts' }

    return { ok: true, bundle: obj as PromptBundleV1 }
}

export function parsePromptBundle(value: unknown):
    | { ok: true; bundle: PromptBundleV1 }
    | { ok: false; detail: string } {
    return parsePromptBundleFromJsonValue(value)
}

export function parsePromptBundleFromClipboardText(text: string):
    | { ok: true; bundle: PromptBundleV1 }
    | { ok: false; detail: string } {
    const raw = text.trim()
    if (!raw) return { ok: false, detail: 'Clipboard is empty' }
    if (!raw.startsWith(PROMPT_BUNDLE_CLIPBOARD_PREFIX)) {
        return { ok: false, detail: 'Clipboard does not contain a prompt bundle' }
    }

    const json = raw.slice(PROMPT_BUNDLE_CLIPBOARD_PREFIX.length).trim()
    const parsed = safeJsonParse(json)
    return parsePromptBundleFromJsonValue(parsed)
}

export function parsePromptBundleFromText(text: string):
    | { ok: true; bundle: PromptBundleV1 }
    | { ok: false; detail: string } {
    const raw = text.trim()
    if (!raw) return { ok: false, detail: 'Text is empty' }

    if (raw.startsWith(PROMPT_BUNDLE_CLIPBOARD_PREFIX)) {
        const json = raw.slice(PROMPT_BUNDLE_CLIPBOARD_PREFIX.length).trim()
        const parsed = safeJsonParse(json)
        return parsePromptBundleFromJsonValue(parsed)
    }

    const parsed = safeJsonParse(raw)
    return parsePromptBundleFromJsonValue(parsed)
}

export function extractIncludeNamesFromMessages(messages: PromptMessage[]) {
    const names = extractStringArgCallsFromMessages(messages, 'include')
    const seen = new Set<string>()
    const unique: string[] = []
    for (const name of names) {
        const trimmed = (name ?? '').trim()
        if (!trimmed) continue
        const key = toPromptNameKey(trimmed)
        if (!key || seen.has(key)) continue
        seen.add(key)
        unique.push(trimmed)
    }
    return unique
}

export type FlattenIncludesResult = {
    text: string
    missing: string[]
    cycles: string[]
    depthExceeded: boolean
}

export function flattenIncludesInText(params: {
    text: string
    resolveInclude: (name: string) => string | null | undefined
    maxDepth?: number
}): FlattenIncludesResult {
    const maxDepth = params.maxDepth ?? 10
    const missing = new Set<string>()
    const cycles = new Set<string>()
    let depthExceeded = false

    const visit = (text: string, depth: number, stack: string[]): string => {
        return (text ?? '').replace(INCLUDE_TAG_RE, (_raw, openTrim = '', spacing = '', includeGap = ' ', quote = '"', rawName = '', suffix = '', closeTrim = '') => {
            const name = String(rawName ?? '').trim()
            if (!name) {
                return `{%${openTrim}${spacing}include${includeGap}${quote}${quote}${suffix}${closeTrim}%}`
            }

            const key = toPromptNameKey(name)
            if (stack.includes(key)) {
                cycles.add(name)
                return ''
            }

            if (depth >= maxDepth) {
                depthExceeded = true
                return ''
            }

            const included = params.resolveInclude(name)
            if (included == null) {
                missing.add(name)
                return ''
            }

            return visit(included, depth + 1, [...stack, key])
        })
    }

    const text = visit(params.text ?? '', 0, [])
    return {
        text,
        missing: [...missing],
        cycles: [...cycles],
        depthExceeded,
    }
}

export { extractNunjucksIncludeNamesFromText }
