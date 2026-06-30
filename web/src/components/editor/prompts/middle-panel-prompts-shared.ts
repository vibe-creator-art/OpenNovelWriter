'use client'

import type { LucideIcon } from 'lucide-react'

import type { Prompt } from '@/lib/api'
import { normalizePromptCategory, type PromptCategory, type PromptMessage, type PromptMessageRole } from '@/lib/prompts'
import { renderPromptTemplateText, type PromptTemplateRenderWarning } from '@/lib/prompt-template-render'
import type { PromptBundlePromptV1 } from '@/lib/prompt-bundle'

export type PromptEditorTab = 'general' | 'instructions' | 'advanced' | 'description' | 'usages'

export type PromptDraft = Pick<
    Prompt,
    | 'id'
    | 'name'
    | 'category'
    | 'description'
    | 'messages'
    | 'inputs'
    | 'modelGroupIds'
    | 'modelSetIds'
    | 'allowLlmCall'
    | 'allowAgentCall'
    | 'agentCallMode'
    | 'history'
    | 'isNsfw'
>

export type PersistedPromptViewState = {
    selectedPromptId?: string | null
    activeCategory?: PromptCategory
    editorTab?: PromptEditorTab
    expandedCategories?: Partial<Record<PromptCategory, boolean>>
}

export type BundlePromptSource = {
    name: string
    category: PromptCategory | string
    description: string | null
    messages: PromptMessage[]
    inputs: Prompt['inputs']
    isNsfw?: boolean
    allowLlmCall?: boolean
    allowAgentCall?: boolean
    agentCallMode?: Prompt['agentCallMode']
}

export type PromptTranslateFn = (
    key: string,
    values?: Record<string, string | number | Date>
) => string

export type PromptCategoryListItem = {
    id: PromptCategory
    label: string
    Icon: LucideIcon
}

export type PromptClipboardExportAnalysis = {
    directIncludes: string[]
    dependencyPrompts: BundlePromptSource[]
    missingIncludes: string[]
    flattenMissingIncludes: string[]
    flattenCycles: string[]
    flattenDepthExceeded: boolean
}

export type PromptClipboardImportAnalysis = {
    entry: PromptBundlePromptV1 | null
    dependencies: PromptBundlePromptV1[]
    missing: string[]
}

export const DEFAULT_EXPANDED_CATEGORIES: Record<PromptCategory, boolean> = {
    default: true,
    scene_continuation: true,
    scene_action: true,
    ai_chat: true,
    component: true,
}

export const PROMPT_EDITOR_TAB_SET = new Set<PromptEditorTab>(['general', 'instructions', 'advanced', 'description', 'usages'])

export const CATEGORY_ORDER: PromptCategory[] = [
    'default',
    'scene_continuation',
    'scene_action',
    'ai_chat',
    'component',
]

export const HISTORY_CATEGORIES: PromptCategory[] = [
    'scene_continuation',
    'scene_action',
    'ai_chat',
    'component',
]

export function coercePromptEditorTab(value: unknown): PromptEditorTab | null {
    if (typeof value !== 'string') return null
    return PROMPT_EDITOR_TAB_SET.has(value as PromptEditorTab) ? (value as PromptEditorTab) : null
}

export function normalizeEditorTabForCategory(tab: PromptEditorTab | null | undefined, category: PromptCategory | null) {
    if (category === 'component') {
        return tab && tab !== 'general' ? tab : 'instructions'
    }
    if (!category) return tab ?? 'instructions'
    return tab && tab !== 'usages' ? tab : 'instructions'
}

export function coerceCategory(category: string): PromptCategory | null {
    return normalizePromptCategory(category)
}

export function normalizeKey(value: string) {
    return value.trim().toLowerCase()
}

export function collectPromptIncludeWarnings(params: {
    messages: PromptMessage[]
    resolveInclude: (name: string) => string | null
    maxDepth?: number
}): PromptTemplateRenderWarning[] {
    const all: PromptTemplateRenderWarning[] = []
    const maxDepth = params.maxDepth ?? 5
    for (const message of params.messages ?? []) {
        const rendered = renderPromptTemplateText({
            text: message.content ?? '',
            context: {},
            resolvers: {
                resolveInput: () => '',
                resolveInclude: params.resolveInclude,
            },
            options: { maxDepth },
        })
        for (const warning of rendered.warnings) {
            if (warning.type === 'missing_input') continue
            all.push(warning)
        }
    }

    const unique: PromptTemplateRenderWarning[] = []
    const seen = new Set<string>()
    for (const warning of all) {
        const key = `${warning.type}:${(warning.name ?? '').trim().toLowerCase()}`
        if (!key || seen.has(key)) continue
        seen.add(key)
        unique.push(warning)
    }
    return unique
}

export function createLocalId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function toSafeFilenameSegment(value: string) {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return 'prompt-bundle'
    const cleaned = trimmed
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
    return cleaned.slice(0, 80) || 'prompt-bundle'
}

export function downloadTextFile(params: { filename: string; content: string; mimeType: string }) {
    const blob = new Blob([params.content], { type: params.mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = params.filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function getSaveLabel(t: (key: string) => string, state: 'idle' | 'saving' | 'saved' | 'error') {
    if (state === 'saving') return t('status.saving')
    if (state === 'saved') return t('status.saved')
    if (state === 'error') return t('status.saveFailed')
    return ''
}

export function getNextRole(messages: PromptMessage[]): PromptMessageRole {
    const last = [...messages].reverse().find((message) => message.role === 'user' || message.role === 'assistant') ?? null
    if (!last) return 'user'
    return last.role === 'user' ? 'assistant' : 'user'
}

export function toPromptBundlePrompt(source: BundlePromptSource): PromptBundlePromptV1 | null {
    const name = (source.name ?? '').trim()
    const category = coerceCategory(String(source.category))
    if (!name || !category) return null

    // Model bindings are user-local and never exported — a copied/exported prompt carries none.
    return {
        name,
        category,
        description: source.description ?? null,
        messages: source.messages ?? [],
        inputs: source.inputs ?? [],
        isNsfw: source.isNsfw === true,
        allowLlmCall: source.allowLlmCall === true,
        allowAgentCall: source.allowAgentCall === true,
        agentCallMode: source.agentCallMode ?? 'generate_then_agent',
    }
}

export function getPromptWarningMessage(
    warning: PromptTemplateRenderWarning,
    t: PromptTranslateFn
) {
    if (warning.type === 'invalid_input_syntax') {
        return t('advanced.preview.warningInvalidInputSyntax', { expr: warning.expr })
    }
    if (warning.type === 'invalid_include_syntax') {
        return t('advanced.preview.warningInvalidIncludeSyntax', { expr: warning.expr })
    }
    if (warning.type === 'invalid_include') {
        return t('advanced.preview.warningInvalidInclude', { name: warning.name })
    }
    if (warning.type === 'include_cycle') {
        return t('advanced.preview.warningIncludeCycle', { name: warning.name })
    }
    if (warning.type === 'include_depth_exceeded') {
        return t('advanced.preview.warningIncludeDepth', { name: warning.name })
    }
    if (warning.type === 'unsupported_template_syntax') {
        return t('advanced.preview.warningUnsupportedTemplateSyntax', { expr: warning.expr })
    }
    if (warning.type === 'unclosed_template_expr') {
        return t('advanced.preview.warningUnclosedTemplateExpr', { pos: warning.pos })
    }
    if (warning.type === 'unsupported_variable_expr') {
        return t('advanced.preview.warningUnsupportedVariableExpr', { expr: warning.expr })
    }
    return `${warning.type}: ${warning.name}`
}
