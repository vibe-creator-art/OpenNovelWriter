import type { StoredTerms, TermCategoryId, TermEntry } from '@/components/editor/terms/types'
import { plainTextToTiptapHtml } from '@/lib/plain-text-to-tiptap-html'

type NovelCrafterImportLabels = {
    invalidProject: string
    missingImportContent: string
}

type FrontmatterParseResult = {
    name: string
    aliases: string[]
    tags: string[]
}

type BrowserFile = File & {
    webkitRelativePath?: string
}

const TERM_DIRECTORY_TO_CATEGORY_ID = {
    characters: 'characters',
    locations: 'locations',
    objects: 'items',
    lore: 'lore',
} as const

type SupportedNovelCrafterTermDirectory = keyof typeof TERM_DIRECTORY_TO_CATEGORY_ID

export type NovelCrafterImportResult = {
    novelTitle: string
    authorName?: string
    termState: StoredTerms
    snippets: Array<{
        title: string
        content: string
        pinned: boolean
    }>
    manuscript: {
        acts: Array<{
            number: number
            title?: string
        }>
        chapters: Array<{
            title: string
            actNumber: number
            order: number
            scenes: Array<{
                summary?: string
                contentHtml: string
            }>
        }>
    }
    importedTermCount: number
    importedSnippetCount: number
    importedChapterCount: number
    importedSceneCount: number
}

function createId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function normalizeRelativePath(file: BrowserFile) {
    return (file.webkitRelativePath || file.name || '').replace(/\\/g, '/')
}

function sanitizeScalarValue(raw: string) {
    const trimmed = raw.trim()
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1).trim()
    }
    return trimmed
}

function isInlineEmptyCollection(value: string) {
    return value === '[]' || value === '{}'
}

function splitFrontmatter(markdown: string) {
    const normalized = markdown.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) {
        return { frontmatter: '', body: normalized.trim() }
    }

    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) {
        return { frontmatter: '', body: normalized.trim() }
    }

    return {
        frontmatter: normalized.slice(4, closingIndex).trim(),
        body: normalized.slice(closingIndex + 5).trim(),
    }
}

function parseFrontmatter(frontmatter: string): FrontmatterParseResult {
    const result: FrontmatterParseResult = {
        name: '',
        aliases: [],
        tags: [],
    }

    let currentListKey: 'aliases' | 'tags' | null = null

    for (const rawLine of frontmatter.split('\n')) {
        const line = rawLine.trimEnd()
        if (!line.trim()) continue

        const listMatch = line.match(/^\s*-\s+(.*)$/)
        if (listMatch && currentListKey) {
            const value = sanitizeScalarValue(listMatch[1] ?? '')
            if (value) {
                result[currentListKey].push(value)
            }
            continue
        }

        currentListKey = null
        const separatorIndex = line.indexOf(':')
        if (separatorIndex === -1) continue

        const key = line.slice(0, separatorIndex).trim()
        const value = sanitizeScalarValue(line.slice(separatorIndex + 1))

        if (key === 'name') {
            result.name = value
            continue
        }

        if (key === 'aliases' || key === 'tags') {
            currentListKey = key
            if (value && !isInlineEmptyCollection(value)) {
                result[key].push(value)
            }
        }
    }

    return result
}

function parseSnippetFrontmatter(frontmatter: string) {
    let title = ''
    let pinned = false

    for (const rawLine of frontmatter.split('\n')) {
        const line = rawLine.trim()
        if (!line) continue

        const separatorIndex = line.indexOf(':')
        if (separatorIndex === -1) continue

        const key = line.slice(0, separatorIndex).trim()
        const value = sanitizeScalarValue(line.slice(separatorIndex + 1))

        if (key === 'title') {
            title = value
            continue
        }

        if (key === 'favourite') {
            pinned = value.toLowerCase() === 'true'
        }
    }

    return { title, pinned }
}

function sanitizeExportFolderName(name: string) {
    const trimmed = name.trim()
    const timestampMatch = trimmed.match(/^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\s+(.+)$/)
    const withoutTimestamp = timestampMatch?.[1]?.trim() || trimmed
    return withoutTimestamp.replace(/\s*-\s*full$/i, '').trim()
}

