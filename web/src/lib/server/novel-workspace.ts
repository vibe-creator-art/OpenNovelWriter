import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'

import { getPrismaClient } from '@/lib/db'
import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'
import { getUserAgentsRoot } from '@/lib/server/agent-storage'
import { removeManagedSymlink } from '@/lib/server/managed-symlink'
import { getTermStateEntries } from '@/lib/term-state'

const prisma = getPrismaClient({ ensureModel: 'novel' })
const require = createRequire(import.meta.url)
const {
    buildNovelWorkspaceOutlineMarkdown,
    buildNovelWorkspaceChapterMarkdown,
    buildNovelWorkspaceSnippetIndexMarkdown,
    buildNovelWorkspaceSnippetMarkdown,
} = require('./novel-workspace-projection.cjs') as {
    buildNovelWorkspaceOutlineMarkdown: (novel: NovelWorkspaceOutlineInput) => string
    buildNovelWorkspaceChapterMarkdown: (chapter: NovelWorkspaceChapterInput) => string
    buildNovelWorkspaceSnippetIndexMarkdown: (novel: NovelWorkspaceSnippetIndexInput) => string
    buildNovelWorkspaceSnippetMarkdown: (snippet: NovelWorkspaceSnippetProjectionInput) => string
}
const {
    getNovelWorkspaceTermFileName,
    assignUniqueTermFileNames,
    buildTermProjectionSnapshots,
} = require('./novel-workspace-terms.cjs') as {
    getNovelWorkspaceTermFileName: (title: string) => string
    assignUniqueTermFileNames: (terms: Array<{ id: string; title: string }>) => Map<string, string>
    buildTermProjectionSnapshots: (input: {
        novelId: string
        language: string | null
        state: unknown
    }) => TermProjectionSnapshot[]
}

type TermProjectionSnapshot = {
    term: { id: string; title: string }
    fileName: string
    markdown: string
}

export { getNovelWorkspaceTermFileName, assignUniqueTermFileNames }

const AGENTS_FILE_NAME = 'AGENTS.md'
const OUTLINE_FILE_NAME = 'outline.md'
const SNIPPET_INDEX_FILE_NAME = 'snippet.md'
const CHAPTERS_DIR_NAME = 'chapters'
const TERMS_DIR_NAME = 'terms'
const SNIPPETS_DIR_NAME = 'snippets'

type NovelWorkspaceOutlineInput = {
    id: string
    title: string
    language: string | null
    acts: Array<{
        number: number
        title: string | null
        summary: string | null
    }>
    chapters: Array<{
        id: string
        title: string
        actNumber: number
        order: number
        scenes: Array<{
            id: string
            order: number
            summary: string | null
        }>
    }>
}

type NovelWorkspaceChapterInput = {
    id: string
    title: string
    language: string | null
    scenes: Array<{
        id: string
        order: number
        summary: string | null
        content: string
    }>
}

type NovelWorkspaceSnippetInput = {
    id: string
    title: string
    content: string
    pinned: boolean
    createdAt: string
    updatedAt: string
}

type NovelWorkspaceSnippetIndexInput = {
    id: string
    title: string
    language: string | null
    snippets: NovelWorkspaceSnippetInput[]
}

type NovelWorkspaceSnippetProjectionInput = {
    novelId: string
    language: string | null
    snippet: NovelWorkspaceSnippetInput
}

export function getNovelWorkspacesRoot() {
    return path.join(getOpenNovelWriterDataDir(), 'codex', 'novels')
}

export function getNovelWorkspacePath(ownerId: string, novelId: string) {
    return path.join(getNovelWorkspacesRoot(), ownerId, novelId)
}

export function getNovelWorkspaceOutlinePath(ownerId: string, novelId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, OUTLINE_FILE_NAME)
}

export function getNovelWorkspaceChaptersPath(ownerId: string, novelId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, CHAPTERS_DIR_NAME)
}

export function getNovelWorkspaceChapterPath(ownerId: string, novelId: string, chapterId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, CHAPTERS_DIR_NAME, `${chapterId}.md`)
}

export function getNovelWorkspaceTermsPath(ownerId: string, novelId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, TERMS_DIR_NAME)
}

export function getNovelWorkspaceSnippetIndexPath(ownerId: string, novelId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, SNIPPET_INDEX_FILE_NAME)
}

export function getNovelWorkspaceSnippetsPath(ownerId: string, novelId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, SNIPPETS_DIR_NAME)
}

export function getNovelWorkspaceSnippetPath(ownerId: string, novelId: string, snippetId: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, SNIPPETS_DIR_NAME, `${snippetId}.md`)
}

