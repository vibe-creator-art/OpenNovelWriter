#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('crypto')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

const { PrismaClient } = require('@prisma/client')
const {
    buildNovelWorkspaceOutlineMarkdown,
    buildNovelWorkspaceChapterMarkdown,
    buildNovelWorkspaceSnippetIndexMarkdown,
    buildNovelWorkspaceSnippetMarkdown,
    buildNovelWorkspaceDetailedOutlineMarkdown,
    htmlToProjectionText,
} = require('../src/lib/server/novel-workspace-projection.cjs')
const {
    DEFAULT_TERM_CATEGORY_IDS,
    normalizeTermTitleKey,
    getTermStateEntries,
    getCustomCategories,
    getEnabledPresetCategoryIds,
    buildTermProjectionSnapshots,
} = require('../src/lib/server/novel-workspace-terms.cjs')
const { applyHunk, diffRegions } = require('../src/lib/server/manuscript-edit.cjs')
const { parseLlmConversation, buildLlmRequestPayload, getAssistantBlock } = require('../src/lib/server/llm-conversation.cjs')

const prisma = new PrismaClient()
const ownerId = process.env.OPENNOVELWRITER_OWNER_ID
const internalBaseUrl = (process.env.OPENNOVELWRITER_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const internalToken = process.env.OPENNOVELWRITER_INTERNAL_TOKEN || ''
const RUN_LLM_TIMEOUT_MS = 175_000

// A reference to an assistant reply inside a run_llm conversation artifact, used so
// the model output goes straight from the .md into a scene without Codex retyping it.
const LLM_REPLY_SOURCE_SCHEMA = {
    type: 'object',
    description: 'Pull this text from a `run_llm` conversation artifact instead of typing it. Use this to commit a model reply without retyping it. If the reply needs tweaks, edit the .md first, then reference it here.',
    properties: {
        mdPath: { type: 'string', description: 'Absolute path to the .md conversation file under this Codex session artifacts directory (the same file you passed to run_llm).' },
        index: { type: 'integer', description: 'Which `## assistant` reply to take, counting only assistant turns. Negative counts from the end. Defaults to -1 (the latest reply).' },
    },
    required: ['mdPath'],
    additionalProperties: false,
}

const tools = [
    {
        name: 'update_novel_title',
        description: 'Update the title of an OpenNovelWriter novel.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                title: { type: 'string', description: 'The new novel title.' },
            },
            required: ['novelId', 'title'],
            additionalProperties: false,
        },
    },
    {
        name: 'update_act_title',
        description: 'Update the title of an act/volume in an OpenNovelWriter novel.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                actNumber: { type: 'number', description: 'The act/volume number shown in outline.md.' },
                title: { type: 'string', description: 'The new act/volume title.' },
            },
            required: ['novelId', 'actNumber', 'title'],
            additionalProperties: false,
        },
    },
    {
        name: 'update_chapter_title',
        description: 'Update the title of a chapter in an OpenNovelWriter novel.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                chapterId: { type: 'string', description: 'The chapter id from outline.md.' },
                title: { type: 'string', description: 'The new chapter title.' },
            },
            required: ['novelId', 'chapterId', 'title'],
            additionalProperties: false,
        },
    },
    {
        name: 'update_scene_summary',
        description: 'Update the summary of a scene in an OpenNovelWriter novel. Provide exactly one of `summary` (a literal string) or `source` (a reference to a run_llm reply, which is read server-side so you do not retype it).',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                sceneId: { type: 'string', description: 'The scene id from outline.md.' },
                summary: { type: 'string', description: 'The new scene summary as a literal string. Use an empty string to clear it. Omit this when using `source`.' },
                source: LLM_REPLY_SOURCE_SCHEMA,
            },
            required: ['novelId', 'sceneId'],
            additionalProperties: false,
        },
    },
    {
        name: 'update_act_summary',
        description: 'Update the summary of an act/volume in an OpenNovelWriter novel. The summary stands in for the whole volume in memory recall. Provide exactly one of `summary` (a literal string) or `source` (a reference to a run_llm reply, which is read server-side so you do not retype it).',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                actNumber: { type: 'number', description: 'The act/volume number shown in outline.md.' },
                summary: { type: 'string', description: 'The new act/volume summary as a literal string. Use an empty string to clear it. Omit this when using `source`.' },
                source: LLM_REPLY_SOURCE_SCHEMA,
            },
            required: ['novelId', 'actNumber'],
            additionalProperties: false,
        },
    },
    {
        name: 'edit_scene_content',
        description: 'Edit the prose body of a scene with one or more search/replace hunks. Each hunk replaces an exact run of existing scene text (old_text) with new_text. Edits apply immediately but stay pending until the author accepts or rejects them in the app. Use this only for the scene Content/正文 (not summaries or titles). Read the scene from novel/chapters/<chapter_id>.md first and copy old_text exactly. Keep each hunk small and locally unique; split unrelated changes into separate hunks so the author can review them one by one. To insert a long model-written passage (e.g. a scene continuation), use an empty old_text plus `source` so the prose comes straight from the run_llm artifact instead of being retyped; blank-line-separated paragraphs in the reply become separate paragraphs in the scene.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                sceneId: { type: 'string', description: 'The scene id from the chapter projection (<!-- scene_id: ... -->).' },
                edits: {
                    type: 'array',
                    minItems: 1,
                    description: 'Search/replace hunks applied in order. Each must target the scene Content. Each hunk provides exactly one of `new_text` or `source`.',
                    items: {
                        type: 'object',
                        properties: {
                            old_text: { type: 'string', description: 'Exact existing scene text to replace. Must be unique within the scene; add surrounding context if needed. Use an empty string to append the replacement to the end of the scene — this is also how you write into an empty scene.' },
                            new_text: { type: 'string', description: 'Replacement text as a literal string. Use an empty string to delete the matched text. Separate paragraphs with a blank line. Omit this when using `source`.' },
                            source: LLM_REPLY_SOURCE_SCHEMA,
                        },
                        required: ['old_text'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['novelId', 'sceneId', 'edits'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_act',
        description:
            'Insert a new empty act/volume into an OpenNovelWriter novel and return its act number. Acts are identified by their 1-based number (the `<!-- act_number: N -->` shown in outline.md), not a string id. Pass `afterActNumber` to insert the new act right after that act — every act from there on (its acts, their chapters, and any act outlines/卷纲) shifts up by one. Omit `afterActNumber` to insert at the very front: the new act becomes act 1 and all existing acts shift up; this is also the call to use when the novel has no acts yet (it simply becomes act 1). The new act starts with no chapters. Optionally set `title`/`summary` here, or leave them and use update_act_title / update_act_summary later.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                afterActNumber: { type: 'integer', description: 'Insert the new act right after this existing 1-based act number. Omit to insert before the current first act (new act becomes act 1), or when the novel has no acts yet.' },
                title: { type: 'string', description: 'Optional title for the new act. Omit to leave it untitled.' },
                summary: { type: 'string', description: 'Optional summary for the new act.' },
            },
            required: ['novelId'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_chapter',
        description:
            'Insert a new chapter into a given act of an OpenNovelWriter novel and return its chapter id. Pass `actNumber` (the 1-based act the chapter belongs to; the act must already exist — create it with create_act first) and optionally `afterChapterId` (a `<!-- chapter_id: ... -->` from outline.md) to insert the new chapter right after that chapter; the chapters after it in the act shift down by one. Omit `afterChapterId` to insert at the front of the act, which is also the call to use when the act has no chapters yet. The new chapter is created with a single empty scene (every chapter keeps at least one scene). Optionally set `title`; when omitted it gets the positional default title ("章 N" / "Chapter N", matching manual chapter creation), and the placeholder titles of the chapters it pushed down are renumbered to stay in order. Returns the new chapterId (and the default sceneId).',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                actNumber: { type: 'integer', description: 'The 1-based act number the new chapter belongs to. The act must already exist (has an act row or chapters).' },
                afterChapterId: { type: 'string', description: 'Insert right after this chapter id (it must belong to actNumber). Omit to insert at the front of the act / when the act has no chapters yet.' },
                title: { type: 'string', description: 'Optional title for the new chapter. Omit to create it untitled.' },
            },
            required: ['novelId', 'actNumber'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_scene',
        description:
            'Insert a new empty scene into a chapter of an OpenNovelWriter novel and return its scene id. Pass `chapterId` (a `<!-- chapter_id: ... -->` from outline.md) and optionally `afterSceneId` (a `<!-- scene_id: ... -->`) to insert the new scene right after that scene; later scenes in the chapter shift down by one. Omit `afterSceneId` to insert at the front of the chapter. The new scene starts empty — write its prose with edit_scene_content afterwards. Returns the new sceneId.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                chapterId: { type: 'string', description: 'The chapter id the new scene belongs to (from a `<!-- chapter_id: ... -->` comment).' },
                afterSceneId: { type: 'string', description: 'Insert right after this scene id (it must belong to chapterId). Omit to insert at the front of the chapter.' },
            },
            required: ['novelId', 'chapterId'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_act',
        description:
            'Delete an empty act/volume (no chapters) from an OpenNovelWriter novel, by its 1-based `actNumber`. Fails if the act still has any chapter — move or delete those chapters first. On success the act metadata and its act outline (卷纲) are removed and every later act renumbers down by one so the numbering stays contiguous. This is destructive and cannot be undone: it runs automatically only under the 无需审核 / no-review level; under 用户确认 and 自动审核 it raises a confirmation the author must approve before anything is deleted (if the author declines, nothing is deleted). Call it only when the author clearly asked to delete that act.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                actNumber: { type: 'integer', description: 'The 1-based act number to delete. The act must have no chapters.' },
            },
            required: ['novelId', 'actNumber'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_chapter',
        description:
            'Delete an empty chapter from an OpenNovelWriter novel, by its `chapterId`. "Empty" means every scene in it has blank prose (no Content); it also fails if the chapter still hosts an inline scene-continuation panel (finish or discard it first). Fails if any scene has text. On success the chapter, its scenes and its chapter outline (章纲) are all removed. This is destructive and cannot be undone: it runs automatically only under the 无需审核 / no-review level; under 用户确认 and 自动审核 it raises a confirmation the author must approve before anything is deleted (if the author declines, nothing is deleted). Call it only when the author clearly asked to delete that chapter.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                chapterId: { type: 'string', description: 'The chapter id to delete (from a `<!-- chapter_id: ... -->` comment). The chapter must be empty.' },
            },
            required: ['novelId', 'chapterId'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_scene',
        description:
            'Delete an empty scene from an OpenNovelWriter novel, by its `sceneId`. "Empty" means the scene has blank prose (no Content); it also fails if the scene still hosts an inline scene-continuation panel (finish or discard it first). Fails if the scene has text, and fails if it is the only scene left in its chapter (a chapter always keeps at least one scene — delete the chapter instead). On success the remaining scenes in the chapter are re-ordered. This is destructive and cannot be undone: it runs automatically only under the 无需审核 / no-review level; under 用户确认 and 自动审核 it raises a confirmation the author must approve before anything is deleted (if the author declines, nothing is deleted). Call it only when the author clearly asked to delete that scene.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                sceneId: { type: 'string', description: 'The scene id to delete (from a `<!-- scene_id: ... -->` comment). The scene must be empty and not the last scene in its chapter.' },
            },
            required: ['novelId', 'sceneId'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_snippet',
        description: 'Create a new OpenNovelWriter snippet by importing a Markdown file from the current Codex session artifacts directory.',
        inputSchema: {
            type: 'object',
            properties: {
                mdPath: {
                    type: 'string',
                    description: 'Absolute path to a .md file under this Codex session artifacts directory.',
                },
                pinned: {
                    type: 'boolean',
                    description: 'Whether to pin the created snippet. Defaults to false.',
                },
            },
            required: ['mdPath'],
            additionalProperties: false,
        },
    },
    {
        name: 'edit_snippet',
        description: 'Edit an existing OpenNovelWriter snippet: update its title, pinned state, and/or content. Find the snippet id from its projection file novel/snippets/<id>.md (or a `(snippet — ... novel/snippets/<id>.md ...)` reference in the request). To change the content provide exactly one of `content` (a literal Markdown string — best for short edits) or `mdPath` (absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the new content — copy the snippet projection into artifacts/, edit the Markdown there, then point `mdPath` at it for long rewrites). At least one of title, pinned, content, or mdPath must be given. Content is stored after Markdown→HTML conversion, same as create_snippet.',
        inputSchema: {
            type: 'object',
            properties: {
                snippetId: { type: 'string', description: 'The snippet id (from novel/snippets/<id>.md).' },
                title: { type: 'string', description: 'New snippet title. Omit to leave unchanged; pass an empty string to clear it.' },
                pinned: { type: 'boolean', description: 'New pinned state. Omit to leave unchanged.' },
                content: { type: 'string', description: 'New snippet content as a literal Markdown string. Omit when using mdPath.' },
                mdPath: { type: 'string', description: 'Absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the new content. Omit when using content.' },
            },
            required: ['snippetId'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_snippet',
        description: 'Permanently delete an OpenNovelWriter snippet. Find the snippet id from its projection file novel/snippets/<id>.md. This is destructive and cannot be undone: it runs automatically only under the 无需审核 / no-review level; under 用户确认 and 自动审核 it raises a confirmation the author must approve before the snippet is removed (if the author declines, nothing is deleted).',
        inputSchema: {
            type: 'object',
            properties: {
                snippetId: { type: 'string', description: 'The snippet id (from novel/snippets/<id>.md).' },
            },
            required: ['snippetId'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_outline',
        description:
            'Create the detailed outline (细纲) for ONE chapter or act that does not have one yet. A 细纲 is bound to an existing chapter (by chapterId) or act (by actNumber) — it is never free-standing; "create" fails if that chapter/act already has a 细纲 (use edit_outline instead). Pass exactly one of `chapterId` (from a `<!-- chapter_id: ... -->` comment in outline.md / chapter files) or `actNumber` (the 1-based act/volume number from outline.md). Provide the body via exactly one of `content` (a literal Markdown string — best for short outlines) or `mdPath` (absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the outline). Content is stored after Markdown→HTML conversion. On success the projection appears at novel/DetailedOutline/chapters/<chapterId>.md or novel/DetailedOutline/acts/<actNumber>.md.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                chapterId: { type: 'string', description: 'Target chapter id (from a `<!-- chapter_id: ... -->` comment). Provide this for a chapter outline (章纲); omit when using actNumber.' },
                actNumber: { type: 'integer', description: 'Target act/volume number (1-based, from outline.md). Provide this for an act outline (卷纲); omit when using chapterId.' },
                content: { type: 'string', description: 'Outline body as a literal Markdown string. Omit when using mdPath.' },
                mdPath: { type: 'string', description: 'Absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the outline. Omit when using content.' },
            },
            required: ['novelId'],
            additionalProperties: false,
        },
    },
    {
        name: 'edit_outline',
        description:
            'Replace the detailed outline (细纲) of ONE chapter or act that already has one. Locate the target by `chapterId` (章纲) or `actNumber` (卷纲) — the same identifier shown in the projection metadata at novel/DetailedOutline/chapters/<chapterId>.md or novel/DetailedOutline/acts/<actNumber>.md; the 细纲 does not have its own id. Provide exactly one of `chapterId` or `actNumber`, and exactly one of `content` (literal Markdown) or `mdPath` (absolute path to a .md file under this session artifacts directory — copy the projection into artifacts/, edit the Markdown there, then point `mdPath` at it for long rewrites). Errors if that chapter/act has no 细纲 yet (use create_outline first). Content is stored after Markdown→HTML conversion.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from the projection metadata.' },
                chapterId: { type: 'string', description: 'Target chapter id for a chapter outline (章纲). Omit when using actNumber.' },
                actNumber: { type: 'integer', description: 'Target act/volume number for an act outline (卷纲). Omit when using chapterId.' },
                content: { type: 'string', description: 'New outline body as a literal Markdown string. Omit when using mdPath.' },
                mdPath: { type: 'string', description: 'Absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the new outline. Omit when using content.' },
            },
            required: ['novelId'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_outline',
        description:
            'Permanently delete the detailed outline (细纲) of ONE chapter or act. Locate the target by `chapterId` (章纲) or `actNumber` (卷纲) from the projection metadata. This is destructive and cannot be undone: it runs automatically only under the 无需审核 / no-review level; under 用户确认 and 自动审核 it raises a confirmation the author must approve before the outline is removed (if the author declines, nothing is deleted). Call it only when the author clearly asked to delete that chapter/act outline.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from the projection metadata.' },
                chapterId: { type: 'string', description: 'Target chapter id for a chapter outline (章纲). Omit when using actNumber.' },
                actNumber: { type: 'integer', description: 'Target act/volume number for an act outline (卷纲). Omit when using chapterId.' },
            },
            required: ['novelId'],
            additionalProperties: false,
        },
    },
    {
        name: 'create_term',
        description:
            'Create a new OpenNovelWriter term (a glossary entry: character, location, item, lore, etc.). Use it when the author asks you to invent or record a new NPC, place, item, skill, or other setting entry. `title` must not duplicate an existing active term. `categoryId` must be one of the novel\'s available category ids: characters / locations / items / lore always work; preset ids (preset_skills / preset_talents / preset_realms) and custom category ids only if the novel already uses them — read the `category_id` metadata of an existing term file in that category to find the id. `description` is Markdown; for a long description write it to a file under this session\'s artifacts/ first and pass `descriptionMdPath` instead. `experiences` is the term\'s chronological timeline: one short plain-text line per event, in story order.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from outline.md.' },
                title: { type: 'string', description: 'The term title. Must be unique among the novel\'s active terms.' },
                categoryId: { type: 'string', description: 'Category id. Defaults to "characters".' },
                subtitle: { type: 'string', description: 'Optional one-line note shown under the title.' },
                aliases: { type: 'string', description: 'Optional comma-separated aliases/nicknames; they are recognized in the manuscript.' },
                description: { type: 'string', description: 'Term description as literal Markdown. Omit when using descriptionMdPath.' },
                descriptionMdPath: { type: 'string', description: 'Absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the description. Omit when using description.' },
                experiences: { type: 'array', items: { type: 'string' }, description: 'Chronological experiences, one short line per event (no newlines inside an item).' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
                color: { type: 'string', enum: ['black', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'], description: 'Optional accent color. "black" means no accent.' },
            },
            required: ['novelId', 'title'],
            additionalProperties: false,
        },
    },
    {
        name: 'edit_term',
        description:
            'Edit an existing OpenNovelWriter term. Find `termId` in the `<!-- term_id: ... -->` comment of its projection file novel/terms/<title>.md (and `novelId` in `<!-- novel_id: ... -->`). Patch semantics: omitted fields stay unchanged; pass an empty string (or empty array) to clear a field. For the experiences timeline, `appendExperiences` adds new events at the end (the common case as the story progresses) while `experiences` replaces the whole list (use it to rewrite or reorder; read the current list from the projection first) — provide at most one of the two. For a long description rewrite, copy the current description into an artifacts/*.md file, edit it there, then pass `descriptionMdPath`.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from the term projection metadata.' },
                termId: { type: 'string', description: 'The term id from the `<!-- term_id: ... -->` comment in novel/terms/<title>.md.' },
                title: { type: 'string', description: 'New title. Must stay unique among active terms.' },
                categoryId: { type: 'string', description: 'New category id (same rules as create_term).' },
                subtitle: { type: 'string', description: 'New subtitle. Empty string clears it.' },
                aliases: { type: 'string', description: 'New comma-separated aliases. Empty string clears them.' },
                description: { type: 'string', description: 'New description as literal Markdown. Empty string clears it. Omit when using descriptionMdPath.' },
                descriptionMdPath: { type: 'string', description: 'Absolute path to a .md file under this Codex session artifacts directory whose whole body becomes the new description.' },
                experiences: { type: 'array', items: { type: 'string' }, description: 'Replace the whole experiences timeline (one line per event, in story order). Empty array clears it.' },
                appendExperiences: { type: 'array', items: { type: 'string' }, description: 'Append these events to the end of the existing timeline.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Replace the tags. Empty array clears them.' },
                color: { type: 'string', enum: ['black', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'], description: 'New accent color. "black" clears the accent.' },
            },
            required: ['novelId', 'termId'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_term',
        description:
            'Permanently delete an OpenNovelWriter term. Find `termId` in the `<!-- term_id: ... -->` comment of novel/terms/<title>.md. This is destructive and cannot be undone: it runs automatically only under the 无需审核 / no-review level; under 用户确认 and 自动审核 it raises a confirmation the author must approve before the term is removed (if the author declines, nothing is deleted). Call it only when the author clearly asked to delete that term.',
        inputSchema: {
            type: 'object',
            properties: {
                novelId: { type: 'string', description: 'The novel id from the term projection metadata.' },
                termId: { type: 'string', description: 'The term id from the `<!-- term_id: ... -->` comment in novel/terms/<title>.md.' },
            },
            required: ['novelId', 'termId'],
            additionalProperties: false,
        },
    },
    {
        name: 'run_llm',
        description:
            'Run an external LLM (model group) on a conversation Markdown file in the current Codex session artifacts directory, and append the model reply back into that file. First write a `.md` file under artifacts/ with `## system`, `## user` (and optionally prior `## assistant`) sections, then call this tool with its absolute path and the target model group id. The tool sends the conversation to the model group and appends a new `## assistant` section with the reply. After it returns, surface the reply to the user with the returned `suggestedLink` (an inline link `[模型回复](<ref>)`, where `ref` already starts with `llm:`), which the front-end renders as the model output — do NOT retype the reply yourself. The model group id comes from the user picking a model in the composer (rendered as `[名称](model:GROUP_ID)`).',
        inputSchema: {
            type: 'object',
            properties: {
                mdPath: {
                    type: 'string',
                    description: 'Absolute path to a .md conversation file under this Codex session artifacts directory.',
                },
                groupId: {
                    type: 'string',
                    description: 'The OpenNovelWriter model group id to run (the GROUP_ID from a `[名称](model:GROUP_ID)` mention).',
                },
                temperature: {
                    type: 'number',
                    description: 'Optional sampling temperature. Omit to use the model/group default.',
                },
                maxTokens: {
                    type: 'number',
                    description: 'Optional max output tokens. Omit to use the model/group default.',
                },
            },
            required: ['mdPath', 'groupId'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_continuation_draft',
        description:
            'Read the current editable text held by an inline scene-continuation panel (identified by its panelId). This is the shared draft the author sees in the panel and may have hand-edited; read it before revising so you build on the latest version. Returns the draft `content` (and any `planning`). Does NOT touch the manuscript — the author decides when to write the draft into the prose.',
        inputSchema: {
            type: 'object',
            properties: {
                panelId: { type: 'string', description: 'The continuation panel id (from the `[位置](continuation:chapterId:sceneId:panelId)` reference in the request).' },
            },
            required: ['panelId'],
            additionalProperties: false,
        },
    },
    {
        name: 'set_continuation_draft',
        description:
            'Write the editable text of a scene-continuation panel (identified by its panelId). The panel grows downward to show this text; the author then chooses to write it into the prose, retry, or discard — this tool does NOT modify the manuscript. Provide exactly one of `text` (a literal string) or `source` (a reference to a run_llm reply, read server-side so you do not retype it) — prefer `source` to forward a reply verbatim. If the text wraps prose in `<Content>...</Content>` (optionally with a leading `<Planning>...</Planning>`), the panel splits them: only Content is written to the manuscript, Planning is shown collapsed. Untagged text is treated as plain prose. Use real newlines for paragraph breaks (a blank line between paragraphs), not literal "\\n".',
        inputSchema: {
            type: 'object',
            properties: {
                panelId: { type: 'string', description: 'The continuation panel id (from the `[位置](continuation:chapterId:sceneId:panelId)` reference in the request).' },
                text: { type: 'string', description: 'The continuation text as a literal string. Separate paragraphs with a blank line. Omit this when using `source`.' },
                source: LLM_REPLY_SOURCE_SCHEMA,
                planning: { type: 'string', description: 'Optional planning/notes shown above the draft. Omit to leave unchanged.' },
            },
            required: ['panelId'],
            additionalProperties: false,
        },
    },
]

let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        handleRawMessage(trimmed)
    }
})

process.stdin.on('end', async () => {
    await prisma.$disconnect().catch(() => {})
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function shutdown() {
    prisma.$disconnect().finally(() => process.exit(0))
}

function handleRawMessage(line) {
    let message
    try {
        message = JSON.parse(line)
    } catch (error) {
        sendError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error))
        return
    }

    if (Array.isArray(message)) {
        for (const item of message) handleMessage(item)
        return
    }

    handleMessage(message)
}

function handleMessage(message) {
    if (!message || typeof message !== 'object') return

    // A response to a request WE sent (e.g. an elicitation/create confirmation): carries an id and
    // a result/error but no method. Correlate it back to the awaiting promise.
    if (typeof message.method !== 'string' && Object.prototype.hasOwnProperty.call(message, 'id')) {
        const pending = pendingServerRequests.get(message.id)
        if (!pending) return
        pendingServerRequests.delete(message.id)
        clearTimeout(pending.timeout)
        if (message.error) {
            pending.reject(new Error(message.error.message || 'Request failed.'))
        } else {
            pending.resolve(message.result)
        }
        return
    }

    if (!Object.prototype.hasOwnProperty.call(message, 'id')) return

    handleRequest(message)
        .then((result) => sendResult(message.id, result))
        .catch((error) => {
            const messageText = error instanceof Error ? error.message : String(error)
            sendError(message.id, -32000, messageText)
        })
}

const ELICITATION_TIMEOUT_MS = 10 * 60 * 1000
const pendingServerRequests = new Map()
let nextServerRequestId = 1

// Send a JSON-RPC request from the MCP server to the client (Codex) and await its response.
// String ids (`onw:<n>`) keep our ids from colliding with Codex's own request ids.
function sendServerRequest(method, params) {
    const id = `onw:${nextServerRequestId++}`
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingServerRequests.delete(id)
            reject(new Error(`Timed out waiting for ${method} response.`))
        }, ELICITATION_TIMEOUT_MS)
        pendingServerRequests.set(id, { resolve, reject, timeout })
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
}

