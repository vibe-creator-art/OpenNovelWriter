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

    await fs.mkdir(path.join(sessionPath, 'artifacts'), { recursive: true })
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
        'This session directory is the writable workspace for this Codex run.',
        '',
        '- Read generated novel context from `novel/`; its Markdown files are read-only symlinks, including nested directories such as `novel/chapters/`, `novel/terms/`, and `novel/snippets/`.',
        '- `novel/outline.md` is the story outline and index, `novel/chapters/` contains one Markdown file per chapter keyed by chapter id, `novel/terms/` contains one Markdown file per term keyed by term title (disambiguated with a `-2`/`-3` suffix when titles collide), and `novel/snippet.md` indexes author snippets.',
        '- Snippets are author notes, setting fragments, and loose reference material; `novel/snippets/` contains one Markdown file per snippet keyed by snippet id because snippets may not have titles.',
        '- `novel/materials/` holds user-imported reference documents (资料), one Markdown file per document keyed by material id (`novel/materials/<id>.md`). These can be very large — up to a whole novel — so do NOT `ls`/read/grep through `novel/materials/` on your own; open a material file ONLY when a user message explicitly points you at it by id (see the material-reference note below).',
        '- To analyze plot or story continuity, read `novel/outline.md` first, then use the chapter ids listed there to open the corresponding files in `novel/chapters/`.',
        '- For detailed analysis, answer fully in chat first. If the user may want a durable note, ask whether to save it as a snippet; if they agree, follow the `edit-snippets` skill.',
        '- Chapter files are named by chapter id (`novel/chapters/<chapter_id>.md`). Find the chapter id in `novel/outline.md` and open the file directly — do not `ls`/`find`/grep through `novel/chapters/` to locate a chapter by name.',
        '- Write drafts, notes, and generated files to `artifacts/`.',
        '- To call an external LLM (model group), write a conversation Markdown file in `artifacts/` with `## system` / `## user` sections, call `run_llm` with its absolute path and the model group id (from a `[name](model:GROUP_ID)` mention), then show the reply to the user with the returned `suggestedLink` (e.g. `[模型回复](llm:notes.md)`) — do not retype the reply.',
        '- To commit a `run_llm` reply (e.g. to a scene summary, scene prose, scene continuation draft, chat and other fields), do NOT retype it: any MCP tool that accepts a `source: { mdPath, index }` reads the text straight from the artifact instead of a literal value (index counts `## assistant` turns, default -1 = latest). For example, `update_scene_summary` / `update_act_summary` (use `source` instead of `summary`), `edit_scene_content` hunks (use `source` instead of `new_text`), and `set_continuation_draft` (use `source` instead of `text`). If the reply needs tweaks, edit the .md file first, then reference it.',
        '- Term references: when a user message names a term as `<title> (term — read its full details in novel/terms/<file> before responding)`, open that exact file under `novel/terms/` and use its content (this is the author pointing you at a glossary entry — do not guess or search for it).',
        '- Snippet references: when a user message names a snippet as `<label> (snippet — read its full content in novel/snippets/<id>.md before responding)`, open that exact file under `novel/snippets/` and use its content. When relaying a term or snippet to an external LLM via `run_llm`, copy the relevant details into the conversation file so the model sees them too.',
        '- Material references: when a user message names a material as `<label> (material — read its full content in novel/materials/<id>.md before responding)`, open that exact file under `novel/materials/` and use its content. This @-mention is the only signal to open a material; without it, leave `novel/materials/` untouched.',
        '- Mutating novel data goes through MCP tools, never by editing `novel/` projections. Read the matching built-in skill first: `edit-manuscript` for novel/act/chapter titles and scene prose, `edit-summary` for scene and act/volume summaries, `edit-snippets` for creating/editing/deleting snippets, `edit-terms` for creating/editing/deleting terms (characters, locations, items, …, including their experiences timeline).',
        '- Scene-continuation panels: a request may carry a `[位置](continuation:chapterId:sceneId:panelId)` reference — an inline panel in the manuscript that grows downward to show a draft the author reviews. Deliver your continuation by calling `set_continuation_draft` with that `panelId` (do NOT touch the prose with `edit_scene_content`; the author writes the draft into the scene themselves). When revising across turns, read the current draft first with `get_continuation_draft` (the author may have hand-edited it).',
        '- Two kinds of skills exist here. Built-in skills (`edit-manuscript`, `edit-summary`, `edit-snippets`, `edit-terms`) appear in your skills catalog as usual — read their SKILL.md before mutating novel data. User skills are delivered by explicit injection instead: when the user `@`-mentions one it is attached to this turn as a `$skill` carrying its full SKILL.md instructions (and, for prompt-backed skills, a pre-assembled artifact). A mentioned user skill may NOT show up in your own `skills/list` catalog — that is expected and fine; act on the injected `$skill` instructions you were given, do not doubt it or try to locate the skill in your local skills list.',
        '- Skill-with-prompt runs: when the user invokes a skill (`$skill`) that has an associated prompt, OpenNovelWriter may have pre-assembled it into an `artifacts/<prompt-name>-prompt.md` file (one per associated prompt). It opens with an `<!-- onw-skill-prompt ... -->` metadata block listing the source `prompt`, the bound `groups` (the first is marked `(default)`), and the `scene` id. To use it: replace every `<<<NEEDS INPUT: ...>>>` placeholder with the right value for the referenced scene (or delete it if not applicable), then call `run_llm` with that file\'s absolute path and one of the listed group ids (use the default unless the skill says otherwise). What to do with the model reply — and whether to call run_llm at all — is defined by the skill\'s own content (the `$skill` instructions you already have), not by this file; follow those instructions.',
        '- Do not edit files inside `novel/`; they are symlinks to OpenNovelWriter-managed novel context.',
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