export function getNovelWorkspaceTermPath(ownerId: string, novelId: string, title: string) {
    return getNovelWorkspaceProjectionPath(ownerId, novelId, TERMS_DIR_NAME, getNovelWorkspaceTermFileName(title))
}

/**
 * Resolve every active term of a novel to its workspace file name (collision-free). Used by the
 * Codex message route to rewrite `@term` mentions into a read instruction pointing at the exact
 * `novel/terms/<file>.md`. Returns an empty map when the novel has no term state.
 */
export async function getNovelWorkspaceTermFileMap(
    ownerId: string,
    novelId: string
): Promise<Map<string, { title: string; fileName: string }>> {
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: { termState: { select: { stateJson: true } } },
    })
    const entries = getTermStateEntries(parseMaybeJson(novel?.termState?.stateJson))
        .filter((entry) => entry.archived !== true)
        .map((entry) => ({
            id: typeof entry.id === 'string' ? entry.id.trim() : '',
            title: typeof entry.title === 'string' ? entry.title.trim() : '',
        }))
        .filter((entry) => entry.id && entry.title)
    const fileNameById = assignUniqueTermFileNames(entries)
    const out = new Map<string, { title: string; fileName: string }>()
    for (const { id, title } of entries) {
        const fileName = fileNameById.get(id)
        if (fileName) out.set(id, { title, fileName })
    }
    return out
}

export async function deleteNovelWorkspace(ownerId: string, novelId: string) {
    await fs.rm(getNovelWorkspacePath(ownerId, novelId), {
        recursive: true,
        force: true,
    })
}

export async function ensureNovelWorkspace(ownerId: string, novelId: string) {
    const workspacePath = await ensureNovelWorkspaceDirectory(ownerId, novelId)
    await Promise.all([
        removeNovelWorkspaceAgent(ownerId, novelId),
        syncNovelWorkspaceOutline(ownerId, novelId),
        syncNovelWorkspaceSnippets(ownerId, novelId),
    ])

    const chaptersPath = getNovelWorkspaceChaptersPath(ownerId, novelId)
    const hasChapterFiles = await hasMarkdownFiles(chaptersPath)
    if (!hasChapterFiles) {
        await syncNovelWorkspaceChapters(ownerId, novelId)
    }

    const termsPath = getNovelWorkspaceTermsPath(ownerId, novelId)
    const hasTermFiles = await hasMarkdownFiles(termsPath)
    if (!hasTermFiles) {
        await syncNovelWorkspaceTerms(ownerId, novelId)
    }

    return workspacePath
}

export async function ensureNovelWorkspaces(ownerId: string, novelIds: string[]) {
    await Promise.all(novelIds.map(async (novelId) => {
        await ensureNovelWorkspaceDirectory(ownerId, novelId)
        await removeNovelWorkspaceAgent(ownerId, novelId)
        await Promise.all([
            syncNovelWorkspaceOutline(ownerId, novelId),
            syncNovelWorkspaceSnippets(ownerId, novelId),
        ])
        const chaptersPath = getNovelWorkspaceChaptersPath(ownerId, novelId)
        if (!(await hasMarkdownFiles(chaptersPath))) {
            await syncNovelWorkspaceChapters(ownerId, novelId)
        }
        const termsPath = getNovelWorkspaceTermsPath(ownerId, novelId)
        if (!(await hasMarkdownFiles(termsPath))) {
            await syncNovelWorkspaceTerms(ownerId, novelId)
        }
    }))
}

export async function syncNovelWorkspaceOutline(ownerId: string, novelId: string) {
    const workspacePath = await ensureNovelWorkspaceDirectory(ownerId, novelId)
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            id: true,
            title: true,
            language: true,
            acts: {
                select: {
                    number: true,
                    title: true,
                    summary: true,
                },
            },
            chapters: {
                select: {
                    id: true,
                    title: true,
                    actNumber: true,
                    order: true,
                    scenes: {
                        select: {
                            id: true,
                            order: true,
                            summary: true,
                        },
                    },
                },
            },
        },
    })

    if (!novel) return null

    const outlinePath = path.join(workspacePath, OUTLINE_FILE_NAME)
    await writeReadonlyProjectionFile(outlinePath, buildNovelWorkspaceOutlineMarkdown(novel))

    return outlinePath
}

export async function syncNovelWorkspaceChapter(ownerId: string, novelId: string, chapterId: string) {
    const workspacePath = await ensureNovelWorkspaceDirectory(ownerId, novelId)
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            language: true,
            chapters: {
                where: { id: chapterId },
                select: {
                    id: true,
                    title: true,
                    scenes: {
                        select: {
                            id: true,
                            order: true,
                            summary: true,
                            content: true,
                        },
                    },
                },
            },
        },
    })

    if (!novel) return null
    const chapter = novel?.chapters[0] ?? null
    if (!chapter) return null

    const chapterPath = path.join(workspacePath, CHAPTERS_DIR_NAME, `${chapter.id}.md`)
    await writeReadonlyProjectionFile(chapterPath, buildNovelWorkspaceChapterMarkdown({
        id: chapter.id,
        title: chapter.title,
        language: novel.language,
        scenes: chapter.scenes,
    }))

    return chapterPath
}