async function handleRequest(request) {
    switch (request.method) {
        case 'initialize':
            return {
                protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: {
                    name: 'opennovelwriter',
                    version: '0.1.0',
                },
                instructions: 'Use these tools to update OpenNovelWriter novel metadata, summaries, snippets, and terms. Do not edit generated projection files directly.',
            }
        case 'ping':
            return {}
        case 'tools/list':
            return { tools }
        case 'tools/call':
            return callTool(request.params)
        case 'resources/list':
            return { resources: [] }
        case 'prompts/list':
            return { prompts: [] }
        default:
            throw new Error(`Unsupported MCP method: ${request.method}`)
    }
}

async function callTool(params) {
    try {
        const name = requireString(params?.name, 'name')
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}

        if (!ownerId) throw new Error('OPENNOVELWRITER_OWNER_ID is not configured.')

        switch (name) {
            case 'update_novel_title':
                return toolResult(await updateNovelTitle(args))
            case 'update_act_title':
                return toolResult(await updateActTitle(args))
            case 'update_chapter_title':
                return toolResult(await updateChapterTitle(args))
            case 'update_scene_summary':
                return toolResult(await updateSceneSummary(args))
            case 'update_act_summary':
                return toolResult(await updateActSummary(args))
            case 'edit_scene_content':
                return toolResult(await editSceneContent(args))
            case 'create_act':
                return toolResult(await createAct(args))
            case 'create_chapter':
                return toolResult(await createChapter(args))
            case 'create_scene':
                return toolResult(await createScene(args))
            case 'delete_act':
                return toolResult(await deleteAct(args))
            case 'delete_chapter':
                return toolResult(await deleteChapter(args))
            case 'delete_scene':
                return toolResult(await deleteScene(args))
            case 'create_snippet':
                return toolResult(await createSnippet(args))
            case 'edit_snippet':
                return toolResult(await editSnippet(args))
            case 'delete_snippet':
                return toolResult(await deleteSnippet(args))
            case 'create_outline':
                return toolResult(await createOutline(args))
            case 'edit_outline':
                return toolResult(await editOutline(args))
            case 'delete_outline':
                return toolResult(await deleteOutline(args))
            case 'create_term':
                return toolResult(await createTerm(args))
            case 'edit_term':
                return toolResult(await editTerm(args))
            case 'delete_term':
                return toolResult(await deleteTerm(args))
            case 'run_llm':
                return toolResult(await runLlm(args))
            case 'get_continuation_draft':
                return toolResult(await getContinuationDraft(args))
            case 'set_continuation_draft':
                return toolResult(await setContinuationDraft(args))
            default:
                throw new Error(`Unknown tool: ${name}`)
        }
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        }
    }
}