function extractNovelTitleFromMarkdown(markdown: string) {
    const normalized = markdown.replace(/\r\n/g, '\n')
    const headingMatch = normalized.match(/^#\s+(.+)$/m)
    return headingMatch?.[1]?.trim() || ''
}

function extractNovelAuthorFromMarkdown(markdown: string) {
    const normalized = markdown.replace(/\r\n/g, '\n')
    const authorMatch = normalized.match(/^by\s+(.+)$/mi)
    return authorMatch?.[1]?.trim() || ''
}

function toTermEntry(markdown: string, directory: SupportedNovelCrafterTermDirectory): TermEntry | null {
    const { frontmatter, body } = splitFrontmatter(markdown)
    const parsed = parseFrontmatter(frontmatter)

    if (!parsed.name) {
        return null
    }

    return {
        id: createId(),
        categoryId: TERM_DIRECTORY_TO_CATEGORY_ID[directory],
        title: parsed.name,
        aliases: parsed.aliases.length > 0 ? parsed.aliases.join(', ') : undefined,
        tags: parsed.tags.length > 0 ? parsed.tags : undefined,
        description: body || undefined,
    }
}

function toSnippetImport(markdown: string) {
    const { frontmatter, body } = splitFrontmatter(markdown)
    const parsed = parseSnippetFrontmatter(frontmatter)

    return {
        title: parsed.title,
        pinned: parsed.pinned,
        content: body,
    }
}

type ParsedNovelCrafterScene = {
    summary?: string
    contentHtml: string
}

type ParsedNovelCrafterChapter = {
    title: string
    actNumber: number
    order: number
    scenes: ParsedNovelCrafterScene[]
}

function isSceneDividerLine(line: string) {
    return /^\*\s*\*\s*\*$/.test(line.trim())
}

function isSummaryDividerLine(line: string) {
    return /^---$/.test(line.trim())
}

function splitSceneBlocks(rawBody: string) {
    const lines = rawBody.replace(/\r\n/g, '\n').split('\n')
    const blocks: string[] = []
    let current: string[] = []

    for (const line of lines) {
        if (isSceneDividerLine(line)) {
            const block = current.join('\n').trim()
            if (block) blocks.push(block)
            current = []
            continue
        }
        current.push(line)
    }

    const finalBlock = current.join('\n').trim()
    if (finalBlock) blocks.push(finalBlock)
    return blocks
}

function parseSceneBlock(block: string): ParsedNovelCrafterScene | null {
    const lines = block.replace(/\r\n/g, '\n').split('\n')
    const dividerIndex = lines.findIndex((line) => isSummaryDividerLine(line))
    const summaryText = dividerIndex >= 0 ? lines.slice(0, dividerIndex).join('\n').trim() : ''
    const contentText = dividerIndex >= 0 ? lines.slice(dividerIndex + 1).join('\n').trim() : block.trim()
    const contentHtml = plainTextToTiptapHtml(contentText)

    if (!summaryText && !contentHtml) {
        return null
    }

    return {
        summary: summaryText || undefined,
        contentHtml,
    }
}

function parseChapterHeadingTitle(rawHeading: string) {
    const trimmed = rawHeading.trim()
    const chapterMatch = trimmed.match(/^Chapter\s+\d+\s*:\s*(.+)$/i)
    if (chapterMatch?.[1]?.trim()) {
        return chapterMatch[1].trim()
    }
    return trimmed
}

function parseNovelCrafterManuscript(markdown: string): NovelCrafterImportResult['manuscript'] {
    const normalized = markdown.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    const acts: Array<{ number: number; title?: string }> = []
    const chapters: ParsedNovelCrafterChapter[] = []

    let currentActNumber = 1
    let currentActTitle: string | undefined
    let chapterTitle: string | null = null
    let chapterActNumber = 1
    let chapterOrder = 0
    let chapterBodyLines: string[] = []

    const flushChapter = () => {
        if (!chapterTitle) return
        const body = chapterBodyLines.join('\n').trim()
        const scenes = splitSceneBlocks(body)
            .map((block) => parseSceneBlock(block))
            .filter((scene): scene is ParsedNovelCrafterScene => scene !== null)

        chapters.push({
            title: chapterTitle,
            actNumber: chapterActNumber,
            order: chapterOrder,
            scenes: scenes.length > 0 ? scenes : [{ contentHtml: '' }],
        })

        chapterTitle = null
        chapterBodyLines = []
    }

    for (const rawLine of lines) {
        const line = rawLine.trimEnd()

        if (/^#\s+/.test(line)) {
            continue
        }

        if (/^by\s+/i.test(line) && !chapterTitle) {
            continue
        }

        const actMatch = line.match(/^##\s+(.+)$/)
        if (actMatch) {
            flushChapter()
            currentActTitle = actMatch[1]?.trim() || undefined
            currentActNumber = acts.length + 1
            acts.push({ number: currentActNumber, title: currentActTitle })
            continue
        }

        const chapterMatch = line.match(/^###\s+(.+)$/)
        if (chapterMatch) {
            flushChapter()
            chapterTitle = parseChapterHeadingTitle(chapterMatch[1] ?? '')
            chapterActNumber = acts.length > 0 ? currentActNumber : 1
            chapterOrder = chapters.filter((chapter) => chapter.actNumber === chapterActNumber).length + 1
            continue
        }

        if (!chapterTitle) {
            continue
        }

        chapterBodyLines.push(rawLine)
    }

    flushChapter()

    return {
        acts,
        chapters,
    }
}

export async function importNovelCrafterProject(
    rawFiles: File[],
    labels: NovelCrafterImportLabels
): Promise<NovelCrafterImportResult> {
    const files = rawFiles.filter((file): file is BrowserFile => file instanceof File)
    if (files.length === 0) {
        throw new Error(labels.invalidProject)
    }

    const filesByPath = new Map<string, BrowserFile>()
    for (const file of files) {
        const relativePath = normalizeRelativePath(file)
        if (!relativePath) continue
        filesByPath.set(relativePath, file)
    }

    if (filesByPath.size === 0) {
        throw new Error(labels.invalidProject)
    }

    const sortedPaths = Array.from(filesByPath.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    const termEntries: TermEntry[] = []
    const expandedCategoryIds = new Set<TermCategoryId>()
    const termDirectories = Object.keys(TERM_DIRECTORY_TO_CATEGORY_ID) as SupportedNovelCrafterTermDirectory[]

    for (const directory of termDirectories) {
        const entryPaths = sortedPaths.filter((path) => new RegExp(`^.+/${directory}/[^/]+/entry\\.md$`, 'i').test(path))
        for (const path of entryPaths) {
            const file = filesByPath.get(path)
            if (!file) continue
            const entry = toTermEntry(await file.text(), directory)
            if (!entry) continue
            termEntries.push(entry)
            expandedCategoryIds.add(entry.categoryId)
        }
    }

    const rootFolderName = sanitizeExportFolderName(sortedPaths[0]?.split('/')[0] || '')
    const novelMarkdownPath = sortedPaths.find((path) => /^.+\/novel\.md$/i.test(path))
    const novelMarkdownFile = novelMarkdownPath ? filesByPath.get(novelMarkdownPath) : null
    const novelMarkdown = novelMarkdownFile ? await novelMarkdownFile.text() : ''
    const novelTitleFromMarkdown = novelMarkdown ? extractNovelTitleFromMarkdown(novelMarkdown) : ''
    const authorName = novelMarkdown ? extractNovelAuthorFromMarkdown(novelMarkdown) : ''
    const novelTitle = novelTitleFromMarkdown || rootFolderName || 'NovelCrafter Import'
    const snippetPaths = sortedPaths.filter((path) => /^.+\/snippets\/.+\.md$/i.test(path))
    const snippets: NovelCrafterImportResult['snippets'] = []

    for (const path of snippetPaths) {
        const file = filesByPath.get(path)
        if (!file) continue
        snippets.push(toSnippetImport(await file.text()))
    }

    const manuscript = novelMarkdown ? parseNovelCrafterManuscript(novelMarkdown) : { acts: [], chapters: [] }
    const importedSceneCount = manuscript.chapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0)

    if (termEntries.length === 0 && snippets.length === 0 && manuscript.chapters.length === 0) {
        throw new Error(labels.missingImportContent)
    }

    return {
        novelTitle,
        authorName: authorName || undefined,
        importedTermCount: termEntries.length,
        importedSnippetCount: snippets.length,
        importedChapterCount: manuscript.chapters.length,
        importedSceneCount,
        snippets,
        manuscript,
        termState: {
            entries: termEntries,
            expandedCategoryIds: Array.from(expandedCategoryIds),
            selectedEntryId: termEntries[0]?.id ?? null,
            sortBy: 'name',
        },
    }
}