export async function syncNovelWorkspaceChapters(ownerId: string, novelId: string, chapterIds?: string[]) {
    const workspacePath = await ensureNovelWorkspaceDirectory(ownerId, novelId)
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            language: true,
            chapters: {
                ...(chapterIds && chapterIds.length > 0 ? { where: { id: { in: chapterIds } } } : {}),
                select: {
                    id: true,
                    title: true,
                    scenes: {
                        select: {
                            id: true,
                            order: true,
                            summary: true,
                            content: true,
                        },
                    },
                },
            },
        },
    })

    if (!novel) return null

    const chapterPaths = await Promise.all((novel.chapters ?? []).map(async (chapter) => {
        const chapterPath = path.join(workspacePath, CHAPTERS_DIR_NAME, `${chapter.id}.md`)
        await writeReadonlyProjectionFile(chapterPath, buildNovelWorkspaceChapterMarkdown({
            id: chapter.id,
            title: chapter.title,
            language: novel.language,
            scenes: chapter.scenes,
        }))
        return chapterPath
    }))

    return chapterPaths
}

export async function syncNovelWorkspaceTerms(
    ownerId: string,
    novelId: string,
    options?: {
        previousState?: unknown
        nextState?: unknown
    }
) {
    await ensureNovelWorkspaceDirectory(ownerId, novelId)
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            language: true,
            termState: {
                select: {
                    stateJson: true,
                },
            },
        },
    })

    if (!novel) return null

    const previousState = options?.previousState ?? null
    const nextState = options?.nextState ?? parseMaybeJson(novel.termState?.stateJson)
    const nextSnapshots = buildTermProjectionSnapshots({
        novelId,
        language: novel.language,
        state: nextState,
    })
    const previousSnapshots = previousState
        ? buildTermProjectionSnapshots({
              novelId,
              language: novel.language,
              state: previousState,
          })
        : []

    const previousById = new Map(previousSnapshots.map((snapshot) => [snapshot.term.id, snapshot] as const))
    const nextById = new Map(nextSnapshots.map((snapshot) => [snapshot.term.id, snapshot] as const))
    const termsPath = getNovelWorkspaceTermsPath(ownerId, novelId)
    await fs.mkdir(termsPath, { recursive: true })

    await Promise.all(
        previousSnapshots
            .filter((snapshot) => !nextById.has(snapshot.term.id))
            .map((snapshot) => removeWorkspaceFile(path.join(termsPath, snapshot.fileName)))
    )

    await Promise.all(
        nextSnapshots.map(async (snapshot) => {
            const previous = previousById.get(snapshot.term.id) ?? null
            const filePath = path.join(termsPath, snapshot.fileName)
            const previousFilePath = previous ? path.join(termsPath, previous.fileName) : null
            if (previous && previousFilePath === filePath && previous.markdown === snapshot.markdown) {
                return filePath
            }

            if (previousFilePath && previousFilePath !== filePath) {
                await removeWorkspaceFile(previousFilePath)
            }

            await writeReadonlyProjectionFile(filePath, snapshot.markdown)
            return filePath
        })
    )

    return termsPath
}

export async function syncNovelWorkspaceSnippets(ownerId: string, novelId: string) {
    const workspacePath = await ensureNovelWorkspaceDirectory(ownerId, novelId)
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            id: true,
            title: true,
            language: true,
            snippets: {
                orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
                select: {
                    id: true,
                    title: true,
                    content: true,
                    pinned: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        },
    })

    if (!novel) return null

    const snippetsPath = getNovelWorkspaceSnippetsPath(ownerId, novelId)
    await fs.mkdir(snippetsPath, { recursive: true })

    const snippets = novel.snippets.map(toSnippetProjectionInput)
    const indexPath = path.join(workspacePath, SNIPPET_INDEX_FILE_NAME)
    const snippetPaths = await Promise.all(snippets.map(async (snippet) => {
        const snippetPath = path.join(snippetsPath, `${snippet.id}.md`)
        await writeReadonlyProjectionFile(snippetPath, buildNovelWorkspaceSnippetMarkdown({
            novelId,
            language: novel.language,
            snippet,
        }))
        return snippetPath
    }))

    await writeReadonlyProjectionFile(indexPath, buildNovelWorkspaceSnippetIndexMarkdown({
        id: novel.id,
        title: novel.title,
        language: novel.language,
        snippets,
    }))

    return {
        indexPath,
        snippetPaths,
    }
}