async function updateNovelTitle(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const title = requireNonEmptyString(args.title, 'title')
    await requireOwnedNovel(novelId)

    const novel = await prisma.novel.update({
        where: { id: novelId },
        data: { title },
        select: { id: true, title: true },
    })
    await syncNovelWorkspaceOutline(novelId)
    return { ok: true, novel }
}

async function updateActTitle(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const actNumber = requirePositiveInteger(args.actNumber, 'actNumber')
    const title = requireNonEmptyString(args.title, 'title')
    await requireOwnedNovel(novelId)

    const act = await prisma.act.findUnique({
        where: { novelId_number: { novelId, number: actNumber } },
        select: { id: true },
    })
    if (!act) throw new Error(`Act ${actNumber} was not found in novel ${novelId}.`)

    const updated = await prisma.act.update({
        where: { id: act.id },
        data: { title },
        select: { id: true, number: true, title: true },
    })
    await syncNovelWorkspaceOutline(novelId)
    return { ok: true, act: updated }
}

async function updateChapterTitle(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const chapterId = requireString(args.chapterId, 'chapterId')
    const title = requireNonEmptyString(args.title, 'title')
    await requireOwnedNovel(novelId)

    const chapter = await prisma.chapter.findFirst({
        where: { id: chapterId, novelId },
        select: { id: true },
    })
    if (!chapter) throw new Error(`Chapter ${chapterId} was not found in novel ${novelId}.`)

    const updated = await prisma.chapter.update({
        where: { id: chapterId },
        data: { title },
        select: { id: true, title: true },
    })
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceChapter(novelId, chapterId),
    ])
    return { ok: true, chapter: updated }
}

async function updateSceneSummary(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const sceneId = requireString(args.sceneId, 'sceneId')
    const summary = (await resolveTextOrSource(args, 'summary')).trim()
    await requireOwnedNovel(novelId)

    const scene = await prisma.scene.findFirst({
        where: {
            id: sceneId,
            chapter: { novelId },
        },
        select: { id: true, chapterId: true },
    })
    if (!scene) throw new Error(`Scene ${sceneId} was not found in novel ${novelId}.`)

    const updated = await prisma.scene.update({
        where: { id: sceneId },
        data: { summary: summary || null },
        select: { id: true, summary: true },
    })
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceChapter(novelId, scene.chapterId),
    ])
    return { ok: true, scene: updated }
}

async function updateActSummary(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const actNumber = requirePositiveInteger(args.actNumber, 'actNumber')
    const summary = (await resolveTextOrSource(args, 'summary')).trim()
    await requireOwnedNovel(novelId)

    const act = await prisma.act.findUnique({
        where: { novelId_number: { novelId, number: actNumber } },
        select: { id: true },
    })
    if (!act) throw new Error(`Act ${actNumber} was not found in novel ${novelId}.`)

    const updated = await prisma.act.update({
        where: { id: act.id },
        data: { summary: summary || null },
        select: { id: true, number: true, summary: true },
    })
    await syncNovelWorkspaceOutline(novelId)
    return { ok: true, act: updated }
}

async function editSceneContent(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const sceneId = requireString(args.sceneId, 'sceneId')
    if (!Array.isArray(args.edits) || args.edits.length === 0) {
        throw new Error('edits must be a non-empty array of { old_text, new_text }.')
    }
    await requireOwnedNovel(novelId)

    const scene = await prisma.scene.findFirst({
        where: { id: sceneId, chapter: { novelId } },
        select: { id: true, content: true, chapterId: true, chapter: { select: { actNumber: true } } },
    })
    if (!scene) throw new Error(`Scene ${sceneId} was not found in novel ${novelId}.`)

    const actNumber = scene.chapter?.actNumber ?? 1
    const originalHtml = scene.content || ''
    let currentHtml = originalHtml
    const failed = []

    // Apply every hunk to the live content first.
    for (let index = 0; index < args.edits.length; index += 1) {
        const edit = args.edits[index]
        const oldText = requireString(edit?.old_text, `edits[${index}].old_text`)
        const hasSource = edit?.source !== undefined && edit?.source !== null
        const hasLiteral = edit?.new_text !== undefined && edit?.new_text !== null
        if (hasSource && hasLiteral) {
            throw new Error(`edits[${index}]: provide either new_text or source, not both.`)
        }
        if (!hasSource && !hasLiteral) {
            throw new Error(`edits[${index}]: either new_text or source is required.`)
        }
        const newText = hasSource
            ? await resolveLlmReplySource(edit.source, `edits[${index}].source`)
            : requireString(edit.new_text, `edits[${index}].new_text`)

        const result = applyHunk(currentHtml, oldText, newText)
        if (!result.ok) {
            failed.push({ index, error: result.error })
            continue
        }
        currentHtml = result.newHtml
    }

    // Coalesce the net change into reviewable regions: adjacent paragraph changes merge
    // into one card, changes separated by an untouched paragraph stay separate.
    const regions = currentHtml === originalHtml ? [] : diffRegions(originalHtml, currentHtml)

    if (regions.length === 0) {
        throw new Error(`No edits could be applied. ${failed.map((item) => `#${item.index}: ${item.error}`).join(' ')}`)
    }

    await prisma.scene.update({
        where: { id: sceneId },
        data: { content: currentHtml, wordCount: calculateWordCountFromHtml(currentHtml) },
    })
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceChapter(novelId, scene.chapterId),
    ])

    const applied = []
    for (const region of regions) {
        const record = await prisma.sceneEdit.create({
            data: {
                novelId,
                sceneId,
                chapterId: scene.chapterId,
                actNumber,
                beforeHtml: region.beforeHtml,
                afterHtml: region.afterHtml,
                beforeText: region.beforeText,
                afterText: region.afterText,
                anchorHash: region.anchorHash,
                afterAnchorHtml: region.afterAnchorHtml,
                status: 'pending',
            },
            select: { id: true, sceneId: true, chapterId: true, actNumber: true, beforeText: true, afterText: true },
        })
        applied.push(record)
    }

    return {
        ok: true,
        sceneId,
        chapterId: scene.chapterId,
        actNumber,
        appliedCount: applied.length,
        failedCount: failed.length,
        applied,
        failed,
    }
}

// --- Manuscript structure (act / chapter / scene) create & delete -------------------------------
// Acts are keyed by their 1-based number (Act.number, unique per novel) which is also what the
// outline projection exposes as `<!-- act_number -->`; chapters and scenes are keyed by cuid.
// Chapter.order is per-act ordering and Scene.order is per-chapter ordering — neither is unique,
// so a new row opens a slot by incrementing the orders after it.

// An act "exists" when it has an Act metadata row, any chapter, or an act outline at that number —
// the same union the outline projection is built from.
async function actExistsInNovel(novelId, actNumber) {
    const [actRow, chapter, outline] = await Promise.all([
        prisma.act.findUnique({ where: { novelId_number: { novelId, number: actNumber } }, select: { id: true } }),
        prisma.chapter.findFirst({ where: { novelId, actNumber }, select: { id: true } }),
        prisma.outline.findUnique({ where: { novelId_type_actNumber: { novelId, type: 'ACT', actNumber } }, select: { id: true } }),
    ])
    return Boolean(actRow || chapter || outline)
}

// Shift every act at or above `fromNumber` by `delta` (+1 to open a slot for an insert, -1 to close
// the gap after a delete). Act.number and Outline(ACT).actNumber are unique per novel, so they move
// through a temporary offset in two phases to avoid colliding mid-update (the same trick the act
// outline remap route uses); chapters have no such constraint and shift in a single pass.
async function shiftActsFrom(novelId, fromNumber, delta) {
    if (delta === 0) return
    const [acts, actOutlines] = await Promise.all([
        prisma.act.findMany({ where: { novelId, number: { gte: fromNumber } }, select: { id: true, number: true } }),
        prisma.outline.findMany({ where: { novelId, type: 'ACT', actNumber: { gte: fromNumber } }, select: { id: true, actNumber: true } }),
    ])
    const highest = Math.max(0, ...acts.map((act) => act.number), ...actOutlines.map((outline) => outline.actNumber ?? 0))
    const tempOffset = highest + 1000

    await prisma.$transaction(async (tx) => {
        for (const act of acts) {
            await tx.act.update({ where: { id: act.id }, data: { number: act.number + tempOffset } })
        }
        for (const outline of actOutlines) {
            await tx.outline.update({ where: { id: outline.id }, data: { actNumber: (outline.actNumber ?? 0) + tempOffset } })
        }
        await tx.chapter.updateMany({ where: { novelId, actNumber: { gte: fromNumber } }, data: { actNumber: { increment: delta } } })
        for (const act of acts) {
            await tx.act.update({ where: { id: act.id }, data: { number: act.number + delta } })
        }
        for (const outline of actOutlines) {
            await tx.outline.update({ where: { id: outline.id }, data: { actNumber: (outline.actNumber ?? 0) + delta } })
        }
    })
}

function isChineseLanguage(language) {
    return typeof language === 'string' && language.trim().toLowerCase().startsWith('zh')
}

function formatDefaultChapterTitle(chapterNumber, language) {
    return isChineseLanguage(language) ? `章 ${chapterNumber}` : `Chapter ${chapterNumber}`
}

