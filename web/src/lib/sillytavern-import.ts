import type { StoredTerms, TermEntry } from '@/components/editor/terms/types'
import { plainTextToTiptapHtml } from '@/lib/plain-text-to-tiptap-html'

/**
 * SillyTavern / TavernAI character card import.
 *
 * Character cards are PNG files with the card JSON embedded in a PNG `tEXt`
 * chunk, base64-encoded. The keyword is `ccv3` (Character Card Spec V3) or
 * `chara` (V1/V2, also written by V3 exporters for backwards compatibility).
 * The card body lives under `data` for V2/V3 and at the root for V1.
 */

type TavernBookEntry = {
    keys?: string[]
    content?: string
    comment?: string
    name?: string
    enabled?: boolean
}

type TavernCharacterBook = {
    entries?: TavernBookEntry[]
}

type TavernCardData = {
    name?: string
    description?: string
    personality?: string
    scenario?: string
    first_mes?: string
    character_book?: TavernCharacterBook
}

export type ParsedTavernCard = {
    data: TavernCardData
    hasCharMacro: boolean
    hasUserMacro: boolean
    /** The original PNG file, reused as the novel cover. */
    coverFile: File
}

export type TavernMacroOptions = {
    /** How to handle `{{char}}`: replace with the card name, or keep literally. */
    char: 'replace' | 'keep'
    /** How to handle `{{user}}`: keep literally, or replace with `userName`. */
    user: 'replace' | 'keep'
    userName?: string
}

export type TavernImportLabels = {
    firstChapterTitle: string
    characterProfileTitle: string
    descriptionLabel: string
    personalityLabel: string
    scenarioLabel: string
    loreFallbackTitle: string
}

export type TavernImportResult = {
    novelTitle: string
    termState: StoredTerms
    snippet: { title: string; content: string } | null
    firstChapter: { title: string; contentHtml: string }
}

const CHAR_MACRO_GLOBAL = /\{\{\s*char\s*\}\}/gi
const USER_MACRO_GLOBAL = /\{\{\s*user\s*\}\}/gi
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function createId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function decodeBase64Utf8(base64: string): string {
    const binary = atob(base64.trim())
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Walk the PNG chunk stream and collect the text payloads of `tEXt` chunks,
 * keyed by their keyword. Only the first occurrence of each keyword is kept.
 */
function extractPngTextChunks(buffer: ArrayBuffer): Map<string, string> {
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
        if (bytes[i] !== PNG_SIGNATURE[i]) {
            throw new Error('not-a-png')
        }
    }

    const view = new DataView(buffer)
    const latin1 = new TextDecoder('latin1')
    const chunks = new Map<string, string>()
    let offset = 8

    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset)
        const type = latin1.decode(bytes.subarray(offset + 4, offset + 8))
        const dataStart = offset + 8

        if (type === 'tEXt') {
            const chunkData = bytes.subarray(dataStart, dataStart + length)
            const separator = chunkData.indexOf(0)
            if (separator !== -1) {
                const keyword = latin1.decode(chunkData.subarray(0, separator))
                // The base64 payload is ASCII, so latin1 decoding is lossless here.
                const text = latin1.decode(chunkData.subarray(separator + 1))
                if (!chunks.has(keyword)) {
                    chunks.set(keyword, text)
                }
            }
        }

        offset = dataStart + length + 4 // skip chunk data + 4-byte CRC
        if (type === 'IEND') break
    }

    return chunks
}

function hasMacro(text: string, kind: 'char' | 'user'): boolean {
    const regex = kind === 'char' ? /\{\{\s*char\s*\}\}/i : /\{\{\s*user\s*\}\}/i
    return regex.test(text)
}

function applyMacros(text: string, options: TavernMacroOptions, charName: string): string {
    let result = text
    if (options.char === 'replace' && charName) {
        result = result.replace(CHAR_MACRO_GLOBAL, charName)
    }
    if (options.user === 'replace' && options.userName) {
        result = result.replace(USER_MACRO_GLOBAL, options.userName)
    }
    return result
}

