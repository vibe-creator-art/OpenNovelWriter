import { renderPromptTemplateText, type PromptTemplateRenderWarning } from './prompt-template-render'

const INDENT = '\t'

const TEMPLATE_SYNTAX_WARNING_TYPES = new Set<PromptTemplateRenderWarning['type']>([
    'invalid_input_syntax',
    'invalid_include_syntax',
    'unsupported_template_syntax',
    'unclosed_template_expr',
    'unsupported_variable_expr',
])

const BLOCK_TAG_RE = /\{%-?\s*([\s\S]*?)\s*-?%\}/g
const NUNJUCKS_TOKEN_RE = /\{\{-?[\s\S]*?-?\}\}|\{%-?[\s\S]*?-?%\}|\{#-?[\s\S]*?-?#\}/g
const XML_TAG_RE = /<\s*(\/)?([A-Za-z][A-Za-z0-9:_-]*)(?:\s[^<>]*?)?\s*(\/?)>/g
const CODE_FENCE_RE = /^\s*(`{3,}|~{3,})/
const RAW_END_RE = /\{%-?\s*endraw\b[\s\S]*?-?%\}/

const OPEN_BLOCK_KEYWORDS = new Set([
    'if',
    'for',
    'macro',
    'block',
    'filter',
    'raw',
    'call',
    'with',
    'switch',
])

const BRANCH_BLOCK_KEYWORDS = new Set(['elif', 'else'])

type StructuralToken = {
    index: number
    action: 'open' | 'close' | 'branch' | 'switchBranch'
    keyword?: string
}

function extractBlockTokens(line: string): StructuralToken[] {
    const tokens: StructuralToken[] = []
    BLOCK_TAG_RE.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = BLOCK_TAG_RE.exec(line)) !== null) {
        const statement = (match[1] ?? '').trim()
        const keyword = statement.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1]?.toLowerCase()
        if (!keyword) continue

        if (keyword.startsWith('end')) {
            tokens.push({ index: match.index, action: 'close', keyword })
            continue
        }

        if (BRANCH_BLOCK_KEYWORDS.has(keyword)) {
            tokens.push({ index: match.index, action: 'branch', keyword })
            continue
        }

        if (keyword === 'case' || keyword === 'default') {
            tokens.push({ index: match.index, action: 'switchBranch', keyword })
            continue
        }

        if (keyword === 'set') {
            if (!statement.includes('=')) tokens.push({ index: match.index, action: 'open', keyword })
            continue
        }

        if (OPEN_BLOCK_KEYWORDS.has(keyword)) {
            tokens.push({ index: match.index, action: 'open', keyword })
        }
    }

    return tokens
}

function extractXmlTokens(line: string): StructuralToken[] {
    NUNJUCKS_TOKEN_RE.lastIndex = 0
    const withoutBlocks = line.replace(NUNJUCKS_TOKEN_RE, (token) => ' '.repeat(token.length))
    XML_TAG_RE.lastIndex = 0
    const withoutTags = withoutBlocks.replace(XML_TAG_RE, '')
    if (withoutTags.trim()) return []

    const tokens: StructuralToken[] = []
    XML_TAG_RE.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = XML_TAG_RE.exec(withoutBlocks)) !== null) {
        const closing = Boolean(match[1])
        const selfClosing = Boolean(match[3])
        if (selfClosing) continue
        tokens.push({ index: match.index, action: closing ? 'close' : 'open' })
    }

    return tokens
}

function getStructuralTokens(line: string) {
    return [...extractBlockTokens(line), ...extractXmlTokens(line)].sort((left, right) => left.index - right.index)
}

function updateDepth(depth: number, tokens: StructuralToken[]) {
    let nextDepth = depth

    for (const token of tokens) {
        if (token.action === 'open') {
            nextDepth += 1
            continue
        }

        if (token.action === 'close') {
            nextDepth = Math.max(0, nextDepth - 1)
            continue
        }

        if (token.action === 'branch') {
            // `else` and `elif` align with their opener, but their body stays at the
            // same depth as the preceding branch body.
            continue
        }

        // Keep switch branches at the switch body's indentation. Unlike `else`, a `case`
        // does not close the surrounding `switch`, and treating it as another open block
        // would make each subsequent case drift farther to the right.
    }

    return nextDepth
}

function getLineDepth(depth: number, line: string, tokens: StructuralToken[]) {
    const first = tokens[0]
    if (!first || line.slice(0, first.index).trim()) return depth
    if (first.action === 'close' || first.action === 'branch') return Math.max(0, depth - 1)
    return depth
}

export function formatPromptTemplate(source: string): string {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const formatted: string[] = []
    let depth = 0
    let blankPending = false
    let inRawBlock = false
    let codeFence: string | null = null

    const pushPendingBlank = () => {
        if (!blankPending) return
        blankPending = false
        if (formatted.length > 0) formatted.push('')
    }

    for (const originalLine of lines) {
        const trimmed = originalLine.trim()

        if (codeFence) {
            formatted.push(originalLine)
            const closingFence = CODE_FENCE_RE.exec(originalLine)?.[1] ?? null
            if (closingFence?.[0] === codeFence[0] && closingFence.length >= codeFence.length) codeFence = null
            continue
        }

        if (inRawBlock && !RAW_END_RE.test(originalLine)) {
            formatted.push(originalLine)
            continue
        }

        if (!trimmed) {
            blankPending = true
            continue
        }

        pushPendingBlank()

        const tokens = getStructuralTokens(originalLine)
        const lineDepth = getLineDepth(depth, originalLine, tokens)
        const normalizedLine = `${INDENT.repeat(lineDepth)}${trimmed}`
        formatted.push(normalizedLine)

        depth = updateDepth(depth, tokens)

        if (inRawBlock && RAW_END_RE.test(originalLine)) inRawBlock = false
        else if (tokens.some((token) => token.action === 'open' && token.keyword === 'raw')) inRawBlock = true

        const openingFence = CODE_FENCE_RE.exec(originalLine)?.[1] ?? null
        if (openingFence) codeFence = openingFence
    }

    return formatted.join('\n')
}

export function getPromptTemplateSyntaxError(source: string): PromptTemplateRenderWarning | null {
    const rendered = renderPromptTemplateText({
        text: source,
        context: {},
        resolvers: {
            resolveInput: () => '',
            resolveInclude: () => '',
        },
    })

    return rendered.warnings.find((warning) => TEMPLATE_SYNTAX_WARNING_TYPES.has(warning.type)) ?? null
}