// A chapter title is a positional placeholder when it's the auto "章 N" / "第 N 章" / "Chapter N"
// form (mirrors isDefaultChapterTitle / isPlaceholderChapterTitle in the editor). A blank title is
// intentionally NOT counted — a brand-new chapter is opted in explicitly via `assignChapterId`.
function isDefaultFormChapterTitle(title) {
    const trimmed = (title ?? '').trim()
    if (!trimmed) return false
    return /^第\s*\d+\s*章$/.test(trimmed) || /^章\s*\d+$/.test(trimmed) || /^Chapter\s+\d+$/i.test(trimmed)
}

// Re-derive every default-titled chapter's "章 N" from its current global (act, order) position so
// the numbers stay sequential after an insert/delete — exactly like the app's manual chapter create
// /delete flow, which renumbers the placeholder titles of the chapters around the change. Custom
// titles are left untouched. `assignChapterId`, if given, is a freshly created chapter that should
// receive a default title even though it currently has none. Returns the ids whose title changed.
async function syncDefaultChapterTitles(novelId, language, assignChapterId = null) {
    const chapters = await prisma.chapter.findMany({
        where: { novelId },
        select: { id: true, title: true, actNumber: true, order: true },
    })
    chapters.sort((left, right) => {
        if (left.actNumber !== right.actNumber) return left.actNumber - right.actNumber
        if (left.order !== right.order) return left.order - right.order
        return left.id.localeCompare(right.id)
    })
    const changedIds = []
    for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index]
        const isDefault = chapter.id === assignChapterId || isDefaultFormChapterTitle(chapter.title)
        if (!isDefault) continue
        const desired = formatDefaultChapterTitle(index + 1, language)
        if (chapter.title !== desired) {
            await prisma.chapter.update({ where: { id: chapter.id }, data: { title: desired } })
            changedIds.push(chapter.id)
        }
    }
    return changedIds
}

async function createAct(args) {
    const novelId = requireString(args.novelId, 'novelId')
    await requireOwnedNovel(novelId)

    let insertNumber
    if (args.afterActNumber === undefined || args.afterActNumber === null) {
        // Front insert / first act: shift everything from act 1 up (a no-op when the novel is empty).
        insertNumber = 1
    } else {
        const afterActNumber = requirePositiveInteger(args.afterActNumber, 'afterActNumber')
        if (!(await actExistsInNovel(novelId, afterActNumber))) {
            throw new Error(`Act ${afterActNumber} was not found in novel ${novelId}.`)
        }
        insertNumber = afterActNumber + 1
    }

    await shiftActsFrom(novelId, insertNumber, 1)

    const title = args.title === undefined || args.title === null ? null : (requireString(args.title, 'title').trim() || null)
    const summary = args.summary === undefined || args.summary === null ? null : (requireString(args.summary, 'summary').trim() || null)
    const act = await prisma.act.create({
        data: { novelId, number: insertNumber, title, summary },
        select: { id: true, number: true, title: true, summary: true },
    })
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceDetailedOutlines(novelId),
    ])
    return { ok: true, act, actNumber: act.number }
}

async function createChapter(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const actNumber = requirePositiveInteger(args.actNumber, 'actNumber')
    await requireOwnedNovel(novelId)

    const [actRow, actChapters] = await Promise.all([
        prisma.act.findUnique({ where: { novelId_number: { novelId, number: actNumber } }, select: { id: true } }),
        prisma.chapter.findMany({ where: { novelId, actNumber }, orderBy: { order: 'asc' }, select: { id: true, order: true } }),
    ])
    // Require the act to exist (create_act first) so we never punch chapters into a numbering gap.
    if (!actRow && actChapters.length === 0) {
        throw new Error(`Act ${actNumber} was not found in novel ${novelId}. Create it with create_act first.`)
    }

    const afterChapterId = args.afterChapterId === undefined || args.afterChapterId === null
        ? null
        : requireNonEmptyString(args.afterChapterId, 'afterChapterId')

    let newOrder
    if (afterChapterId) {
        const anchor = actChapters.find((chapter) => chapter.id === afterChapterId)
        if (!anchor) {
            throw new Error(`Chapter ${afterChapterId} was not found in act ${actNumber} of novel ${novelId}.`)
        }
        await prisma.chapter.updateMany({
            where: { novelId, actNumber, order: { gt: anchor.order } },
            data: { order: { increment: 1 } },
        })
        newOrder = anchor.order + 1
    } else if (actChapters.length === 0) {
        newOrder = 1
    } else {
        const firstOrder = actChapters[0].order
        await prisma.chapter.updateMany({
            where: { novelId, actNumber, order: { gte: firstOrder } },
            data: { order: { increment: 1 } },
        })
        newOrder = firstOrder
    }

    // Without a (non-blank) title, bake the positional "章 N" default like the app's manual chapter
    // creation — a blank title would render as the grey "无标题章节" placeholder in the editor.
    const title = args.title === undefined || args.title === null ? '' : requireString(args.title, 'title').trim()
    const hasTitle = title.length > 0

    const chapter = await prisma.chapter.create({
        data: { novelId, actNumber, order: newOrder, title, wordCount: 0 },
        select: { id: true, actNumber: true, order: true },
    })
    // Every chapter keeps at least one scene, matching the app's chapter creation.
    const scene = await prisma.scene.create({
        data: { chapterId: chapter.id, order: 0, content: '', wordCount: 0 },
        select: { id: true },
    })

    const { language } = (await prisma.novel.findUnique({ where: { id: novelId }, select: { language: true } })) ?? {}
    // Assign the new chapter its default title (when untitled) and renumber the placeholder titles
    // of the chapters the insert pushed down, so "章 N" stays in step with the global order.
    const changedIds = await syncDefaultChapterTitles(novelId, language, hasTitle ? null : chapter.id)
    const finalTitle = hasTitle
        ? title
        : (await prisma.chapter.findUnique({ where: { id: chapter.id }, select: { title: true } }))?.title ?? title

    const affectedChapterIds = new Set([chapter.id, ...changedIds])
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        ...[...affectedChapterIds].map((id) => syncNovelWorkspaceChapter(novelId, id)),
        syncNovelWorkspaceDetailedOutlines(novelId),
    ])
    return {
        ok: true,
        chapter: { id: chapter.id, title: finalTitle, actNumber: chapter.actNumber, order: chapter.order },
        chapterId: chapter.id,
        sceneId: scene.id,
        chapterFile: `chapters/${chapter.id}.md`,
    }
}

async function createScene(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const chapterId = requireNonEmptyString(args.chapterId, 'chapterId')
    await requireOwnedNovel(novelId)

    const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, novelId }, select: { id: true } })
    if (!chapter) throw new Error(`Chapter ${chapterId} was not found in novel ${novelId}.`)

    const scenes = await prisma.scene.findMany({
        where: { chapterId },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
    })

    const afterSceneId = args.afterSceneId === undefined || args.afterSceneId === null
        ? null
        : requireNonEmptyString(args.afterSceneId, 'afterSceneId')

    let newOrder
    if (afterSceneId) {
        const anchor = scenes.find((scene) => scene.id === afterSceneId)
        if (!anchor) {
            throw new Error(`Scene ${afterSceneId} was not found in chapter ${chapterId}.`)
        }
        await prisma.scene.updateMany({
            where: { chapterId, order: { gt: anchor.order } },
            data: { order: { increment: 1 } },
        })
        newOrder = anchor.order + 1
    } else if (scenes.length === 0) {
        newOrder = 0
    } else {
        const firstOrder = scenes[0].order
        await prisma.scene.updateMany({
            where: { chapterId, order: { gte: firstOrder } },
            data: { order: { increment: 1 } },
        })
        newOrder = firstOrder
    }

    const scene = await prisma.scene.create({
        data: { chapterId, order: newOrder, content: '', wordCount: 0 },
        select: { id: true, order: true },
    })
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceChapter(novelId, chapterId),
    ])
    return { ok: true, scene, sceneId: scene.id, chapterId }
}

async function deleteAct(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const actNumber = requirePositiveInteger(args.actNumber, 'actNumber')
    await requireOwnedNovel(novelId)

    const [actRow, actOutline, chapterCount] = await Promise.all([
        prisma.act.findUnique({ where: { novelId_number: { novelId, number: actNumber } }, select: { id: true } }),
        prisma.outline.findUnique({ where: { novelId_type_actNumber: { novelId, type: 'ACT', actNumber } }, select: { id: true } }),
        prisma.chapter.count({ where: { novelId, actNumber } }),
    ])
    if (!actRow && !actOutline && chapterCount === 0) {
        throw new Error(`Act ${actNumber} was not found in novel ${novelId}.`)
    }
    if (chapterCount > 0) {
        throw new Error(`Act ${actNumber} still has ${chapterCount} chapter${chapterCount === 1 ? '' : 's'} and cannot be deleted. Move or delete its chapters first.`)
    }

    await requireStructureDeletionApproval('delete_act', `run tool "delete_act"：永久删除空的第 ${actNumber} 卷？此操作不可撤销。`)

    if (actRow) await prisma.act.delete({ where: { id: actRow.id } })
    if (actOutline) await prisma.outline.delete({ where: { id: actOutline.id } })
    // Close the numbering gap so acts stay contiguous (mirrors the upward shift on insert).
    await shiftActsFrom(novelId, actNumber + 1, -1)

    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceDetailedOutlines(novelId),
    ])
    return { ok: true, deleted: { actNumber, novelId } }
}

async function deleteChapter(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const chapterId = requireNonEmptyString(args.chapterId, 'chapterId')
    await requireOwnedNovel(novelId)

    const chapter = await prisma.chapter.findFirst({
        where: { id: chapterId, novelId },
        select: { id: true, title: true, scenes: { select: { id: true, content: true } } },
    })
    if (!chapter) throw new Error(`Chapter ${chapterId} was not found in novel ${novelId}.`)

    const hasProse = chapter.scenes.some((scene) => calculateWordCountFromHtml(scene.content) > 0)
    if (hasProse) {
        throw new Error(`Chapter ${chapterId} has scenes with prose and cannot be deleted. Clear its scenes first.`)
    }
    const sceneIds = chapter.scenes.map((scene) => scene.id)
    const panelCount = sceneIds.length
        ? await prisma.sceneContinuationDraft.count({ where: { sceneId: { in: sceneIds } } })
        : 0
    if (panelCount > 0) {
        throw new Error(`Chapter ${chapterId} still hosts an inline scene-continuation panel. Finish or discard it before deleting the chapter.`)
    }

    await requireStructureDeletionApproval('delete_chapter', `run tool "delete_chapter"：永久删除空章「${chapter.title || '未命名章节'}」（id ${chapterId}）？此操作不可撤销。`)

    // Scenes and the chapter outline (章纲) cascade-delete with the chapter row.
    await prisma.chapter.delete({ where: { id: chapterId } })
    await removeNovelWorkspaceChapterProjection(novelId, chapterId)

    // Renumber the placeholder "章 N" titles the deletion shifted, like the app's manual delete.
    const { language } = (await prisma.novel.findUnique({ where: { id: novelId }, select: { language: true } })) ?? {}
    const changedIds = await syncDefaultChapterTitles(novelId, language)
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        ...changedIds.map((id) => syncNovelWorkspaceChapter(novelId, id)),
        syncNovelWorkspaceDetailedOutlines(novelId),
    ])
    return { ok: true, deleted: { chapterId, novelId } }
}

async function deleteScene(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const sceneId = requireNonEmptyString(args.sceneId, 'sceneId')
    await requireOwnedNovel(novelId)

    const scene = await prisma.scene.findFirst({
        where: { id: sceneId, chapter: { novelId } },
        select: { id: true, content: true, chapterId: true },
    })
    if (!scene) throw new Error(`Scene ${sceneId} was not found in novel ${novelId}.`)

    if (calculateWordCountFromHtml(scene.content) > 0) {
        throw new Error(`Scene ${sceneId} has prose and cannot be deleted. Clear its Content first.`)
    }
    const panelCount = await prisma.sceneContinuationDraft.count({ where: { sceneId } })
    if (panelCount > 0) {
        throw new Error(`Scene ${sceneId} still hosts an inline scene-continuation panel. Finish or discard it before deleting the scene.`)
    }
    const sceneCount = await prisma.scene.count({ where: { chapterId: scene.chapterId } })
    if (sceneCount <= 1) {
        throw new Error('Cannot delete the last scene of a chapter. Delete the chapter instead.')
    }

    await requireStructureDeletionApproval('delete_scene', `run tool "delete_scene"：永久删除空场景（id ${sceneId}）？此操作不可撤销。`)

    await prisma.scene.delete({ where: { id: sceneId } })

    // Re-pack the surviving scenes' order and recompute the chapter word count.
    const remaining = await prisma.scene.findMany({
        where: { chapterId: scene.chapterId },
        orderBy: { order: 'asc' },
        select: { id: true, order: true, wordCount: true },
    })
    for (let index = 0; index < remaining.length; index += 1) {
        if (remaining[index].order !== index) {
            await prisma.scene.update({ where: { id: remaining[index].id }, data: { order: index } })
        }
    }
    await prisma.chapter.update({
        where: { id: scene.chapterId },
        data: { wordCount: remaining.reduce((sum, item) => sum + item.wordCount, 0) },
    })
    await Promise.all([
        syncNovelWorkspaceOutline(novelId),
        syncNovelWorkspaceChapter(novelId, scene.chapterId),
    ])
    return { ok: true, deleted: { sceneId, chapterId: scene.chapterId, novelId } }
}