export async function parseSillyTavernCard(
    file: File,
    labels: { invalidCard: string }
): Promise<ParsedTavernCard> {
    let chunks: Map<string, string>
    try {
        chunks = extractPngTextChunks(await file.arrayBuffer())
    } catch {
        throw new Error(labels.invalidCard)
    }

    const encoded = chunks.get('ccv3') ?? chunks.get('chara')
    if (!encoded) {
        throw new Error(labels.invalidCard)
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(decodeBase64Utf8(encoded))
    } catch {
        throw new Error(labels.invalidCard)
    }

    const root = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    const data = (
        root.data && typeof root.data === 'object' ? root.data : root
    ) as TavernCardData

    const entries = data.character_book?.entries ?? []
    const hasAnyContent = Boolean(data.name || data.first_mes || entries.length > 0)
    if (!hasAnyContent) {
        throw new Error(labels.invalidCard)
    }

    const scanText = [
        data.first_mes,
        data.description,
        data.personality,
        data.scenario,
        ...entries.flatMap((entry) => [entry.content, entry.comment]),
    ]
        .filter((value): value is string => typeof value === 'string')
        .join('\n')

    return {
        data,
        hasCharMacro: hasMacro(scanText, 'char'),
        hasUserMacro: hasMacro(scanText, 'user'),
        coverFile: file,
    }
}

export function buildSillyTavernImport(
    card: ParsedTavernCard,
    options: TavernMacroOptions,
    labels: TavernImportLabels
): TavernImportResult {
    const { data } = card
    const charName = (data.name ?? '').trim() || labels.characterProfileTitle
    const apply = (text: string | undefined) => applyMacros(text ?? '', options, charName)

    // World book entries -> lore terms.
    const entries = data.character_book?.entries ?? []
    const termEntries: TermEntry[] = []
    entries.forEach((entry, index) => {
        const content = (entry.content ?? '').trim()
        const keys = (entry.keys ?? []).map((key) => key.trim()).filter(Boolean)
        const titleSource =
            (entry.comment ?? '').trim() ||
            (entry.name ?? '').trim() ||
            keys[0] ||
            `${labels.loreFallbackTitle} ${index + 1}`

        // Skip entries that carry nothing usable.
        if (!content && !titleSource) return

        termEntries.push({
            id: createId(),
            categoryId: 'lore',
            title: apply(titleSource),
            aliases: keys.length > 0 ? keys.join(', ') : undefined,
            description: content ? apply(content) : undefined,
        })
    })

    const termState: StoredTerms = {
        entries: termEntries,
        expandedCategoryIds: termEntries.length > 0 ? ['lore'] : [],
        selectedEntryId: termEntries[0]?.id ?? null,
        sortBy: 'name',
    }

    // Character profile (description / personality / scenario) -> snippet (HTML).
    const sections: string[] = []
    const pushSection = (label: string, value: string | undefined) => {
        const trimmed = (value ?? '').trim()
        if (trimmed) sections.push(`${label}\n${apply(trimmed)}`)
    }
    pushSection(labels.descriptionLabel, data.description)
    pushSection(labels.personalityLabel, data.personality)
    pushSection(labels.scenarioLabel, data.scenario)
    const snippetContent = sections.length > 0 ? plainTextToTiptapHtml(sections.join('\n\n')) : ''
    const snippet = snippetContent
        ? { title: labels.characterProfileTitle, content: snippetContent }
        : null

    // First greeting -> first chapter (HTML). Alternate greetings are ignored.
    const firstChapter = {
        title: labels.firstChapterTitle,
        contentHtml: plainTextToTiptapHtml(apply(data.first_mes)),
    }

    return {
        novelTitle: charName,
        termState,
        snippet,
        firstChapter,
    }
}
