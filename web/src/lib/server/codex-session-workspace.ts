import fs from 'fs/promises'
import path from 'path'

import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'
import { ensureNovelWorkspace, writeReadonlyProjectionFile } from '@/lib/server/novel-workspace'
import { ensureManagedFileSymlink } from '@/lib/server/managed-symlink'
import { getUserAgentsRoot, listAgents } from '@/lib/server/agent-storage'

const AGENTS_FILE_NAME = 'AGENTS.md'
const NOVEL_CONTEXT_DIR_NAME = 'novel'

export function getCodexSessionWorkspacesRoot() {
    return path.join(getOpenNovelWriterDataDir(), 'codex', 'sessions')
}

export function getCodexSessionWorkspacePath(ownerId: string, sessionId: string) {
    return path.join(getCodexSessionWorkspacesRoot(), ownerId, sessionId)
}

export async function ensureCodexSessionWorkspace(input: {
    ownerId: string
    novelId: string
    sessionId: string
}) {
    const sessionPath = getCodexSessionWorkspacePath(input.ownerId, input.sessionId)
    const novelContextPath = path.join(sessionPath, NOVEL_CONTEXT_DIR_NAME)
    const novelWorkspacePath = await ensureNovelWorkspace(input.ownerId, input.novelId)

    await fs.mkdir(path.join(sessionPath, 'artifacts', 'skill-imports'), { recursive: true })
    await fs.rm(novelContextPath, { recursive: true, force: true })
    await fs.mkdir(novelContextPath, { recursive: true })

    await Promise.all([
        linkNovelMarkdownContext(novelWorkspacePath, novelContextPath),
        writeSessionAgentsFile(sessionPath, input.ownerId),
    ])

    return sessionPath
}

export async function deleteCodexSessionWorkspace(ownerId: string, sessionId: string) {
    await fs.rm(getCodexSessionWorkspacePath(ownerId, sessionId), {
        recursive: true,
        force: true,
    })
}

async function linkNovelMarkdownContext(novelWorkspacePath: string, novelContextPath: string) {
    await syncMarkdownTree(novelWorkspacePath, novelContextPath, novelWorkspacePath)
}

async function syncMarkdownTree(sourceRoot: string, destinationRoot: string, managedSourceRoot: string) {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    })

    await Promise.all(entries.map(async (entry) => {
        if (entry.name === AGENTS_FILE_NAME) return

        const source = path.join(sourceRoot, entry.name)
        const destination = path.join(destinationRoot, entry.name)

        if (entry.isDirectory()) {
            await fs.mkdir(destination, { recursive: true })
            await syncMarkdownTree(source, destination, managedSourceRoot)
            return
        }

        if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith('.md')) return
        await ensureManagedFileSymlink({
            source,
            destination,
            managedSourceRoot,
        })
    }))
}

async function writeSessionAgentsFile(sessionPath: string, ownerId: string) {
    const userAgentContent = await readEnabledUserAgentContent(ownerId)
    const parts = [
        '# OpenNovelWriter Codex Session',
        '',
        'This workspace contains read-only novel context and writable artifacts.',
        '',
        '- `novel/` contains Markdown symlinks: `outline.md` is the story outline and chapter index; `chapters/<chapter_id>.md` contains chapter text; `story-state/` projects Moments, entities, and currently credible facts.',
        '- `novel/terms/<file>.md` uses term titles with numeric suffixes for duplicate titles. `novel/snippet.md` indexes author notes and reference fragments in `novel/snippets/<snippet_id>.md`.',
        '- `novel/materials/<material_id>.md` contains an imported reference document, potentially a whole novel. Open it only when the user explicitly references that material by id; otherwise do not list, search, or read `novel/materials/`.',
        '- For term, snippet, and material references, read the exact supplied file in full before responding. When passing referenced context to `run_llm`, include the relevant details in its conversation file.',
        '- Use `artifacts/` for tool inputs and generated outputs, such as external-model conversation files and images.',
        '- An image reference `[label](image:<manifest-path>#<optional-item-id>)` points to a manifest under `artifacts/`; read it and use the selected item file.',
        '- To save a `run_llm` reply, use `source: { mdPath, index }` where supported instead of retyping. `index` selects an assistant turn (default `-1`, latest); edit the artifact first if the reply needs changes.',
        '- A `[位置](continuation:chapterId:sceneId:panelId)` reference targets a continuation draft: use `set_continuation_draft` with that `panelId`, not `edit_scene_content`. Before revising, read `get_continuation_draft` to preserve author edits. The author decides when to insert the draft into the manuscript.',
        '- User skills invoked with `/skill-name` are injected into the turn as `$skill` instructions. Follow them even if absent from `skills/list`; do not search the local catalog for an injected user skill.',
        '- A skill may have one pre-assembled `artifacts/<prompt-name>-prompt.md` per associated prompt. Its `<!-- onw-skill-prompt ... -->` metadata lists `prompt`, `groups` (first is default), and `scene`. Fill every `<<<NEEDS INPUT: ...>>>` for that scene, or remove it if inapplicable. Follow the injected skill to decide whether to call `run_llm` and how to use the reply; when calling, use the file\'s absolute path and a listed group, defaulting to the first unless the skill specifies otherwise.',
    ]

    const normalizedUserAgent = userAgentContent.trim()
    if (normalizedUserAgent) {
        parts.push('', '## User Agent Instructions', '', normalizedUserAgent)
    }

    await writeReadonlyProjectionFile(path.join(sessionPath, AGENTS_FILE_NAME), `${parts.join('\n')}\n`)
}

async function readEnabledUserAgentContent(ownerId: string) {
    const enabledAgent = (await listAgents(ownerId)).find((agent) => agent.enabled)
    if (!enabledAgent) return ''

    return fs.readFile(path.join(getUserAgentsRoot(ownerId), enabledAgent.id, AGENTS_FILE_NAME), 'utf8').catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
    })
}