// Gate a destructive structure deletion on the session review level, same as delete_snippet /
// delete_outline / delete_term: run automatically under no_review; don't double-prompt under
// user_review (Codex already asks per call); otherwise raise our own confirmation the author
// must accept before anything is deleted.
async function requireStructureDeletionApproval(toolName, message) {
    const reviewLevel = (process.env.OPENNOVELWRITER_REVIEW_LEVEL || '').trim()
    if (reviewLevel === 'no_review' || reviewLevel === 'user_review') return
    let result
    try {
        result = await sendServerRequest('elicitation/create', {
            message,
            requestedSchema: { type: 'object', properties: {}, additionalProperties: false },
        })
    } catch (error) {
        throw new Error(`Deleting via "${toolName}" needs the author's approval, but the confirmation could not be shown (${error instanceof Error ? error.message : String(error)}). Nothing was deleted.`)
    }
    const action = result && typeof result === 'object' ? result.action : null
    if (action !== 'accept') {
        throw new Error('Deletion was declined by the author. Nothing was deleted.')
    }
}

async function removeNovelWorkspaceChapterProjection(novelId, chapterId) {
    await removeWorkspaceProjectionFile(getNovelWorkspaceChapterPath(ownerId, novelId, chapterId))
}

async function createSnippet(args) {
    const mdPath = requireNonEmptyString(args.mdPath, 'mdPath')
    const pinned = args.pinned === undefined ? false : requireBoolean(args.pinned, 'pinned')
    const artifact = await resolveArtifactMarkdownPath(mdPath)
    const session = await prisma.codexSession.findFirst({
        where: { id: artifact.sessionId, ownerId },
        select: { id: true, novelId: true },
    })
    if (!session) {
        throw new Error(`Codex session ${artifact.sessionId} was not found for this connection.`)
    }
    await requireOwnedNovel(session.novelId)

    const markdown = (await fs.readFile(artifact.realPath, 'utf8')).replace(/\r\n?/g, '\n').trim()
    if (!markdown) throw new Error('Markdown file is empty.')

    const title = inferSnippetTitle(artifact.realPath, markdown)
    const content = markdownToHtml(markdown)
    const snippet = await prisma.snippet.create({
        data: {
            novelId: session.novelId,
            title,
            content,
            pinned,
            wordCount: calculateWordCountFromHtml(content),
        },
        select: {
            id: true,
            title: true,
            pinned: true,
            novelId: true,
            createdAt: true,
            updatedAt: true,
        },
    })

    await syncNovelWorkspaceSnippets(session.novelId)

    return {
        ok: true,
        snippet: {
            id: snippet.id,
            title: snippet.title,
            pinned: snippet.pinned,
            novelId: snippet.novelId,
            createdAt: snippet.createdAt.toISOString(),
            updatedAt: snippet.updatedAt.toISOString(),
        },
        sourcePath: artifact.realPath,
        snippetFile: `snippets/${snippet.id}.md`,
    }
}

async function editSnippet(args) {
    const snippetId = requireNonEmptyString(args.snippetId, 'snippetId')
    const snippet = await prisma.snippet.findUnique({
        where: { id: snippetId },
        select: { id: true, novelId: true },
    })
    if (!snippet) throw new Error(`Snippet ${snippetId} was not found for this Codex connection.`)
    await requireOwnedNovel(snippet.novelId)

    const hasContent = args.content !== undefined && args.content !== null
    const hasMdPath = args.mdPath !== undefined && args.mdPath !== null
    if (hasContent && hasMdPath) throw new Error('Provide either content or mdPath, not both.')

    const data = {}
    if (args.title !== undefined && args.title !== null) {
        data.title = requireString(args.title, 'title').trim()
    }
    if (args.pinned !== undefined && args.pinned !== null) {
        data.pinned = requireBoolean(args.pinned, 'pinned')
    }
    if (hasContent || hasMdPath) {
        let markdown
        if (hasMdPath) {
            const artifact = await resolveArtifactMarkdownPath(requireNonEmptyString(args.mdPath, 'mdPath'))
            markdown = (await fs.readFile(artifact.realPath, 'utf8')).replace(/\r\n?/g, '\n').trim()
        } else {
            markdown = requireString(args.content, 'content').replace(/\r\n?/g, '\n').trim()
        }
        if (!markdown) throw new Error('The new snippet content is empty.')
        const html = markdownToHtml(markdown)
        data.content = html
        data.wordCount = calculateWordCountFromHtml(html)
    }

    if (Object.keys(data).length === 0) {
        throw new Error('Nothing to update: provide at least one of title, pinned, content, or mdPath.')
    }

    const updated = await prisma.snippet.update({
        where: { id: snippet.id },
        data,
        select: { id: true, title: true, pinned: true, novelId: true, createdAt: true, updatedAt: true },
    })
    await syncNovelWorkspaceSnippets(updated.novelId)

    return {
        ok: true,
        snippet: {
            id: updated.id,
            title: updated.title,
            pinned: updated.pinned,
            novelId: updated.novelId,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        },
        snippetFile: `snippets/${updated.id}.md`,
    }
}

async function deleteSnippet(args) {
    const snippetId = requireNonEmptyString(args.snippetId, 'snippetId')
    const snippet = await prisma.snippet.findUnique({
        where: { id: snippetId },
        select: { id: true, title: true, novelId: true },
    })
    if (!snippet) throw new Error(`Snippet ${snippetId} was not found for this Codex connection.`)
    await requireOwnedNovel(snippet.novelId)

    // Destructive, so gate on the session review level (passed in per turn via config.toml env):
    // - no_review: run automatically.
    // - user_review: Codex already prompts the author for every tool call, so don't double-prompt.
    // - auto_review (and any unexpected value): tool calls are pre-approved, so raise our own
    //   confirmation elicitation — the author must accept before anything is deleted.
    const reviewLevel = (process.env.OPENNOVELWRITER_REVIEW_LEVEL || '').trim()
    if (reviewLevel !== 'no_review' && reviewLevel !== 'user_review') {
        await requestSnippetDeletionApproval(snippet)
    }

    await prisma.snippet.delete({ where: { id: snippet.id } })
    await removeNovelWorkspaceSnippetProjection(snippet.novelId, snippet.id)

    return {
        ok: true,
        deleted: { id: snippet.id, title: snippet.title, novelId: snippet.novelId },
    }
}

// Ask the author to confirm a destructive snippet deletion via an MCP elicitation. Codex forwards
// it to OpenNovelWriter's approval UI; under no_review it is auto-accepted upstream.
async function requestSnippetDeletionApproval(snippet) {
    const label = snippet.title?.trim() || '未命名片段'
    const message = `run tool "delete_snippet"：永久删除片段「${label}」（id ${snippet.id}）？此操作不可撤销。`
    let result
    try {
        result = await sendServerRequest('elicitation/create', {
            message,
            requestedSchema: { type: 'object', properties: {}, additionalProperties: false },
        })
    } catch (error) {
        throw new Error(`Snippet deletion needs the author's approval, but the confirmation could not be shown (${error instanceof Error ? error.message : String(error)}). Nothing was deleted.`)
    }
    const action = result && typeof result === 'object' ? result.action : null
    if (action !== 'accept') {
        throw new Error('Snippet deletion was declined by the author. Nothing was deleted.')
    }
}

async function removeNovelWorkspaceSnippetProjection(novelId, snippetId) {
    const snippetPath = getNovelWorkspaceSnippetPath(ownerId, novelId, snippetId)
    await fs.rm(snippetPath, { force: true }).catch(() => {})
    await syncNovelWorkspaceSnippets(novelId)
}

// --- Detailed outline (细纲) tools ---------------------------------------------------------------
// A 细纲 is always bound to an existing chapter (by chapterId) or act (by actNumber); it has no
// standalone handle, so every tool locates it by that target. Mirrors the snippet create/edit/delete
// shape: content arrives as literal Markdown or an artifacts/*.md path, stored after Markdown→HTML.

function resolveOutlineTarget(args) {
    const hasChapter = args.chapterId !== undefined && args.chapterId !== null
    const hasAct = args.actNumber !== undefined && args.actNumber !== null
    if (hasChapter === hasAct) {
        throw new Error('Provide exactly one of chapterId or actNumber.')
    }
    if (hasChapter) {
        return { type: 'CHAPTER', chapterId: requireNonEmptyString(args.chapterId, 'chapterId') }
    }
    return { type: 'ACT', actNumber: requirePositiveInteger(args.actNumber, 'actNumber') }
}

function outlineTargetLabel(target) {
    return target.type === 'CHAPTER' ? `chapter ${target.chapterId}` : `act ${target.actNumber}`
}

function outlineProjectionFile(target) {
    return target.type === 'CHAPTER'
        ? `DetailedOutline/chapters/${target.chapterId}.md`
        : `DetailedOutline/acts/${target.actNumber}.md`
}

async function requireOutlineTargetExists(novelId, target) {
    if (target.type === 'CHAPTER') {
        const chapter = await prisma.chapter.findFirst({
            where: { id: target.chapterId, novelId },
            select: { id: true },
        })
        if (!chapter) throw new Error(`Chapter ${target.chapterId} was not found in novel ${novelId}.`)
        return
    }
    const act = await prisma.act.findUnique({
        where: { novelId_number: { novelId, number: target.actNumber } },
        select: { id: true },
    })
    if (act) return
    const chapter = await prisma.chapter.findFirst({
        where: { novelId, actNumber: target.actNumber },
        select: { id: true },
    })
    if (!chapter) throw new Error(`Act ${target.actNumber} was not found in novel ${novelId}.`)
}

async function findOutlineForTarget(novelId, target) {
    if (target.type === 'CHAPTER') {
        return prisma.outline.findUnique({ where: { chapterId: target.chapterId }, select: { id: true } })
    }
    return prisma.outline.findUnique({
        where: { novelId_type_actNumber: { novelId, type: 'ACT', actNumber: target.actNumber } },
        select: { id: true },
    })
}

async function resolveOutlineMarkdownHtml(args) {
    const hasContent = args.content !== undefined && args.content !== null
    const hasMdPath = args.mdPath !== undefined && args.mdPath !== null
    if (hasContent && hasMdPath) throw new Error('Provide either content or mdPath, not both.')
    if (!hasContent && !hasMdPath) {
        throw new Error('Outline content is required: provide content or mdPath.')
    }

    let markdown
    if (hasMdPath) {
        const artifact = await resolveArtifactMarkdownPath(requireNonEmptyString(args.mdPath, 'mdPath'))
        markdown = (await fs.readFile(artifact.realPath, 'utf8')).replace(/\r\n?/g, '\n').trim()
    } else {
        markdown = requireString(args.content, 'content').replace(/\r\n?/g, '\n').trim()
    }
    if (!markdown) throw new Error('The outline content is empty.')
    return markdownToHtml(markdown)
}

async function createOutline(args) {
    const novelId = requireString(args.novelId, 'novelId')
    await requireOwnedNovel(novelId)
    const target = resolveOutlineTarget(args)
    await requireOutlineTargetExists(novelId, target)

    const existing = await findOutlineForTarget(novelId, target)
    if (existing) {
        throw new Error(`A detailed outline already exists for ${outlineTargetLabel(target)}. Use edit_outline to change it.`)
    }

    const html = await resolveOutlineMarkdownHtml(args)
    const outline = await prisma.outline.create({
        data: {
            novelId,
            type: target.type,
            chapterId: target.type === 'CHAPTER' ? target.chapterId : null,
            actNumber: target.type === 'ACT' ? target.actNumber : null,
            content: html,
            wordCount: calculateWordCountFromHtml(html),
        },
        select: { id: true, type: true, actNumber: true, chapterId: true, wordCount: true },
    })
    await syncNovelWorkspaceDetailedOutlines(novelId)
    return { ok: true, outline, outlineFile: outlineProjectionFile(target) }
}

async function editOutline(args) {
    const novelId = requireString(args.novelId, 'novelId')
    await requireOwnedNovel(novelId)
    const target = resolveOutlineTarget(args)
    const existing = await findOutlineForTarget(novelId, target)
    if (!existing) {
        throw new Error(`No detailed outline exists for ${outlineTargetLabel(target)} yet. Use create_outline first.`)
    }

    const html = await resolveOutlineMarkdownHtml(args)
    const updated = await prisma.outline.update({
        where: { id: existing.id },
        data: { content: html, wordCount: calculateWordCountFromHtml(html) },
        select: { id: true, type: true, actNumber: true, chapterId: true, wordCount: true },
    })
    await syncNovelWorkspaceDetailedOutlines(novelId)
    return { ok: true, outline: updated, outlineFile: outlineProjectionFile(target) }
}