export async function syncNovelWorkspaceSnippet(ownerId: string, novelId: string, snippetId: string) {
    const workspacePath = await ensureNovelWorkspaceDirectory(ownerId, novelId)
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            id: true,
            title: true,
            language: true,
            snippets: {
                orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
                select: {
                    id: true,
                    title: true,
                    content: true,
                    pinned: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        },
    })

    if (!novel) return null

    const snippets = novel.snippets.map(toSnippetProjectionInput)
    const snippet = snippets.find((item) => item.id === snippetId) ?? null
    if (!snippet) return null

    const indexPath = path.join(workspacePath, SNIPPET_INDEX_FILE_NAME)
    const snippetPath = getNovelWorkspaceSnippetPath(ownerId, novelId, snippetId)
    await Promise.all([
        writeReadonlyProjectionFile(snippetPath, buildNovelWorkspaceSnippetMarkdown({
            novelId,
            language: novel.language,
            snippet,
        })),
        writeReadonlyProjectionFile(indexPath, buildNovelWorkspaceSnippetIndexMarkdown({
            id: novel.id,
            title: novel.title,
            language: novel.language,
            snippets,
        })),
    ])

    return snippetPath
}

export async function removeNovelWorkspaceChapter(ownerId: string, novelId: string, chapterId: string) {
    const chapterPath = getNovelWorkspaceChapterPath(ownerId, novelId, chapterId)
    await fs.rm(chapterPath, {
        force: true,
    })
    return chapterPath
}

export async function removeNovelWorkspaceSnippet(ownerId: string, novelId: string, snippetId: string) {
    const snippetPath = getNovelWorkspaceSnippetPath(ownerId, novelId, snippetId)
    await removeWorkspaceFile(snippetPath)
    await syncNovelWorkspaceSnippets(ownerId, novelId)
    return snippetPath
}

export async function removeNovelWorkspaceTerm(ownerId: string, novelId: string, title: string) {
    const termPath = getNovelWorkspaceTermPath(ownerId, novelId, title)
    await fs.rm(termPath, {
        force: true,
    })
    return termPath
}

export async function writeReadonlyProjectionFile(filePath: string, content: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.chmod(filePath, 0o644).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    await fs.writeFile(filePath, content, 'utf8')
    await fs.chmod(filePath, 0o444)
}

async function removeWorkspaceFile(filePath: string) {
    await fs.chmod(filePath, 0o644).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    await fs.rm(filePath, {
        force: true,
    })
}

function getNovelWorkspaceProjectionPath(ownerId: string, novelId: string, ...segments: string[]) {
    const workspacePath = getNovelWorkspacePath(ownerId, novelId)
    const resolved = path.resolve(workspacePath, ...segments)
    if (!isInsideDirectory(resolved, workspacePath)) {
        throw new Error('Invalid workspace projection path')
    }
    return resolved
}

async function ensureNovelWorkspaceDirectory(ownerId: string, novelId: string) {
    const workspacePath = getNovelWorkspacePath(ownerId, novelId)
    await fs.mkdir(path.join(workspacePath, CHAPTERS_DIR_NAME), { recursive: true })
    await fs.mkdir(path.join(workspacePath, TERMS_DIR_NAME), { recursive: true })
    await fs.mkdir(path.join(workspacePath, SNIPPETS_DIR_NAME), { recursive: true })
    return workspacePath
}

async function hasMarkdownFiles(directoryPath: string) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    })
    return entries.some((entry) => entry.isFile() && entry.name.endsWith('.md'))
}

function isInsideDirectory(target: string, directory: string) {
    const relative = path.relative(path.resolve(directory), path.resolve(target))
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

async function removeNovelWorkspaceAgent(ownerId: string, novelId: string) {
    const workspacePath = getNovelWorkspacePath(ownerId, novelId)
    const destination = path.join(workspacePath, AGENTS_FILE_NAME)
    const userAgentsRoot = getUserAgentsRoot(ownerId)

    await removeManagedSymlink({
        destination,
        managedSourceRoot: userAgentsRoot,
    })
}

function parseMaybeJson(raw: string | null | undefined) {
    if (!raw) return null
    try {
        return JSON.parse(raw) as unknown
    } catch {
        return null
    }
}

function toSnippetProjectionInput(snippet: {
    id: string
    title: string
    content: string
    pinned: boolean
    createdAt: Date
    updatedAt: Date
}): NovelWorkspaceSnippetInput {
    return {
        id: snippet.id,
        title: snippet.title,
        content: snippet.content,
        pinned: snippet.pinned,
        createdAt: snippet.createdAt.toISOString(),
        updatedAt: snippet.updatedAt.toISOString(),
    }
}
