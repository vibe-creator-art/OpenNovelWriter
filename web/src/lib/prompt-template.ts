import type { PromptMessage } from '@/lib/prompts'

const TEMPLATE_BLOCK_RE = /\{[{%#]-?[\s\S]*?-?[}%#]\}/g
const VARIABLE_TAG_RE = /\{\{(-)?([\s\S]*?)(-)?\}\}/g
const INCLUDE_TAG_RE = /\{%-?\s*include\s+(['"])([\s\S]*?)\1[\s\S]*?-?%\}/g
const INPUT_REF_RE = /\binputs\s*(?:\[\s*(['"])([\s\S]*?)\1\s*\]|\.\s*([A-Za-z_][A-Za-z0-9_]*))/g
const SCENE_REF_RE = /\bscene\s*\.\s*(text|previousText|followText|hasPreviousText|hasFollowText)\b/g
const INSTRUCTION_REF_RE = /\binstruction\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b/g
const NOVEL_LANGUAGE_RE = /\bnovel\s*\.\s*language\b/g
const NOVEL_OUTLINE_RE = /\bnovel\s*\.\s*outline(?:\s*\.\s*(full|storysofar))?\b/g
const CHAT_USER_INPUT_PLACEHOLDER_RE = /^chat\s*\.\s*userInput(?!\s*\.)(?:\s*\|[\s\S]+)?$/u

function combinePromptMessages(messages: PromptMessage[]) {
    return messages.map((message) => (typeof message.content === 'string' ? message.content : '')).join('\n')
}

function collectRegexMatches(text: string, regex: RegExp, pick: (match: RegExpExecArray) => string | null) {
    const matches: string[] = []
    let match: RegExpExecArray | null

    regex.lastIndex = 0
    while ((match = regex.exec(text)) !== null) {
        const value = pick(match)?.trim() ?? ''
        if (value) matches.push(value)
        if (match.index === regex.lastIndex) regex.lastIndex += 1
    }
    regex.lastIndex = 0

    return matches
}

export function extractTemplateTagContentsFromMessages(messages: PromptMessage[]): string[] {
    return collectRegexMatches(combinePromptMessages(messages), TEMPLATE_BLOCK_RE, (match) => match[0] ?? null)
}

export function extractNunjucksIncludeNamesFromText(text: string) {
    return collectRegexMatches(text ?? '', INCLUDE_TAG_RE, (match) => match[2] ?? null)
}

export function extractReferencedInputNamesFromText(text: string) {
    return collectRegexMatches(text ?? '', INPUT_REF_RE, (match) => match[2] ?? match[3] ?? null)
}

export function countChatUserInputReferencesInText(text: string) {
    let count = 0
    VARIABLE_TAG_RE.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = VARIABLE_TAG_RE.exec(text ?? '')) !== null) {
        const expr = match[2]?.trim() ?? ''
        if (CHAT_USER_INPUT_PLACEHOLDER_RE.test(expr)) {
            count += 1
        }
        if (match.index === VARIABLE_TAG_RE.lastIndex) VARIABLE_TAG_RE.lastIndex += 1
    }
    VARIABLE_TAG_RE.lastIndex = 0
    return count
}

export function extractReferencedSceneKeysFromText(text: string) {
    return collectRegexMatches(text ?? '', SCENE_REF_RE, (match) => match[1] ?? null)
}

export function extractReferencedInstructionKeysFromText(text: string) {
    return collectRegexMatches(text ?? '', INSTRUCTION_REF_RE, (match) => match[1] ?? null)
}

export function textReferencesNovelLanguage(text: string) {
    NOVEL_LANGUAGE_RE.lastIndex = 0
    const found = NOVEL_LANGUAGE_RE.test(text ?? '')
    NOVEL_LANGUAGE_RE.lastIndex = 0
    return found
}

export function textReferencesNovelOutline(text: string) {
    NOVEL_OUTLINE_RE.lastIndex = 0
    const found = NOVEL_OUTLINE_RE.test(text ?? '')
    NOVEL_OUTLINE_RE.lastIndex = 0
    return found
}

export function extractStringArgCallsFromMessages(messages: PromptMessage[], functionName: string): string[] {
    const text = combinePromptMessages(messages)
    if (functionName === 'include') return extractNunjucksIncludeNamesFromText(text)
    if (functionName === 'input') return extractReferencedInputNamesFromText(text)
    return []
}

export function countStringArgCallsFromMessages(messages: PromptMessage[], functionName: string): Map<string, number> {
    const calls = extractStringArgCallsFromMessages(messages, functionName)
    const map = new Map<string, number>()
    for (const arg of calls) {
        map.set(arg, (map.get(arg) ?? 0) + 1)
    }
    return map
}

export type PromptTemplateReferenceAnalysis = {
    inputNames: string[]
    sceneKeys: string[]
    instructionKeys: string[]
    usesNovelLanguage: boolean
    usesNovelOutline: boolean
}

export type ChatPromptAnalysis = {
    valid: boolean
    lastMessageRole: PromptMessage['role'] | null
    lastMessageChatUserInputCount: number
    totalChatUserInputCount: number
}

export function analyzeChatPromptMessages(messages: PromptMessage[]): ChatPromptAnalysis {
    const lastMessage = messages[messages.length - 1] ?? null
    const lastMessageRole = lastMessage?.role ?? null
    const lastMessageChatUserInputCount = lastMessage ? countChatUserInputReferencesInText(lastMessage.content ?? '') : 0
    const totalChatUserInputCount = messages.reduce(
        (count, message) => count + countChatUserInputReferencesInText(message.content ?? ''),
        0
    )

    return {
        valid: lastMessageRole === 'user' && lastMessageChatUserInputCount === 1 && totalChatUserInputCount === 1,
        lastMessageRole,
        lastMessageChatUserInputCount,
        totalChatUserInputCount,
    }
}

export function analyzePromptTemplateReferences(params: {
    messages: PromptMessage[]
    resolveInclude?: (name: string) => PromptMessage[] | null | undefined
    maxDepth?: number
}): PromptTemplateReferenceAnalysis {
    const maxDepth = params.maxDepth ?? 5
    const inputNames = new Set<string>()
    const sceneKeys = new Set<string>()
    const instructionKeys = new Set<string>()
    let usesNovelLanguage = false
    let usesNovelOutline = false

    function visitMessages(messages: PromptMessage[], depth: number, includeStack: string[]) {
        const text = combinePromptMessages(messages)

        for (const inputName of extractReferencedInputNamesFromText(text)) {
            const name = inputName.trim()
            if (name) inputNames.add(name)
        }

        for (const sceneKey of extractReferencedSceneKeysFromText(text)) {
            const key = sceneKey.trim()
            if (key) sceneKeys.add(key)
        }

        for (const instructionKey of extractReferencedInstructionKeysFromText(text)) {
            const key = instructionKey.trim()
            if (key) instructionKeys.add(key)
        }

        if (!usesNovelLanguage && textReferencesNovelLanguage(text)) {
            usesNovelLanguage = true
        }

        if (!usesNovelOutline && textReferencesNovelOutline(text)) {
            usesNovelOutline = true
        }

        if (!params.resolveInclude || depth >= maxDepth) return

        for (const includeNameRaw of extractNunjucksIncludeNamesFromText(text)) {
            const includeName = includeNameRaw.trim()
            const includeKey = includeName.toLowerCase()
            if (!includeName || includeStack.includes(includeKey)) continue
            const includedMessages = params.resolveInclude(includeName)
            if (!includedMessages) continue
            visitMessages(includedMessages, depth + 1, [...includeStack, includeKey])
        }
    }

    visitMessages(params.messages, 0, [])

    return {
        inputNames: [...inputNames],
        sceneKeys: [...sceneKeys],
        instructionKeys: [...instructionKeys],
        usesNovelLanguage,
        usesNovelOutline,
    }
}