async function deleteOutline(args) {
    const novelId = requireString(args.novelId, 'novelId')
    await requireOwnedNovel(novelId)
    const target = resolveOutlineTarget(args)
    const existing = await findOutlineForTarget(novelId, target)
    if (!existing) {
        throw new Error(`No detailed outline exists for ${outlineTargetLabel(target)}.`)
    }

    // Destructive: same review gating as delete_snippet / delete_term.
    const reviewLevel = (process.env.OPENNOVELWRITER_REVIEW_LEVEL || '').trim()
    if (reviewLevel !== 'no_review' && reviewLevel !== 'user_review') {
        await requestOutlineDeletionApproval(target)
    }

    await prisma.outline.delete({ where: { id: existing.id } })
    await syncNovelWorkspaceDetailedOutlines(novelId)
    return {
        ok: true,
        deleted: {
            id: existing.id,
            type: target.type,
            chapterId: target.type === 'CHAPTER' ? target.chapterId : null,
            actNumber: target.type === 'ACT' ? target.actNumber : null,
            novelId,
        },
    }
}

async function requestOutlineDeletionApproval(target) {
    const label = target.type === 'CHAPTER' ? `章纲（chapter ${target.chapterId}）` : `卷纲（act ${target.actNumber}）`
    const message = `run tool "delete_outline"：永久删除${label}的细纲？此操作不可撤销。`
    let result
    try {
        result = await sendServerRequest('elicitation/create', {
            message,
            requestedSchema: { type: 'object', properties: {}, additionalProperties: false },
        })
    } catch (error) {
        throw new Error(`Outline deletion needs the author's approval, but the confirmation could not be shown (${error instanceof Error ? error.message : String(error)}). Nothing was deleted.`)
    }
    const action = result && typeof result === 'object' ? result.action : null
    if (action !== 'accept') {
        throw new Error('Outline deletion was declined by the author. Nothing was deleted.')
    }
}

async function loadTermState(novelId) {
    const record = await prisma.novelTermState.findUnique({
        where: { novelId },
        select: { stateJson: true },
    })
    if (!record) return { entries: [] }
    let parsed = null
    try {
        parsed = JSON.parse(record.stateJson)
    } catch {
        parsed = null
    }
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.entries) ? parsed : { entries: [] }
}

async function saveTermState(novelId, state) {
    const stateJson = JSON.stringify(state)
    await prisma.novelTermState.upsert({
        where: { novelId },
        update: { stateJson },
        create: { novelId, stateJson },
    })
}

// Rewrite the novel/terms/ projection from the given state: write every active term's
// Markdown and remove files that no longer correspond to an active term.
async function syncNovelWorkspaceTerms(novelId, state) {
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: { language: true },
    })
    if (!novel) return []

    const snapshots = buildTermProjectionSnapshots({ novelId, language: novel.language, state })
    const termsPath = getNovelWorkspaceTermsPath(ownerId, novelId)
    await fs.mkdir(termsPath, { recursive: true })

    const keep = new Set(snapshots.map((snapshot) => snapshot.fileName.toLowerCase()))
    const existing = await fs.readdir(termsPath, { withFileTypes: true }).catch(() => [])
    await Promise.all(
        existing
            .filter((entry) => entry.name.endsWith('.md') && !keep.has(entry.name.toLowerCase()))
            .map((entry) => removeWorkspaceProjectionFile(path.join(termsPath, entry.name)))
    )
    await Promise.all(
        snapshots.map((snapshot) =>
            writeReadonlyProjectionFile(path.join(termsPath, snapshot.fileName), snapshot.markdown)
        )
    )
    return snapshots
}

async function removeWorkspaceProjectionFile(filePath) {
    await fs.chmod(filePath, 0o644).catch(() => {})
    await fs.rm(filePath, { force: true }).catch(() => {})
}

function requireTermCategoryId(state, raw) {
    const categoryId = requireNonEmptyString(raw, 'categoryId')
    const enabledPresetIds = getEnabledPresetCategoryIds(state)
    const customIds = getCustomCategories(state).map((category) => category.id)
    const validIds = [...DEFAULT_TERM_CATEGORY_IDS, ...enabledPresetIds, ...customIds]
    if (!validIds.includes(categoryId)) {
        throw new Error(`Unknown categoryId "${categoryId}" for this novel. Valid ids: ${validIds.join(', ')}.`)
    }
    return categoryId
}

// Normalize a string-array input (experiences, tags): trim each item to a single
// line and drop empties.
function normalizeStringListInput(raw, name) {
    if (!Array.isArray(raw)) throw new Error(`${name} must be an array of strings.`)
    const lines = raw.map((item, index) => {
        const line = requireString(item, `${name}[${index}]`).replace(/\s+/g, ' ').trim()
        return line
    })
    return lines.filter(Boolean)
}

async function resolveTermDescription(args) {
    const hasLiteral = args.description !== undefined && args.description !== null
    const hasMdPath = args.descriptionMdPath !== undefined && args.descriptionMdPath !== null
    if (hasLiteral && hasMdPath) throw new Error('Provide either description or descriptionMdPath, not both.')
    if (hasMdPath) {
        const artifact = await resolveArtifactMarkdownPath(requireNonEmptyString(args.descriptionMdPath, 'descriptionMdPath'))
        return (await fs.readFile(artifact.realPath, 'utf8')).replace(/\r\n?/g, '\n').trim()
    }
    if (hasLiteral) return requireString(args.description, 'description').replace(/\r\n?/g, '\n').trim()
    return undefined
}

function assertNoDuplicateTermTitle(state, title, excludeId) {
    const key = normalizeTermTitleKey(title)
    if (!key) return
    const duplicate = getTermStateEntries(state).some(
        (entry) =>
            entry.archived !== true &&
            entry.id !== excludeId &&
            normalizeTermTitleKey(entry.title) === key
    )
    if (duplicate) {
        throw new Error(`A term titled "${title}" already exists in this novel. Pick another title or edit the existing term.`)
    }
}

function setOrDeleteTermField(entry, key, value) {
    if (value === undefined || value === null || value === '') delete entry[key]
    else entry[key] = value
}

function toTermSummary(entry, snapshots) {
    const snapshot = snapshots.find((item) => item.term.id === entry.id) ?? null
    return {
        id: entry.id,
        title: entry.title,
        categoryId: entry.categoryId,
        termFile: snapshot ? `terms/${snapshot.fileName}` : null,
    }
}

async function createTerm(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const title = requireNonEmptyString(args.title, 'title')
    await requireOwnedNovel(novelId)

    const state = await loadTermState(novelId)
    assertNoDuplicateTermTitle(state, title, null)

    const categoryId = args.categoryId === undefined ? 'characters' : requireTermCategoryId(state, args.categoryId)
    const description = await resolveTermDescription(args)
    const experiences = args.experiences === undefined ? null : normalizeStringListInput(args.experiences, 'experiences')
    const color = args.color === undefined ? undefined : requireNonEmptyString(args.color, 'color')

    const entry = { id: crypto.randomUUID(), categoryId, title }
    setOrDeleteTermField(entry, 'subtitle', args.subtitle === undefined ? undefined : requireString(args.subtitle, 'subtitle').trim())
    setOrDeleteTermField(entry, 'aliases', args.aliases === undefined ? undefined : requireString(args.aliases, 'aliases').trim())
    setOrDeleteTermField(entry, 'description', description)
    setOrDeleteTermField(entry, 'experiences', experiences?.length ? experiences.join('\n') : undefined)
    if (args.tags !== undefined) {
        const tags = normalizeStringListInput(args.tags, 'tags')
        if (tags.length) entry.tags = tags
    }
    if (color && color !== 'black') entry.color = color

    state.entries = [entry, ...getTermStateEntries(state)]
    await saveTermState(novelId, state)
    const snapshots = await syncNovelWorkspaceTerms(novelId, state)

    return { ok: true, term: toTermSummary(entry, snapshots) }
}

async function editTerm(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const termId = requireNonEmptyString(args.termId, 'termId')
    await requireOwnedNovel(novelId)

    const state = await loadTermState(novelId)
    const entry = getTermStateEntries(state).find((item) => item.id === termId) ?? null
    if (!entry) throw new Error(`Term ${termId} was not found in novel ${novelId}. Read the term_id from its novel/terms/*.md projection.`)
    if (entry.archived === true) throw new Error(`Term ${termId} is archived; restore it in the app before editing.`)

    const hasExperiences = args.experiences !== undefined && args.experiences !== null
    const hasAppendExperiences = args.appendExperiences !== undefined && args.appendExperiences !== null
    if (hasExperiences && hasAppendExperiences) {
        throw new Error('Provide either experiences (replace) or appendExperiences (append), not both.')
    }

    let changed = false

    if (args.title !== undefined && args.title !== null) {
        const title = requireNonEmptyString(args.title, 'title')
        assertNoDuplicateTermTitle(state, title, entry.id)
        entry.title = title
        changed = true
    }
    if (args.categoryId !== undefined && args.categoryId !== null) {
        entry.categoryId = requireTermCategoryId(state, args.categoryId)
        changed = true
    }
    if (args.subtitle !== undefined && args.subtitle !== null) {
        setOrDeleteTermField(entry, 'subtitle', requireString(args.subtitle, 'subtitle').trim())
        changed = true
    }
    if (args.aliases !== undefined && args.aliases !== null) {
        setOrDeleteTermField(entry, 'aliases', requireString(args.aliases, 'aliases').trim())
        changed = true
    }
    const description = await resolveTermDescription(args)
    if (description !== undefined) {
        setOrDeleteTermField(entry, 'description', description)
        changed = true
    }
    if (hasExperiences) {
        const lines = normalizeStringListInput(args.experiences, 'experiences')
        setOrDeleteTermField(entry, 'experiences', lines.length ? lines.join('\n') : undefined)
        changed = true
    }
    if (hasAppendExperiences) {
        const appended = normalizeStringListInput(args.appendExperiences, 'appendExperiences')
        if (appended.length) {
            const current = typeof entry.experiences === 'string' && entry.experiences.trim() ? entry.experiences.trim() : ''
            entry.experiences = current ? `${current}\n${appended.join('\n')}` : appended.join('\n')
            changed = true
        }
    }
    if (args.tags !== undefined && args.tags !== null) {
        const tags = normalizeStringListInput(args.tags, 'tags')
        if (tags.length) entry.tags = tags
        else delete entry.tags
        changed = true
    }
    if (args.color !== undefined && args.color !== null) {
        const color = requireNonEmptyString(args.color, 'color')
        if (color === 'black') delete entry.color
        else entry.color = color
        changed = true
    }

    if (!changed) {
        throw new Error('Nothing to update: provide at least one field to change.')
    }

    await saveTermState(novelId, state)
    const snapshots = await syncNovelWorkspaceTerms(novelId, state)

    return { ok: true, term: toTermSummary(entry, snapshots) }
}

async function deleteTerm(args) {
    const novelId = requireString(args.novelId, 'novelId')
    const termId = requireNonEmptyString(args.termId, 'termId')
    await requireOwnedNovel(novelId)

    const state = await loadTermState(novelId)
    const entry = getTermStateEntries(state).find((item) => item.id === termId) ?? null
    if (!entry) throw new Error(`Term ${termId} was not found in novel ${novelId}.`)

    // Destructive: same review-level gate as delete_snippet (see that function for the rationale).
    const reviewLevel = (process.env.OPENNOVELWRITER_REVIEW_LEVEL || '').trim()
    if (reviewLevel !== 'no_review' && reviewLevel !== 'user_review') {
        await requestTermDeletionApproval(entry)
    }

    // Drop the entry and strip relations on other terms that point at it (mirrors the app).
    state.entries = getTermStateEntries(state)
        .filter((item) => item.id !== termId)
        .map((item) => {
            const relations = Array.isArray(item.relations) ? item.relations : []
            if (relations.length === 0) return item
            const nextRelations = relations.filter((relation) => relation && relation.otherId !== termId)
            if (nextRelations.length === relations.length) return item
            const next = { ...item }
            if (nextRelations.length) next.relations = nextRelations
            else delete next.relations
            return next
        })

    await saveTermState(novelId, state)
    await syncNovelWorkspaceTerms(novelId, state)

    return {
        ok: true,
        deleted: { id: termId, title: typeof entry.title === 'string' ? entry.title : '', novelId },
    }
}

async function requestTermDeletionApproval(entry) {
    const label = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : '未命名词条'
    const message = `run tool "delete_term"：永久删除词条「${label}」（id ${entry.id}）？此操作不可撤销。`
    let result
    try {
        result = await sendServerRequest('elicitation/create', {
            message,
            requestedSchema: { type: 'object', properties: {}, additionalProperties: false },
        })
    } catch (error) {
        throw new Error(`Term deletion needs the author's approval, but the confirmation could not be shown (${error instanceof Error ? error.message : String(error)}). Nothing was deleted.`)
    }
    const action = result && typeof result === 'object' ? result.action : null
    if (action !== 'accept') {
        throw new Error('Term deletion was declined by the author. Nothing was deleted.')
    }
}

async function runLlm(args) {
    const mdPath = requireNonEmptyString(args.mdPath, 'mdPath')
    const groupId = requireNonEmptyString(args.groupId, 'groupId')
    const temperature = args.temperature === undefined ? undefined : requireFiniteNumber(args.temperature, 'temperature')
    const maxTokens = args.maxTokens === undefined ? undefined : requireFiniteNumber(args.maxTokens, 'maxTokens')

    const artifact = await resolveArtifactMarkdownPath(mdPath)
    const session = await prisma.codexSession.findFirst({
        where: { id: artifact.sessionId, ownerId },
        select: { id: true },
    })
    if (!session) {
        throw new Error(`Codex session ${artifact.sessionId} was not found for this connection.`)
    }

    if (!internalToken) {
        throw new Error('run_llm is not configured: missing OPENNOVELWRITER_INTERNAL_TOKEN. Re-sync the Codex connection.')
    }

    const markdown = (await fs.readFile(artifact.realPath, 'utf8')).replace(/\r\n?/g, '\n')
    const blocks = parseLlmConversation(markdown)
    const { system, messages } = buildLlmRequestPayload(blocks)
    if (messages.length === 0) {
        throw new Error('The conversation file has no `## user` section to send. Add a `## user` block first.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RUN_LLM_TIMEOUT_MS)
    let payload
    try {
        const response = await fetch(`${internalBaseUrl}/api/internal/codex/run-llm`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-onw-internal-token': internalToken,
            },
            body: JSON.stringify({ ownerId, groupId, system, messages, temperature, maxTokens }),
            signal: controller.signal,
        })
        payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) {
            const detail = payload?.detail || `Model run failed with status ${response.status}.`
            throw new Error(detail)
        }
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error(`Model run timed out after ${Math.round(RUN_LLM_TIMEOUT_MS / 1000)}s.`)
        }
        throw error
    } finally {
        clearTimeout(timeout)
    }

    const replyText = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!replyText) {
        throw new Error('The model returned an empty reply.')
    }

    const base = markdown.replace(/\n+$/, '')
    const next = `${base ? `${base}\n\n` : ''}## assistant\n\n${replyText}\n`
    await fs.writeFile(artifact.realPath, next, 'utf8')

    const ref = await artifactLlmRef(artifact.sessionId, artifact.realPath)
    const assistantCount = blocks.filter((block) => block.role === 'assistant').length + 1

    return {
        ok: true,
        ref,
        suggestedLink: `[模型回复](${ref})`,
        assistantIndex: assistantCount - 1,
        groupName: payload.groupName ?? null,
        modelId: payload.modelId ?? null,
    }
}

async function getContinuationDraft(args) {
    const panelId = requireNonEmptyString(args.panelId, 'panelId')
    const draft = await requireOwnedContinuationDraft(panelId)
    return {
        ok: true,
        panelId: draft.panelId,
        sceneId: draft.sceneId,
        chapterId: draft.chapterId,
        content: draft.content,
        planning: draft.planning,
        updatedBy: draft.updatedBy,
    }
}

async function setContinuationDraft(args) {
    const panelId = requireNonEmptyString(args.panelId, 'panelId')
    await requireOwnedContinuationDraft(panelId)

    // Split optional <Planning>/<Content> tags the same way the panel does, so the draft renders
    // structured (planning collapsed, content as prose) and only content is ever written to the
    // manuscript. Untagged text is treated as plain content. Newlines are normalized so a reply
    // that arrives with literal "\\n" escapes still renders as real paragraphs.
    const parsed = parseContinuationDraftText(await resolveTextOrSource(args, 'text'))
    const planning =
        args.planning !== undefined && args.planning !== null
            ? unescapeDraftNewlines(requireString(args.planning, 'planning')).trim()
            : parsed.planning

    const updated = await prisma.sceneContinuationDraft.update({
        where: { panelId },
        data: { content: parsed.content, planning, updatedBy: 'codex' },
        select: { panelId: true, content: true },
    })
    return { ok: true, panelId: updated.panelId, contentLength: updated.content.length }
}

function unescapeDraftNewlines(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
}

function extractDraftTaggedSection(rawText, tagName) {
    const lower = rawText.toLowerCase()
    const open = `<${tagName}>`
    const close = `</${tagName}>`
    const start = lower.indexOf(open)
    if (start === -1) return ''
    const contentStart = start + open.length
    const end = lower.indexOf(close, contentStart)
    return rawText.slice(contentStart, end === -1 ? rawText.length : end).trim()
}

function parseContinuationDraftText(rawText) {
    const normalized = unescapeDraftNewlines(rawText).trim()
    const content = extractDraftTaggedSection(normalized, 'content')
    const planning = extractDraftTaggedSection(normalized, 'planning')
    // Fall back to plain text only when neither tag is present (matches the panel's manual flow).
    return {
        content: content || (!planning ? normalized : ''),
        planning,
    }
}

async function requireOwnedContinuationDraft(panelId) {
    const draft = await prisma.sceneContinuationDraft.findUnique({ where: { panelId } })
    if (!draft) {
        throw new Error(
            `No scene-continuation panel with id ${panelId} was found. It is created when the continuation session starts; use the panelId from the request's \`continuation:\` reference.`
        )
    }
    await requireOwnedNovel(draft.novelId)
    return draft
}

async function artifactLlmRef(sessionId, realPath) {
    const artifactsRoot = path.join(getOpenNovelWriterDataDir(), 'codex', 'sessions', ownerId, sessionId, 'artifacts')
    const realArtifactsRoot = await fs.realpath(artifactsRoot)
    const relative = path.relative(realArtifactsRoot, realPath).split(path.sep).join('/')
    return `llm:${relative}`
}

async function requireOwnedNovel(novelId) {
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: { id: true },
    })
    if (!novel) throw new Error(`Novel ${novelId} was not found for this Codex connection.`)
    return novel
}

async function syncNovelWorkspaceOutline(novelId) {
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            id: true,
            title: true,
            language: true,
            acts: {
                select: { number: true, title: true, summary: true },
            },
            chapters: {
                select: {
                    id: true,
                    title: true,
                    actNumber: true,
                    order: true,
                    scenes: {
                        select: { id: true, order: true, summary: true },
                    },
                },
            },
        },
    })
    if (!novel) return null

    const outlinePath = getNovelWorkspaceOutlinePath(ownerId, novelId)
    await writeReadonlyProjectionFile(outlinePath, buildNovelWorkspaceOutlineMarkdown(novel))
    return outlinePath
}

async function syncNovelWorkspaceChapter(novelId, chapterId) {
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
    const chapter = novel?.chapters[0] ?? null
    if (!chapter) return null

    const chapterPath = getNovelWorkspaceChapterPath(ownerId, novelId, chapter.id)
    await writeReadonlyProjectionFile(chapterPath, buildNovelWorkspaceChapterMarkdown({
        id: chapter.id,
        title: chapter.title,
        language: novel.language,
        scenes: chapter.scenes,
    }))
    return chapterPath
}

async function syncNovelWorkspaceSnippets(novelId) {
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
    await Promise.all(snippets.map((snippet) =>
        writeReadonlyProjectionFile(
            getNovelWorkspaceSnippetPath(ownerId, novelId, snippet.id),
            buildNovelWorkspaceSnippetMarkdown({
                novelId,
                language: novel.language,
                snippet,
            })
        )
    ))

    const indexPath = getNovelWorkspaceSnippetIndexPath(ownerId, novelId)
    await writeReadonlyProjectionFile(indexPath, buildNovelWorkspaceSnippetIndexMarkdown({
        id: novel.id,
        title: novel.title,
        language: novel.language,
        snippets,
    }))

    return { indexPath, snippetsPath }
}

async function syncNovelWorkspaceDetailedOutlines(novelId) {
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: {
            id: true,
            language: true,
            acts: { select: { number: true, title: true } },
            chapters: { select: { id: true, title: true, actNumber: true, order: true } },
            outlines: { select: { id: true, type: true, actNumber: true, chapterId: true, content: true } },
        },
    })
    if (!novel) return null

    const rootPath = getNovelWorkspaceDetailedOutlinesPath(ownerId, novelId)
    await fs.rm(rootPath, { recursive: true, force: true })

    const sortedChapters = [...novel.chapters].sort((left, right) => {
        if (left.actNumber !== right.actNumber) return left.actNumber - right.actNumber
        if (left.order !== right.order) return left.order - right.order
        return left.id.localeCompare(right.id)
    })
    const chapterNumberById = new Map()
    sortedChapters.forEach((chapter, index) => chapterNumberById.set(chapter.id, index + 1))
    const chapterById = new Map(novel.chapters.map((chapter) => [chapter.id, chapter]))
    const actTitleByNumber = new Map()
    for (const act of novel.acts) actTitleByNumber.set(act.number, act.title)

    for (const outline of novel.outlines) {
        if (!htmlToProjectionText(outline.content).trim()) continue

        if (outline.type === 'CHAPTER') {
            if (!outline.chapterId) continue
            const chapter = chapterById.get(outline.chapterId)
            if (!chapter) continue
            await writeReadonlyProjectionFile(
                path.join(rootPath, 'chapters', `${chapter.id}.md`),
                buildNovelWorkspaceDetailedOutlineMarkdown({
                    novelId: novel.id,
                    language: novel.language,
                    kind: 'chapter',
                    outlineId: outline.id,
                    chapterId: chapter.id,
                    chapterNumber: chapterNumberById.get(chapter.id) ?? chapter.order,
                    title: chapter.title,
                    content: outline.content,
                })
            )
        } else if (outline.type === 'ACT') {
            if (outline.actNumber == null) continue
            await writeReadonlyProjectionFile(
                path.join(rootPath, 'acts', `${outline.actNumber}.md`),
                buildNovelWorkspaceDetailedOutlineMarkdown({
                    novelId: novel.id,
                    language: novel.language,
                    kind: 'act',
                    outlineId: outline.id,
                    actNumber: outline.actNumber,
                    title: actTitleByNumber.get(outline.actNumber) ?? null,
                    content: outline.content,
                })
            )
        }
    }

    return rootPath
}

async function writeReadonlyProjectionFile(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.chmod(filePath, 0o644).catch((error) => {
        if ((error && error.code) !== 'ENOENT') throw error
    })
    await fs.writeFile(filePath, content, 'utf8')
    await fs.chmod(filePath, 0o444)
}

function getNovelWorkspacePath(ownerIdValue, novelId) {
    return path.join(getOpenNovelWriterDataDir(), 'codex', 'novels', ownerIdValue, novelId)
}

function getNovelWorkspaceOutlinePath(ownerIdValue, novelId) {
    return path.join(getNovelWorkspacePath(ownerIdValue, novelId), 'outline.md')
}

function getNovelWorkspaceChapterPath(ownerIdValue, novelId, chapterId) {
    return path.join(getNovelWorkspacePath(ownerIdValue, novelId), 'chapters', `${chapterId}.md`)
}

function getNovelWorkspaceTermsPath(ownerIdValue, novelId) {
    return path.join(getNovelWorkspacePath(ownerIdValue, novelId), 'terms')
}

function getNovelWorkspaceSnippetIndexPath(ownerIdValue, novelId) {
    return path.join(getNovelWorkspacePath(ownerIdValue, novelId), 'snippet.md')
}

function getNovelWorkspaceSnippetsPath(ownerIdValue, novelId) {
    return path.join(getNovelWorkspacePath(ownerIdValue, novelId), 'snippets')
}

function getNovelWorkspaceSnippetPath(ownerIdValue, novelId, snippetId) {
    return path.join(getNovelWorkspaceSnippetsPath(ownerIdValue, novelId), `${snippetId}.md`)
}

function getNovelWorkspaceDetailedOutlinesPath(ownerIdValue, novelId) {
    return path.join(getNovelWorkspacePath(ownerIdValue, novelId), 'DetailedOutline')
}

function getOpenNovelWriterDataDir() {
    const override = process.env.OPENNOVELWRITER_DATA_DIR
    if (override && override.trim()) return override.trim()
    if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'OpenNovelWriter')
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'OpenNovelWriter')
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opennovelwriter')
}

function requireString(value, name) {
    if (typeof value !== 'string') throw new Error(`${name} must be a string.`)
    return value
}

function requireNonEmptyString(value, name) {
    const normalized = requireString(value, name).trim()
    if (!normalized) throw new Error(`${name} cannot be empty.`)
    return normalized
}

function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
    return value
}

function requireBoolean(value, name) {
    if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`)
    return value
}

function requireFiniteNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number.`)
    return value
}

function requireInteger(value, name) {
    if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`)
    return value
}

// Read an assistant reply out of a run_llm conversation artifact, so the model's
// output can be committed to a scene without Codex retyping it. `source` is
// { mdPath, index? } where index counts only `## assistant` turns (default -1 = latest).
async function resolveLlmReplySource(source, fieldName) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${fieldName} must be an object { mdPath, index? }.`)
    }
    const mdPath = requireNonEmptyString(source.mdPath, `${fieldName}.mdPath`)
    const index = source.index === undefined ? -1 : requireInteger(source.index, `${fieldName}.index`)

    const artifact = await resolveArtifactMarkdownPath(mdPath)
    const session = await prisma.codexSession.findFirst({
        where: { id: artifact.sessionId, ownerId },
        select: { id: true },
    })
    if (!session) {
        throw new Error(`Codex session ${artifact.sessionId} was not found for this connection.`)
    }

    const markdown = (await fs.readFile(artifact.realPath, 'utf8')).replace(/\r\n?/g, '\n')
    const blocks = parseLlmConversation(markdown)
    const picked = getAssistantBlock(blocks, index)
    if (!picked) {
        const total = blocks.filter((block) => block.role === 'assistant').length
        throw new Error(`No assistant reply at index ${index} in ${mdPath} (it has ${total} assistant block${total === 1 ? '' : 's'}). Run run_llm first, or pick a valid index.`)
    }
    const content = picked.content.trim()
    if (!content) {
        throw new Error(`The assistant reply at index ${index} in ${mdPath} is empty.`)
    }
    return content
}

// Resolve a text value that may be given literally (args[fieldName]) or pulled from a
// run_llm reply (args.source). Exactly one must be present.
async function resolveTextOrSource(args, fieldName) {
    const hasLiteral = args[fieldName] !== undefined && args[fieldName] !== null
    const hasSource = args.source !== undefined && args.source !== null
    if (hasLiteral && hasSource) {
        throw new Error(`Provide either ${fieldName} or source, not both.`)
    }
    if (hasSource) return resolveLlmReplySource(args.source, 'source')
    if (hasLiteral) return requireString(args[fieldName], fieldName)
    throw new Error(`Either ${fieldName} or source is required.`)
}

async function resolveArtifactMarkdownPath(rawPath) {
    if (!path.isAbsolute(rawPath)) {
        throw new Error('mdPath must be an absolute path inside this Codex session artifacts directory.')
    }

    const resolvedPath = path.resolve(rawPath)
    if (path.extname(resolvedPath).toLowerCase() !== '.md') {
        throw new Error('mdPath must point to a .md file.')
    }

    const realPath = await fs.realpath(resolvedPath)
    const sessionsOwnerRoot = path.join(getOpenNovelWriterDataDir(), 'codex', 'sessions', ownerId)
    const realSessionsOwnerRoot = await fs.realpath(sessionsOwnerRoot)
    const relativeToSessions = path.relative(realSessionsOwnerRoot, realPath)
    if (!relativeToSessions || relativeToSessions.startsWith('..') || path.isAbsolute(relativeToSessions)) {
        throw new Error('mdPath must be inside this user Codex sessions directory.')
    }

    const segments = relativeToSessions.split(path.sep)
    const sessionId = segments[0]
    if (!sessionId || segments[1] !== 'artifacts' || segments.length < 3) {
        throw new Error('mdPath must be inside a Codex session artifacts directory.')
    }

    const realArtifactsRoot = await fs.realpath(path.join(realSessionsOwnerRoot, sessionId, 'artifacts'))
    const relativeToArtifacts = path.relative(realArtifactsRoot, realPath)
    if (!relativeToArtifacts || relativeToArtifacts.startsWith('..') || path.isAbsolute(relativeToArtifacts)) {
        throw new Error('mdPath must be inside this Codex session artifacts directory.')
    }

    return { realPath, sessionId }
}

function toSnippetProjectionInput(snippet) {
    return {
        id: snippet.id,
        title: snippet.title,
        content: snippet.content,
        pinned: snippet.pinned,
        createdAt: snippet.createdAt.toISOString(),
        updatedAt: snippet.updatedAt.toISOString(),
    }
}

function inferSnippetTitle(filePath, markdown) {
    const fileTitle = path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (fileTitle) return fileTitle

    const headingMatch = markdown.match(/^#\s+(.+)$/m)
    if (headingMatch?.[1]?.trim()) return headingMatch[1].trim().slice(0, 80)

    const firstLine = markdown.split('\n').find((line) => line.trim())?.trim() ?? ''
    return firstLine.replace(/^#+\s*/, '').slice(0, 80)
}

function calculateWordCountFromHtml(content) {
    const text = htmlToPlainText(content).trim()
    if (!text) return 0

    const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0
    const englishWords = text
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0).length
    return chineseChars + englishWords
}

function htmlToPlainText(html) {
    return String(html ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|h[1-6]|blockquote|pre|li)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
}

function markdownToHtml(source) {
    const blocks = parseMarkdown(source)
    if (blocks.length === 0) return ''
    return blocks.map(renderMarkdownBlockToHtml).join('')
}

function parseMarkdown(source) {
    const normalized = typeof source === 'string' ? source.replace(/\r\n?/g, '\n').trim() : ''
    if (!normalized) return []

    const lines = normalized.split('\n')
    const blocks = []
    let index = 0

    while (index < lines.length) {
        const currentLine = lines[index]
        const trimmed = currentLine.trim()

        if (!trimmed) {
            index += 1
            continue
        }

        const fencedCodeMatch = trimmed.match(/^```([\w-]+)?\s*$/)
        if (fencedCodeMatch) {
            const codeLines = []
            const language = fencedCodeMatch[1]?.trim() || null
            index += 1
            while (index < lines.length && !lines[index].trim().match(/^```\s*$/)) {
                codeLines.push(lines[index])
                index += 1
            }
            if (index < lines.length) index += 1
            blocks.push({ type: 'code', language, content: codeLines.join('\n') })
            continue
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
        if (headingMatch) {
            blocks.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] })
            index += 1
            continue
        }

        if (/^(\*\s*\*\s*\*|-{3,}|_{3,})$/.test(trimmed)) {
            blocks.push({ type: 'rule' })
            index += 1
            continue
        }

        if (/^>\s?/.test(trimmed)) {
            const quoteLines = []
            while (index < lines.length) {
                const quoteLine = lines[index].trim()
                if (!quoteLine.startsWith('>')) break
                quoteLines.push(quoteLine.replace(/^>\s?/, ''))
                index += 1
            }
            blocks.push({ type: 'blockquote', lines: quoteLines })
            continue
        }

        const listMarker = matchListMarker(currentLine)
        if (listMarker) {
            const parsed = parseList(lines, index, getIndentWidth(currentLine), listMarker.ordered)
            blocks.push({ type: 'list', list: parsed.list })
            index = parsed.nextIndex
            continue
        }

        const paragraphLines = []
        while (index < lines.length) {
            const paragraphLine = lines[index]
            const paragraphTrimmed = paragraphLine.trim()
            if (!paragraphTrimmed) break
            if (
                paragraphTrimmed.match(/^```([\w-]+)?\s*$/) ||
                paragraphTrimmed.match(/^(#{1,6})\s+/) ||
                paragraphTrimmed.match(/^(\*\s*\*\s*\*|-{3,}|_{3,})$/) ||
                paragraphTrimmed.startsWith('>') ||
                paragraphTrimmed.match(/^[-*+]\s+/) ||
                paragraphTrimmed.match(/^\d+\.\s+/)
            ) {
                break
            }
            paragraphLines.push(paragraphLine)
            index += 1
        }

        if (paragraphLines.length > 0) {
            blocks.push({ type: 'paragraph', lines: paragraphLines })
            continue
        }

        index += 1
    }

    return blocks
}

function getIndentWidth(line) {
    let width = 0
    for (const char of line) {
        if (char === ' ') {
            width += 1
            continue
        }
        if (char === '\t') {
            width += 4
            continue
        }
        break
    }
    return width
}

function matchListMarker(line) {
    const trimmedStart = line.trimStart()
    const unorderedMatch = trimmedStart.match(/^[-*+]\s+(.+)$/)
    if (unorderedMatch) return { ordered: false, content: unorderedMatch[1] }

    const orderedMatch = trimmedStart.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) return { ordered: true, content: orderedMatch[1] }

    return null
}

function parseList(lines, startIndex, indent, ordered) {
    const items = []
    let index = startIndex

    while (index < lines.length) {
        const line = lines[index]
        if (!line.trim()) break

        const currentIndent = getIndentWidth(line)
        const marker = matchListMarker(line)
        if (!marker || currentIndent < indent || currentIndent > indent || marker.ordered !== ordered) break

        const item = { content: [marker.content], children: [] }
        index += 1

        while (index < lines.length) {
            const nextLine = lines[index]
            if (!nextLine.trim()) break

            const nextIndent = getIndentWidth(nextLine)
            const nextMarker = matchListMarker(nextLine)
            if (nextMarker && nextIndent > indent) {
                const nested = parseList(lines, index, nextIndent, nextMarker.ordered)
                item.children.push(nested.list)
                index = nested.nextIndex
                continue
            }
            if (nextIndent > indent && !nextMarker) {
                item.content.push(nextLine.trim())
                index += 1
                continue
            }
            break
        }

        items.push(item)
    }

    return { list: { ordered, items }, nextIndex: index }
}

function renderMarkdownBlockToHtml(block) {
    if (block.type === 'paragraph') return `<p>${renderMarkdownLinesToHtml(block.lines)}</p>`
    if (block.type === 'blockquote') return `<blockquote>${renderMarkdownLinesToHtml(block.lines)}</blockquote>`
    if (block.type === 'heading') return `<h${block.level}>${renderInlineMarkdownToHtml(block.content)}</h${block.level}>`
    if (block.type === 'rule') return '<hr>'
    if (block.type === 'code') {
        const className = block.language ? ` class="language-${escapeHtml(block.language)}"` : ''
        return `<pre><code${className}>${escapeHtml(block.content)}</code></pre>`
    }
    return renderMarkdownListToHtml(block.list)
}

function renderMarkdownLinesToHtml(lines) {
    return lines.map((line) => renderInlineMarkdownToHtml(line)).join('<br>')
}

function renderMarkdownListToHtml(list) {
    const tag = list.ordered ? 'ol' : 'ul'
    const items = list.items
        .map((item) => {
            const children = item.children.map(renderMarkdownListToHtml).join('')
            return `<li>${renderMarkdownLinesToHtml(item.content)}${children}</li>`
        })
        .join('')
    return `<${tag}>${items}</${tag}>`
}

function renderInlineMarkdownToHtml(text) {
    const matches = [
        [/`([^`\n]+)`/g, 0, (match) => `<code>${escapeHtml(match[1])}</code>`],
        [/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, 1, (match) =>
            `<a href="${escapeHtml(match[2])}" target="_blank" rel="noreferrer noopener">${renderInlineMarkdownToHtml(match[1])}</a>`],
        [/\*\*(.+?)\*\*/g, 2, (match) => `<strong>${renderInlineMarkdownToHtml(match[1])}</strong>`],
        [/__(.+?)__/g, 3, (match) => `<strong>${renderInlineMarkdownToHtml(match[1])}</strong>`],
        [/~~(.+?)~~/g, 4, (match) => `<del>${renderInlineMarkdownToHtml(match[1])}</del>`],
        [/\*(.+?)\*/g, 5, (match) => `<em>${renderInlineMarkdownToHtml(match[1])}</em>`],
        [/_(.+?)_/g, 6, (match) => `<em>${renderInlineMarkdownToHtml(match[1])}</em>`],
    ]

    const parts = []
    let index = 0
    while (index < text.length) {
        const next = getNextInlineMatch(text, index, matches)
        if (!next) {
            parts.push(escapeHtml(text.slice(index)))
            break
        }
        if (next.index > index) parts.push(escapeHtml(text.slice(index, next.index)))
        parts.push(next.render())
        index = next.end
    }
    return parts.join('')
}

function getNextInlineMatch(text, startIndex, patterns) {
    const matches = patterns
        .map(([regex, priority, renderMatch]) => {
            regex.lastIndex = startIndex
            const match = regex.exec(text)
            if (!match) return null
            return {
                index: match.index,
                end: match.index + match[0].length,
                priority,
                render: () => renderMatch(match),
            }
        })
        .filter(Boolean)
    return matches.sort((left, right) => left.index - right.index || left.priority - right.priority)[0] ?? null
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function toolResult(payload) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
    }
}

function sendResult(id, result) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function sendError(id, code, message, data) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } })}\n`)
}
