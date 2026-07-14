'use client'

import { type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, Fragment, createContext, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    ArrowUp,
    BookMarked,
    BookText,
    Bot,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    CircleStop,
    CornerDownRight,
    Copy,
    EllipsisVertical,
    Download,
    FileText,
    FoldVertical,
    ImageIcon,
    Layers,
    ListChecks,
    ListTree,
    Paperclip,
    Pin,
    Plus,
    Pencil,
    Save,
    Undo2,
    ArrowUpRight,
    Search,
    SendHorizonal,
    Shield,
    SlidersHorizontal,
    Sparkles,
    StickyNote,
    ToggleLeft,
    ToggleRight,
    Trash2,
    X,
    Zap,
} from 'lucide-react'
import { AttachmentStrip } from '@/components/image/attachment-strip'
import { ImageThumbnails } from '@/components/image/image-thumbnails'
import {
    ImageViewerBoundary,
    ImageViewerDialog,
    ImageViewerExtraActionsProvider,
} from '@/components/image/image-viewer-dialog'
import { TermGalleryImportButton } from '@/components/editor/terms/term-gallery-import-button'
import { useImageAttachments, type ImageAttachmentError } from '@/components/image/use-image-attachments'
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEditorCodexStore } from '@/components/editor/editor-codex-store'
import { ModelGroupLogoIcon } from '@/components/ai/model-group-logo-icon'
import { type ModelGroup } from '@/lib/ai-store'
import { useAuthStore } from '@/lib/store'
import { canUseCodexFastMode, DEFAULT_CODEX_MODEL, isNativeCodexModelId } from '@/lib/codex-config'
import {
    getCodexRateLimitSummary,
    hasMeaningfulCodexRateLimits,
} from '@/lib/codex-rate-limits'
import { cn } from '@/lib/utils'
import { renderSimpleMarkdown } from '@/lib/simple-markdown'
import { plainTextToSnippetHtml } from '@/lib/snippet-html'
import { type WriteNavTarget } from '@/components/editor/plan-view'
import { actApi, chapterApi, materialApi, outlineApi, sceneEditApi, skillApi, snippetApi, type Act, type Chapter, type MaterialSummary, type OutlineSummary, type Skill, type Snippet } from '@/lib/api'
import { normalizeSkillCategory } from '@/lib/skills'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import type { TermEntry } from '@/components/editor/terms/types'
import { CodexSkillTweakDialog, type CodexRenderedBlock } from '@/components/editor/codex-skill-tweak-dialog'
import { CodexModelPicker } from '@/components/editor/codex-model-picker'
import { CodexTurnNavigator, type CodexTurnNavigatorEntry } from '@/components/editor/codex-turn-navigator'
import { emitSceneEditsChanged } from '@/components/editor/scene-edit-events'
import {
    codexApi,
    codexSessionApi,
    type CodexApprovalOption,
    type CodexApprovalRequest,
    type CodexConnectionSummary,
    type CodexContextWindow,
    type CodexRateLimits,
    type CodexModelCatalogEntry,
    type CodexReasoningEffort,
    type CodexReviewLevel,
    type CodexServiceTier,
    type CodexSessionMessage,
    type CodexPromptArtifact,
} from '@/lib/api'

type RightPanelCodexProps = {
    novelId?: string
    onNavigateToWrite?: (target: WriteNavTarget) => void
}

type CodexPlanStepStatus = 'pending' | 'inProgress' | 'completed'

type CodexPlanStep = {
    step: string
    status: CodexPlanStepStatus
}

type CodexPlanUpdate = {
    explanation: string | null
    plan: CodexPlanStep[]
}

type CodexComposerActionOption = {
    id: string
    label: string
    kind: 'submit' | 'input'
    disabled?: boolean
}

type QueuedCodexMessage = {
    id: string
    content: string
    attachments: string[]
    createdAt: string
}

type CodexJsonArtifact = {
    fileName: string
    originalName: string
    size: number
}

function JsonArtifactChips({
    fileNames,
    className,
}: {
    fileNames: string[] | null | undefined
    className?: string
}) {
    if (!fileNames || fileNames.length === 0) return null

    return (
        <div className={cn('flex flex-wrap justify-end gap-1.5', className)}>
            {fileNames.map((fileName) => (
                <span
                    key={fileName}
                    className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-primary-foreground/25 bg-primary-foreground/10 px-2 py-1 text-xs text-primary-foreground"
                    title={fileName}
                >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="max-w-52 truncate">{fileName}</span>
                </span>
            ))}
        </div>
    )
}

const CODEX_REVIEW_LEVELS: CodexReviewLevel[] = ['user_review', 'auto_review', 'no_review']
const PLAN_COMPOSER_ACTION_OPTIONS: CodexComposerActionOption[] = [
    { id: 'implement', label: 'Yes, implement this plan', kind: 'submit' },
    { id: 'revise', label: 'No, and tell Codex what to do differently', kind: 'input' },
]

function createQueuedCodexMessage(content: string, attachments: string[]): QueuedCodexMessage {
    return {
        id: `codex_queue_${crypto.randomUUID?.() ?? Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
        content,
        attachments,
        createdAt: new Date().toISOString(),
    }
}

function mergeQueuedCodexMessages(messages: QueuedCodexMessage[]) {
    return {
        content: messages
            .map((message) => message.content.trim())
            .filter((content) => content.length > 0)
            .join('\n\n'),
        attachments: [...new Set(messages.flatMap((message) => message.attachments))],
    }
}

function isKeyboardEventComposing(event: { isComposing?: boolean; nativeEvent?: { isComposing?: boolean } }) {
    return Boolean(event.isComposing || event.nativeEvent?.isComposing)
}

function modelSupportsFastMode(models: CodexModelCatalogEntry[], modelId: string) {
    const normalizedModelId = modelId.trim().toLowerCase()
    return models.some(
        (model) => model.id.trim().toLowerCase() === normalizedModelId
            && model.serviceTiers.some((tier) => tier.name.trim().toLowerCase() === 'fast')
    )
}

// The app authenticates API routes with a Bearer token from the auth store, not a
// cookie — raw fetches must attach it or they 401.
function authFetch(input: string, init?: RequestInit) {
    const token = useAuthStore.getState().token
    return fetch(input, {
        ...init,
        headers: {
            ...(init?.headers as Record<string, string> | undefined),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    })
}

/**
 * Expand `@<group name>` mentions in composer text into `[name](model:GROUP_ID)`
 * tokens that Codex understands, just before sending. Longer names are matched
 * first so a prefix group can't shadow a more specific one.
 */
function expandModelMentions(text: string, groups: ModelGroup[]): string {
    if (!text.includes('@') || groups.length === 0) return text
    const sorted = [...groups].sort((a, b) => b.name.length - a.name.length)
    let result = text
    for (const group of sorted) {
        const escaped = group.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => `${prefix}[${group.name}](model:${group.id})`)
    }
    return result
}

/**
 * Convert `@<skill name>` mentions into `[name](skill:SKILL_ID)` tokens (parallel to model
 * mentions) and collect the referenced skill ids so the turn can attach a `skill` input item.
 * The message renderer turns these into pills; the server rewrites them to Codex-native `$name`
 * before running the turn. Longer names are matched first so a prefix skill can't shadow a more
 * specific one. Runs after model-mention expansion.
 */
function expandSkillMentions(text: string, skills: Skill[]): { text: string; skillIds: string[] } {
    if (!text.includes('@') || skills.length === 0) return { text, skillIds: [] }
    const sorted = [...skills].sort((a, b) => b.name.length - a.name.length)
    const skillIds = new Set<string>()
    let result = text
    for (const skill of sorted) {
        const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => {
            skillIds.add(skill.id)
            return `${prefix}[${skill.name}](skill:${skill.id})`
        })
    }
    return { text: result, skillIds: [...skillIds] }
}

/**
 * Convert `@<term title>` mentions into `[title](term:TERM_ID)` tokens. The server rewrites these
 * into an instruction that points Codex at the term's projected `novel/terms/<file>.md`, so the
 * author can hand Codex a glossary entry without it having to hunt for the right file. Longer
 * titles match first so a prefix can't shadow a more specific term. Runs after skill expansion.
 */
function expandTermMentions(text: string, terms: TermEntry[]): string {
    if (!text.includes('@') || terms.length === 0) return text
    const sorted = [...terms].sort((a, b) => b.title.length - a.title.length)
    let result = text
    for (const term of sorted) {
        if (!term.title.trim()) continue
        const escaped = term.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => `${prefix}[${term.title}](term:${term.id})`)
    }
    return result
}

type SnippetMention = { id: string; label: string }

/** Snippets often have no title, so derive a stable display label: the title if present, else the
 * first chunk of content (whitespace collapsed). */
function deriveSnippetLabel(snippet: Snippet): string {
    const title = snippet.title?.trim()
    if (title) return title
    const text = (snippet.content ?? '').replace(/\s+/g, ' ').trim()
    return text.slice(0, 16) || '片段'
}

/** Assign each snippet a unique `@`-mention label. Labels collide rarely (only untitled snippets
 * whose first chars match); when they do, later snippets — in list order — get a `(2)`/`(3)` suffix
 * so `@label` → id stays unambiguous. The composer menu and the submit-time expansion both call
 * this so they always agree. */
function buildSnippetMentionList(snippets: Snippet[]): SnippetMention[] {
    const used = new Set<string>()
    const out: SnippetMention[] = []
    for (const snippet of snippets) {
        const base = deriveSnippetLabel(snippet)
        let label = base
        let suffix = 2
        while (used.has(label)) {
            label = `${base}(${suffix})`
            suffix += 1
        }
        used.add(label)
        out.push({ id: snippet.id, label })
    }
    return out
}

/**
 * Convert `@<snippet label>` mentions into `[label](snippet:SNIPPET_ID)` tokens. The server rewrites
 * these into an instruction that points Codex at the snippet's projected `novel/snippets/<id>.md`.
 * Longer labels match first to avoid prefix shadowing. Runs after term expansion.
 */
function expandSnippetMentions(text: string, snippets: SnippetMention[]): string {
    if (!text.includes('@') || snippets.length === 0) return text
    const sorted = [...snippets].sort((a, b) => b.label.length - a.label.length)
    let result = text
    for (const { id, label } of sorted) {
        if (!label) continue
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => `${prefix}[${label}](snippet:${id})`)
    }
    return result
}

type MaterialMention = { id: string; label: string }

/** Imported materials always have a name (the upload's file name, sans extension), but it can be
 * blank or collide. Derive a stable `@`-mention label: the name if present, else a placeholder. */
function deriveMaterialLabel(material: MaterialSummary): string {
    return material.name?.trim() || '资料'
}

/** Assign each material a unique `@`-mention label, suffixing `(2)`/`(3)` in list order on collision,
 * so `@label` → id stays unambiguous. The composer menu and submit-time expansion both call this so
 * they always agree (mirrors buildSnippetMentionList). */
function buildMaterialMentionList(materials: MaterialSummary[]): MaterialMention[] {
    const used = new Set<string>()
    const out: MaterialMention[] = []
    for (const material of materials) {
        const base = deriveMaterialLabel(material)
        let label = base
        let suffix = 2
        while (used.has(label)) {
            label = `${base}(${suffix})`
            suffix += 1
        }
        used.add(label)
        out.push({ id: material.id, label })
    }
    return out
}

/**
 * Convert `@<material label>` mentions into `[label](material:MATERIAL_ID)` tokens. The server rewrites
 * these into an instruction that points Codex at the material's projected `novel/materials/<id>.md`.
 * Longer labels match first to avoid prefix shadowing. Runs after snippet expansion.
 */
function expandMaterialMentions(text: string, materials: MaterialMention[]): string {
    if (!text.includes('@') || materials.length === 0) return text
    const sorted = [...materials].sort((a, b) => b.label.length - a.label.length)
    let result = text
    for (const { id, label } of sorted) {
        if (!label) continue
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => `${prefix}[${label}](material:${id})`)
    }
    return result
}

type ActMention = { actNumber: number; title: string; label: string }
type ChapterMention = { chapterId: string; number: number; title: string; label: string }

// A title counts as a placeholder when it's just the auto-generated "第 N 卷 / 卷 N / Act N" (or the
// chapter equivalent). For those the mention label shows only the number, with no redundant title.
function isPlaceholderActTitle(title: string): boolean {
    const trimmed = title.trim()
    return !trimmed || /^第\s*\d+\s*卷$/.test(trimmed) || /^卷\s*\d+$/.test(trimmed) || /^Act\s+\d+$/i.test(trimmed)
}

function isPlaceholderChapterTitle(title: string): boolean {
    const trimmed = title.trim()
    return !trimmed || /^第\s*\d+\s*章$/.test(trimmed) || /^章\s*\d+$/.test(trimmed) || /^Chapter\s+\d+$/i.test(trimmed)
}

function formatActMentionLabel(actNumber: number, title: string): string {
    return isPlaceholderActTitle(title) ? `第 ${actNumber} 卷` : `第 ${actNumber} 卷 ${title.trim()}`
}

function formatChapterMentionLabel(chapterNumber: number, title: string): string {
    return isPlaceholderChapterTitle(title) ? `第 ${chapterNumber} 章` : `第 ${chapterNumber} 章 ${title.trim()}`
}

/** Build the `@`-mention list for volumes (acts). Act numbers are unioned from the act rows and the
 * chapters' actNumbers (a volume can exist implicitly via its chapters) and sorted ascending, matching
 * the manuscript outline. The display number is the act number itself. */
function buildActMentionList(acts: Act[], chapters: Chapter[]): ActMention[] {
    const titleByNumber = new Map<number, string>()
    for (const act of acts) titleByNumber.set(act.number, act.title ?? '')
    const numbers = new Set<number>()
    for (const act of acts) numbers.add(act.number)
    for (const chapter of chapters) numbers.add(chapter.actNumber)
    return [...numbers]
        .sort((a, b) => a - b)
        .map((actNumber) => {
            const title = titleByNumber.get(actNumber) ?? ''
            return { actNumber, title, label: formatActMentionLabel(actNumber, title) }
        })
}

/** Build the `@`-mention list for chapters, numbered by global chapter index (chapters sorted by
 * actNumber then order) — the same numbering shown in the editor's table of contents. */
function buildChapterMentionList(chapters: Chapter[]): ChapterMention[] {
    const sorted = [...chapters].sort((a, b) => {
        if (a.actNumber !== b.actNumber) return a.actNumber - b.actNumber
        return a.order - b.order
    })
    return sorted.map((chapter, index) => {
        const number = index + 1
        const title = chapter.title ?? ''
        return { chapterId: chapter.id, number, title, label: formatChapterMentionLabel(number, title) }
    })
}

/**
 * Convert `@<volume label>` mentions into `[label](act:ACT_NUMBER)` tokens. The server rewrites these
 * into an instruction pointing Codex at the volume's section in novel/outline.md. Longer labels match
 * first to avoid prefix shadowing. Runs after snippet expansion.
 */
function expandActMentions(text: string, acts: ActMention[]): string {
    if (!text.includes('@') || acts.length === 0) return text
    const sorted = [...acts].sort((a, b) => b.label.length - a.label.length)
    let result = text
    for (const { actNumber, label } of sorted) {
        if (!label) continue
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => `${prefix}[${label}](act:${actNumber})`)
    }
    return result
}

/**
 * Convert `@<chapter label>` mentions into `[label](chapter:CHAPTER_ID)` tokens. The server rewrites
 * these into an instruction pointing Codex at novel/chapters/<id>.md. Longer labels match first to
 * avoid prefix shadowing. Runs after volume expansion.
 */
function expandChapterMentions(text: string, chapters: ChapterMention[]): string {
    if (!text.includes('@') || chapters.length === 0) return text
    const sorted = [...chapters].sort((a, b) => b.label.length - a.label.length)
    let result = text
    for (const { chapterId, label } of sorted) {
        if (!label) continue
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        result = result.replace(regex, (_match, prefix) => `${prefix}[${label}](chapter:${chapterId})`)
    }
    return result
}

// A detailed outline (细纲) mention targets the 章纲 of a chapter (by chapterId) or the 卷纲 of a
// volume (by actNumber). `number` is the chapter's global index / the act number, used for numeric
// `@5` matching. Only chapters/acts that actually have a non-empty 细纲 become mentions.
type DetailedOutlineMention =
    | { targetKind: 'chapter'; chapterId: string; number: number; label: string }
    | { targetKind: 'act'; actNumber: number; number: number; label: string }

/** Build the `@`-mention list for detailed outlines (细纲). Reuses the chapter/volume numbering and
 * labels and appends "细纲" to the label so it reads as e.g. "第 5 章 标题 细纲". Lists every chapter/act
 * that has an outline ROW — matching the 细纲 sidebar, which keys on existence, not content. An empty
 * (0-word) 细纲 the author created still appears so it can be referenced (the server words an empty
 * reference as a write target rather than a read). Ordered as `outlines` comes back from the API. */
function buildDetailedOutlineMentionList(
    outlines: OutlineSummary[],
    chapters: Chapter[],
    acts: Act[]
): DetailedOutlineMention[] {
    const chapterById = new Map(buildChapterMentionList(chapters).map((chapter) => [chapter.chapterId, chapter]))
    const actByNumber = new Map(buildActMentionList(acts, chapters).map((act) => [act.actNumber, act]))
    const out: DetailedOutlineMention[] = []
    for (const outline of outlines) {
        if (outline.type === 'CHAPTER' && outline.chapterId) {
            const chapter = chapterById.get(outline.chapterId)
            if (!chapter) continue
            out.push({ targetKind: 'chapter', chapterId: chapter.chapterId, number: chapter.number, label: `${chapter.label} 细纲` })
        } else if (outline.type === 'ACT' && outline.actNumber != null) {
            const act = actByNumber.get(outline.actNumber)
            const baseLabel = act?.label ?? `第 ${outline.actNumber} 卷`
            out.push({ targetKind: 'act', actNumber: outline.actNumber, number: outline.actNumber, label: `${baseLabel} 细纲` })
        }
    }
    return out
}

/**
 * Convert `@<细纲 label>` mentions into `[label](outlineChapter:CHAPTER_ID)` /
 * `[label](outlineAct:ACT_NUMBER)` tokens. The server rewrites these into an instruction pointing
 * Codex at novel/DetailedOutline/{chapters,acts}/<id>.md. Longer labels match first. MUST run before
 * the act/chapter expansion: a 细纲 label ("第 5 章 标题 细纲") is a superstring of the chapter label
 * ("第 5 章 标题"), so expanding 细纲 first stops the chapter pass from clipping it.
 */
function expandDetailedOutlineMentions(text: string, outlines: DetailedOutlineMention[]): string {
    if (!text.includes('@') || outlines.length === 0) return text
    const sorted = [...outlines].sort((a, b) => b.label.length - a.label.length)
    let result = text
    for (const outline of sorted) {
        if (!outline.label) continue
        const escaped = outline.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[，。、,.!?;:；])`, 'g')
        const token = outline.targetKind === 'chapter'
            ? `outlineChapter:${outline.chapterId}`
            : `outlineAct:${outline.actNumber}`
        result = result.replace(regex, (_match, prefix) => `${prefix}[${outline.label}](${token})`)
    }
    return result
}

type MentionItem =
    | { kind: 'model'; group: ModelGroup }
    | { kind: 'skill'; skill: Skill }
    | { kind: 'term'; term: TermEntry }
    | { kind: 'snippet'; snippet: SnippetMention }
    | { kind: 'material'; material: MaterialMention }
    | { kind: 'detailedOutline'; outline: DetailedOutlineMention }
    | { kind: 'act'; act: ActMention }
    | { kind: 'chapter'; chapter: ChapterMention }

function mentionItemName(item: MentionItem) {
    if (item.kind === 'model') return item.group.name
    if (item.kind === 'skill') return item.skill.name
    if (item.kind === 'term') return item.term.title
    if (item.kind === 'snippet') return item.snippet.label
    if (item.kind === 'material') return item.material.label
    if (item.kind === 'detailedOutline') return item.outline.label
    if (item.kind === 'act') return item.act.label
    return item.chapter.label
}

type ComposerMentionKind = MentionItem['kind']
type ComposerMentionTarget = { name: string; kind: ComposerMentionKind }
type ComposerSegment =
    | { type: 'text'; text: string }
    | { type: 'mention'; text: string; kind: ComposerMentionKind }

const MENTION_BOUNDARY_CHARS = '，。、,.!?;:；'

/**
 * Split composer text into plain segments and `@<group name>` mention segments,
 * for the highlight overlay rendered behind the textarea. Segments concatenate
 * back to the exact original text so the overlay stays glyph-aligned with the
 * textarea (the caret depends on this). Longer names win to avoid prefix shadowing.
 */
function buildComposerSegments(value: string, mentionTargets: ComposerMentionTarget[]): ComposerSegment[] {
    if (!value) return []
    const targets = [...mentionTargets].sort((a, b) => b.name.length - a.name.length)
    const segments: ComposerSegment[] = []
    let buffer = ''
    let index = 0

    const flush = () => {
        if (buffer) {
            segments.push({ type: 'text', text: buffer })
            buffer = ''
        }
    }

    while (index < value.length) {
        const atBoundary = index === 0 || /\s/.test(value[index - 1])
        if (value[index] === '@' && atBoundary && targets.length > 0) {
            const matched = targets.find((target) => {
                if (!value.startsWith(`@${target.name}`, index)) return false
                const after = value[index + 1 + target.name.length]
                return after === undefined || /\s/.test(after) || MENTION_BOUNDARY_CHARS.includes(after)
            })
            if (matched) {
                flush()
                segments.push({ type: 'mention', text: `@${matched.name}`, kind: matched.kind })
                index += 1 + matched.name.length
                continue
            }
        }
        buffer += value[index]
        index += 1
    }
    flush()

    return segments
}

/**
 * Detect an in-progress `@mention` ending at the caret. Returns the `@` start
 * offset and the query typed after it (no whitespace), or null when the caret is
 * not inside a fresh mention token.
 */
function detectMentionAtCaret(value: string, caret: number): { start: number; query: string } | null {
    let index = caret - 1
    while (index >= 0) {
        const char = value[index]
        if (char === '@') {
            const before = index === 0 ? '' : value[index - 1]
            if (index === 0 || /\s/.test(before)) {
                const query = value.slice(index + 1, caret)
                if (/^\S*$/.test(query)) return { start: index, query }
            }
            return null
        }
        if (/\s/.test(char)) return null
        index -= 1
    }
    return null
}

/**
 * When the caret sits right after a completed `@mention` (or right after the single space that was
 * auto-inserted with it), return the range to delete so Backspace removes the whole token at once
 * instead of nibbling one character at a time. Returns null when the caret is not at a mention edge.
 */
function findMentionTokenToDeleteBeforeCaret(
    value: string,
    caret: number,
    mentionTargets: ComposerMentionTarget[]
): { start: number; end: number } | null {
    if (caret <= 0 || mentionTargets.length === 0) return null
    const segments = buildComposerSegments(value, mentionTargets)
    let offset = 0
    for (const segment of segments) {
        const start = offset
        const end = offset + segment.text.length
        if (segment.type === 'mention') {
            if (caret === end) return { start, end: caret }
            // Caret just past the token's single trailing space — drop the token and that space.
            if (caret === end + 1 && value[end] === ' ') return { start, end: caret }
        }
        offset = end
    }
    return null
}

function getComposerMentionTextClass(kind: ComposerMentionKind) {
    if (kind === 'model') return 'text-sky-700 dark:text-sky-300'
    if (kind === 'skill') return 'text-violet-700 dark:text-violet-300'
    if (kind === 'term') return 'text-emerald-700 dark:text-emerald-300'
    if (kind === 'snippet') return 'text-amber-700 dark:text-amber-300'
    if (kind === 'material') return 'text-cyan-700 dark:text-cyan-300'
    if (kind === 'detailedOutline') return 'text-rose-700 dark:text-rose-300'
    if (kind === 'act') return 'text-indigo-700 dark:text-indigo-300'
    return 'text-orange-700 dark:text-orange-300'
}

function createOptimisticSteerMessage(content: string, attachments: string[]): CodexSessionMessage {
    return {
        id: `codex_optimistic_steer_${crypto.randomUUID?.() ?? Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
        role: 'event',
        kind: 'steer',
        content: ['Steered conversation', content].join('\n\n'),
        attachments,
        createdAt: new Date().toISOString(),
    }
}

function mergeTimelineMessages(
    messages: CodexSessionMessage[],
    optimisticSteerMessages: CodexSessionMessage[]
) {
    if (optimisticSteerMessages.length === 0) return messages

    return [...messages, ...optimisticSteerMessages]
}

function normalizePlanStepStatus(value: unknown): CodexPlanStepStatus {
    if (value === 'in_progress') return 'inProgress'
    if (value === 'inProgress' || value === 'completed') return value
    return 'pending'
}

function parsePlanUpdate(content: string): CodexPlanUpdate {
    try {
        const parsed = JSON.parse(content) as unknown
        if (!parsed || typeof parsed !== 'object') return { explanation: null, plan: [] }
        const record = parsed as Record<string, unknown>
        const explanation = typeof record.explanation === 'string' && record.explanation.trim()
            ? record.explanation.trim()
            : null
        const plan = Array.isArray(record.plan)
            ? record.plan
                .map((item): CodexPlanStep | null => {
                    if (!item || typeof item !== 'object') return null
                    const stepRecord = item as Record<string, unknown>
                    if (typeof stepRecord.step !== 'string' || !stepRecord.step.trim()) return null
                    return {
                        step: stepRecord.step.trim(),
                        status: normalizePlanStepStatus(stepRecord.status),
                    }
                })
                .filter((item): item is CodexPlanStep => item !== null)
            : []

        return { explanation, plan }
    } catch {
        return { explanation: null, plan: [] }
    }
}

function formatEventTitleForDisplay(value: string) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (normalized.length <= 96) return normalized
    return `${normalized.slice(0, 93)}...`
}

function isPinnedPlanUpdateMessage(message: CodexSessionMessage) {
    return message.role === 'event' && message.kind === 'plan_update'
}

function isWorkEvent(message: CodexSessionMessage) {
    return message.role === 'event' && (
        message.kind === 'command' ||
        message.kind === 'tool' ||
        message.kind === 'file' ||
        message.kind === 'web_search'
    )
}

function formatWorkEventSummary(messages: CodexSessionMessage[]) {
    const commands = messages.filter((message) => message.kind === 'command').length
    const tools = messages.filter((message) => message.kind === 'tool').length
    const files = messages.filter((message) => message.kind === 'file').length
    const webSearches = messages.filter((message) => message.kind === 'web_search').length
    const parts: string[] = []
    if (commands) parts.push(`${commands} command${commands === 1 ? '' : 's'}`)
    if (tools) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`)
    if (files) parts.push(`${files} file change${files === 1 ? '' : 's'}`)
    if (webSearches) parts.push(`${webSearches} web search${webSearches === 1 ? '' : 'es'}`)
    return parts.length ? `Worked: ${parts.join(', ')}` : `Worked: ${messages.length} event${messages.length === 1 ? '' : 's'}`
}

function getMessageTime(message: CodexSessionMessage) {
    const time = new Date(message.createdAt).getTime()
    return Number.isFinite(time) ? time : null
}

function formatDuration(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
}

function formatCompactTokenCount(value: number) {
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`
    if (value >= 1_000) return `${Math.round(value / 1000)}k`
    return `${value}`
}

function formatTokenCount(value: number) {
    return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

function getTurnDurationLabel(messages: CodexSessionMessage[], running: boolean, now: number) {
    const startedAt = getMessageTime(messages[0]!)
    if (startedAt === null) return running ? 'Working' : 'Worked'

    const messageTimes = messages
        .map(getMessageTime)
        .filter((time): time is number => time !== null)
    const endedAt = running ? now : Math.max(startedAt, ...messageTimes)
    return `${running ? 'Working for' : 'Worked for'} ${formatDuration(endedAt - startedAt)}`
}

function getLatestContextWindow(messages: CodexSessionMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const contextWindow = messages[index]?.contextWindow
        if (contextWindow) return contextWindow
    }
    return null
}

type ApprovalTranslate = (key: string, values?: Record<string, string | number>) => string

function getApprovalTitle(approval: CodexApprovalRequest, t: ApprovalTranslate) {
    switch (approval.kind) {
        case 'command':
            return approval.command
                ? t('codex.approval.titleCommandNamed', { command: approval.command })
                : t('codex.approval.titleCommand')
        case 'file':
            return t('codex.approval.titleFile')
        case 'permissions':
            return t('codex.approval.titlePermissions')
        case 'elicitation':
            return approval.server
                ? t('codex.approval.titleElicitationNamed', { server: approval.server })
                : t('codex.approval.titleElicitation')
        case 'tool': {
            const tool = [approval.server, approval.tool].filter(Boolean).join('.')
            return tool ? t('codex.approval.titleToolNamed', { tool }) : t('codex.approval.titleTool')
        }
        default:
            return approval.title || t('codex.approval.titleFallback')
    }
}

function getApprovalComposerOptions(approval: CodexApprovalRequest, t: ApprovalTranslate): CodexComposerActionOption[] {
    const options: CodexComposerActionOption[] = []
    if (approval.options.includes('accept')) {
        options.push({ id: 'accept', label: t('codex.approval.yes'), kind: 'submit' })
    }
    if (approval.options.includes('acceptForSession')) {
        options.push({ id: 'acceptForSession', label: t('codex.approval.acceptForSession'), kind: 'submit' })
    }
    if (approval.options.includes('acceptWithPolicy') && approval.proposedPolicy?.length) {
        options.push({
            id: 'acceptWithPolicy',
            label: t('codex.approval.acceptWithPolicy', { policy: approval.proposedPolicy.join(' ') }),
            kind: 'submit',
        })
    }
    if (approval.options.includes('steer')) {
        options.push({ id: 'steer', label: t('codex.approval.steer'), kind: 'input' })
    }
    return options.length ? options : [{ id: 'decline', label: t('codex.approval.decline'), kind: 'submit' }]
}

// The tool identity is shown on its own line, so drop the `run tool "<name>"` prefix Codex (and our
// elicitation message) carry — what stays is the human-readable confirmation sentence.
function stripRunToolPrefix(message: string) {
    return message.replace(/^\s*run tool\s+"[^"]+"\s*[:：.。、]?\s*/i, '').trim()
}

function getApprovalDetail(approval: CodexApprovalRequest) {
    const parts: string[] = []
    if (approval.command) parts.push(approval.command)
    if (approval.server || approval.tool) parts.push([approval.server, approval.tool].filter(Boolean).join('.'))
    if (approval.detail) parts.push(approval.kind === 'elicitation' ? stripRunToolPrefix(approval.detail) : approval.detail)
    if (approval.cwd) parts.push(`cwd: ${approval.cwd}`)
    return parts.filter(Boolean).join('\n\n')
}

const CodexNavContext = createContext<((target: WriteNavTarget) => void) | undefined>(undefined)
const CodexNovelIdContext = createContext<string | undefined>(undefined)
const CodexSessionIdContext = createContext<string | null>(null)

const SCENE_EDIT_TOOL_TITLE = 'edit_scene_content'

type SceneEditHunk = { id: string; beforeText: string; afterText: string }
type SceneEditToolResult = {
    sceneId: string
    chapterId: string
    actNumber: number
    applied: SceneEditHunk[]
    failedCount: number
}

// The timeline message for an MCP tool call is "<server>.<tool>\n\n<JSON result>", and the
// JSON is an MCP envelope ({ content: [{ text: "<our JSON payload>" }] }). Dig out our payload.
function findSceneEditPayload(value: unknown, depth = 0): SceneEditToolResult | null {
    if (!value || depth > 6) return null
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (Array.isArray(record.applied) && typeof record.sceneId === 'string') {
            const applied = (record.applied as unknown[])
                .map((item) => {
                    const hunk = item as Record<string, unknown>
                    if (typeof hunk?.id !== 'string') return null
                    return {
                        id: hunk.id,
                        beforeText: typeof hunk.beforeText === 'string' ? hunk.beforeText : '',
                        afterText: typeof hunk.afterText === 'string' ? hunk.afterText : '',
                    }
                })
                .filter((item): item is SceneEditHunk => item !== null)
            if (applied.length === 0) return null
            return {
                sceneId: record.sceneId,
                chapterId: typeof record.chapterId === 'string' ? record.chapterId : '',
                actNumber: typeof record.actNumber === 'number' ? record.actNumber : 1,
                applied,
                failedCount: typeof record.failedCount === 'number' ? record.failedCount : 0,
            }
        }
        for (const child of Object.values(record)) {
            const found = findSceneEditPayload(child, depth + 1)
            if (found) return found
        }
        return null
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
        try {
            return findSceneEditPayload(JSON.parse(trimmed), depth + 1)
        } catch {
            return null
        }
    }
    return null
}

function parseSceneEditToolMessage(message: CodexSessionMessage): SceneEditToolResult | null {
    if (message.role !== 'event' || message.kind !== 'tool') return null
    if (!message.content.includes(SCENE_EDIT_TOOL_TITLE)) return null
    const jsonStart = message.content.indexOf('{')
    if (jsonStart < 0) return null
    return findSceneEditPayload(message.content.slice(jsonStart))
}

function isSceneEditToolMessage(message: CodexSessionMessage): boolean {
    return parseSceneEditToolMessage(message) !== null
}

function resolveNavTarget(navType: string | null, navId: string): WriteNavTarget | null {
    if (navType === 'act') {
        const actNumber = Number(navId)
        return Number.isFinite(actNumber) ? { kind: 'act', actNumber } : null
    }
    if (navType === 'chapter') {
        return navId ? { kind: 'chapter', chapterId: navId } : null
    }
    if (navType === 'scene') {
        const [chapterId, sceneId] = navId.split(':')
        return chapterId && sceneId ? { kind: 'scene', chapterId, sceneId } : null
    }
    if (navType === 'continuation') {
        // continuation:chapterId:sceneId:panelId — navigate to the scene holding the panel.
        const [chapterId, sceneId] = navId.split(':')
        return chapterId && sceneId ? { kind: 'scene', chapterId, sceneId } : null
    }
    return null
}

function parseLlmTarget(target: string): { path: string; index: number } {
    const hashIndex = target.lastIndexOf('#')
    if (hashIndex < 0) return { path: target, index: -1 }
    const rawIndex = target.slice(hashIndex + 1)
    const path = target.slice(0, hashIndex)
    const index = /^-?\d+$/.test(rawIndex) ? Number(rawIndex) : -1
    return { path, index }
}

function CodexLlmArtifactRef({ target }: { target: string; label: string }) {
    const sessionId = useContext(CodexSessionIdContext)
    const { path: artifactPath, index } = useMemo(() => parseLlmTarget(target), [target])
    const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; content?: string; error?: string }>({
        status: 'loading',
    })
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        if (!sessionId) return
        let cancelled = false
        const url = `/api/codex/sessions/${encodeURIComponent(sessionId)}/llm-artifact?path=${encodeURIComponent(
            artifactPath
        )}&index=${index}`
        void (async () => {
            try {
                const response = await authFetch(url)
                const data = await response.json().catch(() => null)
                if (cancelled) return
                if (!response.ok || !data?.ok || typeof data.content !== 'string') {
                    setState({ status: 'error', error: data?.detail ?? 'Failed to load model reply' })
                    return
                }
                setState({ status: 'ready', content: data.content })
            } catch {
                if (!cancelled) setState({ status: 'error', error: 'Failed to load model reply' })
            }
        })()
        return () => {
            cancelled = true
        }
    }, [sessionId, artifactPath, index, reloadKey])

    return (
        <div className="my-2 overflow-hidden rounded-xl border bg-background/60">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Model reply</span>
                <button
                    type="button"
                    className="rounded p-0.5 hover:bg-muted"
                    title="Reload"
                    onClick={() => setReloadKey((key) => key + 1)}
                >
                    <Undo2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="px-3 py-2 text-sm">
                {!sessionId && <span className="text-destructive">No active session</span>}
                {sessionId && state.status === 'loading' && (
                    <span className="text-muted-foreground">Loading model reply…</span>
                )}
                {sessionId && state.status === 'error' && (
                    <span className="text-destructive">{state.error ?? 'Failed to load model reply'}</span>
                )}
                {sessionId && state.status === 'ready' && (
                    <CodexMarkdown content={state.content ?? ''} embedLlm={false} />
                )}
            </div>
        </div>
    )
}

// Matches the inline tokens that can appear in a user message: model/skill mentions
// (rendered as pills) and chapter/act/scene jump links (rendered as clickable nav links).
const USER_MENTION_RE = /\[([^\]]+)\]\((model|skill|term|snippet|material|outlineChapter|outlineAct|chapter|act|scene|continuation):([^)]+)\)/g

function UserMessageContent({ content }: { content: string }) {
    const onNavigate = useContext(CodexNavContext)

    const nodes = useMemo(() => {
        const out: ReactNode[] = []
        const regex = new RegExp(USER_MENTION_RE)
        let lastIndex = 0
        let key = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
            if (match.index > lastIndex) {
                out.push(<span key={`text-${key++}`}>{content.slice(lastIndex, match.index)}</span>)
            }
            const label = match[1]
            const kind = match[2]
            const target = match[3]
            if (kind === 'model' || kind === 'skill' || kind === 'term' || kind === 'snippet' || kind === 'material' || kind === 'outlineChapter' || kind === 'outlineAct') {
                out.push(
                    <span
                        key={`mention-${key++}`}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/20 px-1.5 py-0.5 text-[0.85em] font-medium"
                    >
                        {kind === 'skill' ? <Sparkles className="h-3 w-3 shrink-0" /> : null}
                        {kind === 'term' ? <BookMarked className="h-3 w-3 shrink-0" /> : null}
                        {kind === 'snippet' ? <StickyNote className="h-3 w-3 shrink-0" /> : null}
                        {kind === 'material' ? <FileText className="h-3 w-3 shrink-0" /> : null}
                        {kind === 'outlineChapter' || kind === 'outlineAct' ? <ListTree className="h-3 w-3 shrink-0" /> : null}
                        @{label}
                    </span>
                )
            } else if (kind === 'act' || kind === 'chapter') {
                // Volume/chapter mentions from the composer render as a pill (like terms/snippets) but
                // stay clickable, so the author can jump to the referenced volume/chapter.
                const navTarget = resolveNavTarget(kind, target)
                const clickable = Boolean(onNavigate && navTarget)
                out.push(
                    <span
                        key={`mention-${key++}`}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-md bg-primary-foreground/20 px-1.5 py-0.5 text-[0.85em] font-medium',
                            clickable ? 'cursor-pointer hover:bg-primary-foreground/30' : ''
                        )}
                        onClick={clickable && navTarget ? () => onNavigate?.(navTarget) : undefined}
                    >
                        {kind === 'act' ? <Layers className="h-3 w-3 shrink-0" /> : <BookText className="h-3 w-3 shrink-0" />}
                        @{label}
                    </span>
                )
            } else {
                const navTarget = resolveNavTarget(kind, target)
                out.push(
                    <span
                        key={`nav-${key++}`}
                        role={onNavigate && navTarget ? 'button' : undefined}
                        tabIndex={onNavigate && navTarget ? 0 : undefined}
                        className={cn(
                            'underline underline-offset-2 decoration-primary-foreground/50',
                            onNavigate && navTarget ? 'cursor-pointer' : ''
                        )}
                        onClick={onNavigate && navTarget ? () => onNavigate(navTarget) : undefined}
                    >
                        {label}
                    </span>
                )
            }
            lastIndex = match.index + match[0].length
        }
        if (lastIndex < content.length) {
            out.push(<span key={`text-${key++}`}>{content.slice(lastIndex)}</span>)
        }
        return out
    }, [content, onNavigate])

    return <div className="whitespace-pre-wrap break-words">{nodes}</div>
}

function CodexMentionMenu({
    items,
    activeIndex,
    loading,
    onSelect,
    onHover,
}: {
    items: MentionItem[]
    activeIndex: number
    loading: boolean
    onSelect: (item: MentionItem) => void
    onHover: (index: number) => void
}) {
    const firstSkillIndex = items.findIndex((item) => item.kind === 'skill')
    const firstTermIndex = items.findIndex((item) => item.kind === 'term')
    const firstSnippetIndex = items.findIndex((item) => item.kind === 'snippet')
    const firstMaterialIndex = items.findIndex((item) => item.kind === 'material')
    const firstDetailedOutlineIndex = items.findIndex((item) => item.kind === 'detailedOutline')
    const firstActIndex = items.findIndex((item) => item.kind === 'act')
    const firstChapterIndex = items.findIndex((item) => item.kind === 'chapter')
    return (
        <div className="absolute bottom-full left-2 right-2 z-50 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg">
            <div className="max-h-60 overflow-y-auto pb-1">
                {loading && <div className="px-3 py-2 text-sm text-muted-foreground">加载中…</div>}
                {!loading && items.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">没有匹配的模型组、技能、词条、片段、资料、细纲、卷或章</div>
                )}
                {items.map((item, index) => {
                    const isModel = item.kind === 'model'
                    const showLlmHeader = index === 0 && isModel
                    const showSkillHeader = index === firstSkillIndex && item.kind === 'skill'
                    const showTermHeader = index === firstTermIndex && item.kind === 'term'
                    const showSnippetHeader = index === firstSnippetIndex && item.kind === 'snippet'
                    const showMaterialHeader = index === firstMaterialIndex && item.kind === 'material'
                    const showDetailedOutlineHeader = index === firstDetailedOutlineIndex && item.kind === 'detailedOutline'
                    const showActHeader = index === firstActIndex && item.kind === 'act'
                    const showChapterHeader = index === firstChapterIndex && item.kind === 'chapter'
                    const key =
                        item.kind === 'model'
                            ? `model:${item.group.id}`
                            : item.kind === 'skill'
                                ? `skill:${item.skill.id}`
                                : item.kind === 'term'
                                    ? `term:${item.term.id}`
                                    : item.kind === 'snippet'
                                        ? `snippet:${item.snippet.id}`
                                        : item.kind === 'material'
                                            ? `material:${item.material.id}`
                                            : item.kind === 'detailedOutline'
                                                ? `detailedOutline:${item.outline.targetKind === 'chapter' ? `c:${item.outline.chapterId}` : `a:${item.outline.actNumber}`}`
                                                : item.kind === 'act'
                                                    ? `act:${item.act.actNumber}`
                                                    : `chapter:${item.chapter.chapterId}`
                    return (
                        <Fragment key={key}>
                            {showLlmHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    LLM
                                </div>
                            )}
                            {showSkillHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Skills
                                </div>
                            )}
                            {showTermHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Terms
                                </div>
                            )}
                            {showSnippetHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Snippets
                                </div>
                            )}
                            {showMaterialHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    资料
                                </div>
                            )}
                            {showDetailedOutlineHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    细纲
                                </div>
                            )}
                            {showActHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Volumes
                                </div>
                            )}
                            {showChapterHeader && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Chapters
                                </div>
                            )}
                            <button
                                type="button"
                                className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                                    index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                                )}
                                onMouseEnter={() => onHover(index)}
                                onMouseDown={(event) => {
                                    event.preventDefault()
                                    onSelect(item)
                                }}
                            >
                                {item.kind === 'model' ? (
                                    <ModelGroupLogoIcon group={item.group} className="h-5 w-5" />
                                ) : item.kind === 'skill' ? (
                                    <Sparkles className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : item.kind === 'term' ? (
                                    <BookMarked className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : item.kind === 'snippet' ? (
                                    <StickyNote className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : item.kind === 'material' ? (
                                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : item.kind === 'detailedOutline' ? (
                                    <ListTree className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : item.kind === 'act' ? (
                                    <Layers className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : (
                                    <BookText className="h-5 w-5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1 truncate">{mentionItemName(item)}</span>
                            </button>
                        </Fragment>
                    )
                })}
            </div>
        </div>
    )
}

// A standalone line that is only an `[label](llm:target)` reference. These become
// block-level model-reply cards; everything else renders as normal markdown. This
// keeps the card (a <div>) out of a <p>, which would be invalid HTML.
const LLM_BLOCK_LINE_RE = /^[ \t]*\[([^\]]+)\]\(llm:([^\s)]+)\)[ \t]*$/

type CodexMarkdownBlock =
    | { type: 'md'; text: string }
    | { type: 'llm'; target: string; label: string }

function splitLlmBlocks(content: string): CodexMarkdownBlock[] {
    const lines = content.replace(/\r\n?/g, '\n').split('\n')
    const blocks: CodexMarkdownBlock[] = []
    let buffer: string[] = []

    const flush = () => {
        const text = buffer.join('\n')
        if (text.trim()) blocks.push({ type: 'md', text })
        buffer = []
    }

    for (const line of lines) {
        const match = line.match(LLM_BLOCK_LINE_RE)
        if (match) {
            flush()
            blocks.push({ type: 'llm', label: match[1], target: match[2] })
            continue
        }
        buffer.push(line)
    }
    flush()

    return blocks
}

function CodexMarkdown({ content, embedLlm = true }: { content: string; embedLlm?: boolean }) {
    const blocks = useMemo(
        () => (embedLlm ? splitLlmBlocks(content) : [{ type: 'md', text: content } as CodexMarkdownBlock]),
        [content, embedLlm]
    )
    const onNavigate = useContext(CodexNavContext)

    const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!onNavigate) return
        const anchor = (event.target as HTMLElement).closest<HTMLElement>('[data-onw-nav]')
        if (!anchor) return
        const target = resolveNavTarget(anchor.getAttribute('data-onw-nav'), anchor.getAttribute('data-onw-nav-id') ?? '')
        if (!target) return
        event.preventDefault()
        onNavigate(target)
    }

    return (
        <div
            onClick={onNavigate ? handleClick : undefined}
            className={cn(
                'prose prose-sm min-w-0 max-w-full overflow-hidden break-words text-inherit [overflow-wrap:anywhere]',
                'prose-p:my-0 prose-headings:my-1 prose-ol:my-3 prose-ul:my-3 prose-li:my-1',
                'prose-pre:my-3 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-muted prose-pre:px-4 prose-pre:py-3',
                'prose-code:rounded prose-code:bg-muted/80 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.9em]',
                'prose-code:before:content-none prose-code:after:content-none',
                'prose-blockquote:my-3 prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4',
                'prose-a:text-primary prose-strong:text-inherit prose-headings:text-inherit',
                '[&_a]:break-all [&_a]:[overflow-wrap:anywhere]',
                '[&_code]:break-words [&_code]:[overflow-wrap:anywhere]',
                '[&_em]:break-words [&_em]:[overflow-wrap:anywhere]',
                '[&_li]:break-words [&_li]:[overflow-wrap:anywhere]',
                '[&_p]:break-words [&_p]:[overflow-wrap:anywhere]',
                '[&_strong]:break-words [&_strong]:[overflow-wrap:anywhere]'
            )}
        >
            <ImageViewerBoundary>
                {blocks.map((block, index) =>
                    block.type === 'llm' ? (
                        <CodexLlmArtifactRef key={`llm-${index}`} target={block.target} label={block.label} />
                    ) : (
                        <Fragment key={`md-${index}`}>{renderSimpleMarkdown(block.text)}</Fragment>
                    )
                )}
            </ImageViewerBoundary>
        </div>
    )
}

function ContextWindowIndicator({ contextWindow }: { contextWindow: CodexContextWindow | null }) {
    const hasContextWindow = Boolean(contextWindow && contextWindow.totalTokens > 0)
    const usedPercent = hasContextWindow ? Math.min(100, Math.max(0, Math.round(contextWindow!.usagePercent))) : 0
    const leftPercent = Math.max(0, 100 - usedPercent)
    const background = `conic-gradient(currentColor ${usedPercent * 3.6}deg, transparent 0deg)`

    return (
        <div className="group relative flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
            <div
                className={cn(
                    'h-4 w-4 rounded-full border text-muted-foreground',
                    hasContextWindow ? 'border-muted-foreground/40' : 'border-muted-foreground/50 opacity-70'
                )}
                style={{ background }}
                aria-label={hasContextWindow ? `Context window: ${usedPercent}% used` : 'Context window unavailable'}
            >
                <div className="m-[3px] h-2 w-2 rounded-full bg-background" />
            </div>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-center text-popover-foreground shadow-lg group-hover:block">
                <div className="text-xs text-muted-foreground">Context window:</div>
                {hasContextWindow ? (
                    <>
                        <div className="mt-1 text-sm font-medium">
                            {usedPercent}% used ({leftPercent}% left)
                        </div>
                        <div className="mt-1 text-sm">
                            {formatCompactTokenCount(contextWindow!.usedTokens)} / {formatCompactTokenCount(contextWindow!.totalTokens)} tokens used
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                            {formatTokenCount(contextWindow!.remainingTokens)} tokens left
                        </div>
                    </>
                ) : (
                    <div className="mt-1 text-sm text-muted-foreground">
                        No context data yet
                    </div>
                )}
            </div>
        </div>
    )
}

function ProposedPlanEvent({ content }: { content: string }) {
    const [collapsed, setCollapsed] = useState(true)
    const [copied, setCopied] = useState(false)
    const planContent = content || '(empty)'

    const copyPlan = () => {
        void navigator.clipboard.writeText(planContent)
            .then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1200)
            })
            .catch((error) => {
                console.error('Failed to copy Codex plan:', error)
            })
    }

    const downloadPlan = () => {
        const blob = new Blob([planContent], { type: 'text/markdown;charset=utf-8' })
        const url = window.URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'codex-plan.md'
        anchor.click()
        window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
    }

    return (
        <div className="rounded-lg border bg-muted/60 px-4 py-3 text-sm text-foreground">
            <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                    <ListChecks className="h-4 w-4 text-sky-600" />
                    <span className="truncate">Plan</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={copyPlan}
                        title={copied ? 'Copied' : 'Copy plan'}
                        aria-label={copied ? 'Copied' : 'Copy plan'}
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={downloadPlan}
                        title="Download plan as Markdown"
                        aria-label="Download plan as Markdown"
                    >
                        <Download className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setCollapsed((current) => !current)}
                        title={collapsed ? 'Expand plan' : 'Collapse plan'}
                        aria-label={collapsed ? 'Expand plan' : 'Collapse plan'}
                    >
                        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Button>
                </div>
            </div>
            <div className={cn('relative mt-4 overflow-hidden', collapsed && 'max-h-72')}>
                <CodexMarkdown content={planContent} />
                {collapsed && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-muted via-muted/95 to-transparent px-3 pb-4 pt-20">
                        <Button
                            type="button"
                            size="sm"
                            className="pointer-events-auto h-8 rounded-full bg-foreground px-4 text-background hover:bg-foreground/90"
                            onClick={() => setCollapsed(false)}
                        >
                            Expand plan
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

function PlanStepIcon({ status }: { status: CodexPlanStepStatus }) {
    if (status === 'completed') {
        return (
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-400 text-white">
                <Check className="h-3.5 w-3.5" />
            </span>
        )
    }
    if (status === 'inProgress') {
        return (
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-zinc-400 bg-background">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" />
            </span>
        )
    }
    return <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-zinc-300 bg-background" />
}

function PlanProgressCard({
    content,
    title,
    hideLabel,
    onHide,
}: {
    content: string
    title: string
    hideLabel: string
    onHide: () => void
}) {
    const [collapsed, setCollapsed] = useState(false)
    const update = useMemo(() => parsePlanUpdate(content), [content])
    const summaryStep = update.plan.find((item) => item.status === 'inProgress')
        ?? update.plan.find((item) => item.status === 'pending')
        ?? update.plan.at(-1)
    const completedCount = update.plan.filter((item) => item.status === 'completed').length

    return (
        <div className="rounded-[1.75rem] border border-border/70 bg-background/95 px-5 py-4 text-sm text-foreground shadow-[0_12px_32px_-20px_rgba(15,23,42,0.45)] backdrop-blur">
            <div className="flex items-start gap-3">
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => setCollapsed((current) => !current)}
                    aria-expanded={!collapsed}
                >
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium tracking-[0.02em] text-muted-foreground">{title}</span>
                            {update.plan.length > 0 && (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    {completedCount}/{update.plan.length}
                                </span>
                            )}
                        </div>
                        {collapsed ? (
                            summaryStep ? (
                                <div className="mt-2 truncate text-sm text-foreground">{summaryStep.step}</div>
                            ) : (
                                update.explanation && <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">{update.explanation}</div>
                            )
                        ) : (
                            update.explanation && <div className="mt-2 text-xs leading-5 text-muted-foreground">{update.explanation}</div>
                        )}
                    </div>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                        onClick={onHide}
                        title={hideLabel}
                        aria-label={hideLabel}
                    >
                        <Pin className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                        onClick={() => setCollapsed((current) => !current)}
                        title={collapsed ? 'Expand progress' : 'Collapse progress'}
                        aria-label={collapsed ? 'Expand progress' : 'Collapse progress'}
                        aria-expanded={!collapsed}
                    >
                        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            {!collapsed && (
                <div className="mt-4 space-y-3">
                    {update.plan.length === 0 ? (
                        <div className="text-xs text-muted-foreground">(no steps provided)</div>
                    ) : (
                        update.plan.map((item, index) => (
                            <div key={`${item.status}-${index}-${item.step}`} className="flex gap-3 text-[15px] leading-6">
                                <PlanStepIcon status={item.status} />
                                <span
                                    className={cn(
                                        'min-w-0 break-words text-zinc-700',
                                        item.status === 'completed' && 'text-zinc-500',
                                        item.status === 'inProgress' && 'font-medium text-zinc-800'
                                    )}
                                >
                                    {item.step}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}

function CodexComposerActionPrompt({
    title,
    detail,
    options,
    selectedOptionId,
    inputValue,
    submitLabel,
    disabled,
    onSelect,
    onInputChange,
    onSubmit,
    onDismiss,
    dismissLabel = 'Dismiss',
}: {
    title: string
    detail?: string
    options: CodexComposerActionOption[]
    selectedOptionId: string
    inputValue: string
    submitLabel: string
    disabled?: boolean
    onSelect: (optionId: string) => void
    onInputChange: (value: string) => void
    onSubmit: (optionId: string, inputValue: string) => void
    onDismiss: () => void
    dismissLabel?: string
}) {
    const selectedIndex = Math.max(0, options.findIndex((option) => option.id === selectedOptionId))
    const selectedOption = options[selectedIndex]
    const inputRef = useRef<HTMLTextAreaElement | null>(null)

    useEffect(() => {
        if (selectedOption?.kind !== 'input') return
        inputRef.current?.focus()
    }, [selectedOption?.kind, selectedOptionId])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                onDismiss()
                return
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                const direction = event.key === 'ArrowUp' ? -1 : 1
                const nextIndex = (selectedIndex + direction + options.length) % options.length
                onSelect(options[nextIndex]?.id ?? selectedOptionId)
                return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                onSubmit(selectedOptionId, inputValue)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [inputValue, onDismiss, onSelect, onSubmit, options, selectedIndex, selectedOptionId])

    return (
        <div className="rounded-[1.35rem] border bg-background p-3 shadow-sm">
            <div className="px-1 pb-3 text-sm font-medium text-foreground">{title}</div>
            {detail?.trim() && (
                <div className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-muted/60 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                    {detail.trim()}
                </div>
            )}
            <div className="space-y-1">
                {options.map((option, index) => {
                    const selected = option.id === selectedOptionId
                    const optionDisabled = disabled || option.disabled
                    const showInput = selected && option.kind === 'input'
                    const inputHasContent = inputValue.trim().length > 0
                    const rowClassName = cn(
                        'flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors',
                        selected && (!showInput || !inputHasContent)
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                        showInput && inputHasContent && 'bg-transparent text-foreground hover:bg-transparent',
                        optionDisabled && 'cursor-not-allowed opacity-60'
                    )

                    if (option.kind === 'input') {
                        return (
                            <div
                                key={option.id}
                                className={rowClassName}
                                onClick={() => {
                                    if (optionDisabled) return
                                    onSelect(option.id)
                                    window.setTimeout(() => inputRef.current?.focus(), 0)
                                }}
                            >
                                <span className="w-5 shrink-0 text-muted-foreground">{index + 1}.</span>
                                {showInput ? (
                                    <AutoResizeTextarea
                                        ref={inputRef}
                                        value={inputValue}
                                        rows={1}
                                        placeholder={option.label}
                                        disabled={optionDisabled}
                                        className="min-h-10 flex-1 border-0 bg-transparent px-0 py-2 text-sm shadow-none focus-visible:ring-0"
                                        onChange={(event) => onInputChange(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (isKeyboardEventComposing(event)) return
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault()
                                                onSubmit(option.id, inputValue)
                                            }
                                        }}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        disabled={optionDisabled}
                                        className="min-w-0 flex-1 truncate py-2 text-left disabled:cursor-not-allowed"
                                        onClick={() => onSelect(option.id)}
                                    >
                                        {option.label}
                                    </button>
                                )}
                                {selected && !inputHasContent && <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}
                            </div>
                        )
                    }

                    return (
                        <button
                            key={option.id}
                            type="button"
                            disabled={optionDisabled}
                            className={rowClassName}
                            onClick={() => {
                                onSelect(option.id)
                                onSubmit(option.id, inputValue)
                            }}
                        >
                            <span className="w-5 shrink-0 text-muted-foreground">{index + 1}.</span>
                            <span className="min-w-0 flex-1 truncate py-2">{option.label}</span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        </button>
                    )
                })}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={onDismiss}
                    disabled={disabled}
                >
                    {dismissLabel} <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">ESC</kbd>
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="rounded-full px-4"
                    onClick={() => onSubmit(selectedOptionId, inputValue)}
                    disabled={disabled}
                >
                    {submitLabel}
                </Button>
            </div>
        </div>
    )
}

function QueuedMessageRow({
    message,
    disabled,
    onSave,
    onDelete,
    onSteer,
}: {
    message: QueuedCodexMessage
    disabled?: boolean
    onSave: (content: string) => void
    onDelete: () => void
    onSteer: () => void
}) {
    const [editing, setEditing] = useState(false)
    const [draftValue, setDraftValue] = useState(message.content)

    const normalizedDraft = draftValue.trim()

    return (
        <div className="rounded-2xl border bg-background px-3 py-2 shadow-sm">
            <div className="flex items-start gap-2.5">
                <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <div className="space-y-3">
                            <AutoResizeTextarea
                                value={draftValue}
                                rows={1}
                                disabled={disabled}
                                className="min-h-10 border-0 bg-muted/60 px-3 py-2 text-sm shadow-none focus-visible:ring-0"
                                onChange={(event) => setDraftValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (isKeyboardEventComposing(event)) return
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault()
                                        if (!normalizedDraft || disabled) return
                                        onSave(normalizedDraft)
                                        setEditing(false)
                                    }
                                }}
                            />
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setDraftValue(message.content)
                                        setEditing(false)
                                    }}
                                    disabled={disabled}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="rounded-full px-4"
                                    onClick={() => {
                                        if (!normalizedDraft) return
                                        onSave(normalizedDraft)
                                        setEditing(false)
                                    }}
                                    disabled={disabled || !normalizedDraft}
                                >
                                    Save
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-end gap-1 pb-1">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 gap-1 rounded-full px-2.5 text-muted-foreground"
                                    onClick={onSteer}
                                    disabled={disabled}
                                >
                                    <CornerDownRight className="h-4 w-4" />
                                    <span>Steer</span>
                                </Button>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    className="h-8 w-8 rounded-full text-muted-foreground"
                                    onClick={onDelete}
                                    disabled={disabled}
                                    title="Delete queued message"
                                    aria-label="Delete queued message"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            className="h-8 w-8 rounded-full text-muted-foreground"
                                            disabled={disabled}
                                            title="Queued message actions"
                                            aria-label="Queued message actions"
                                        >
                                            <EllipsisVertical className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-52">
                                        <DropdownMenuItem
                                            onSelect={() => {
                                                setDraftValue(message.content)
                                                setEditing(true)
                                            }}
                                        >
                                            <Pencil className="h-4 w-4" />
                                            <span>Edit message</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
                                {message.content}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

// Copying a user message should yield what the author sees — `@name` for mention pills and the
// plain label for nav links — not the internal `[label](kind:id)` tokens.
function stripUserMessageTokens(content: string) {
    return content.replace(USER_MENTION_RE, (_match, label: string, kind: string) =>
        kind === 'model' || kind === 'skill' || kind === 'term' || kind === 'snippet' ? `@${label}` : label
    )
}

function MessageActions({ message }: { message: CodexSessionMessage }) {
    const t = useTranslations('editor')
    const novelId = useContext(CodexNovelIdContext)
    const [copied, setCopied] = useState(false)
    const [snippetState, setSnippetState] = useState<'idle' | 'busy' | 'saved'>('idle')
    const isUser = message.role === 'user'

    const copyMessage = () => {
        const text = isUser ? stripUserMessageTokens(message.content) : message.content
        if (!text.trim()) return
        void navigator.clipboard?.writeText(text)
            .then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1200)
            })
            .catch((error) => {
                console.error('Failed to copy Codex message:', error)
            })
    }

    const saveToSnippet = () => {
        const normalizedNovelId = novelId?.trim()
        const text = message.content.trim()
        if (!normalizedNovelId || !text || snippetState !== 'idle') return
        setSnippetState('busy')
        const firstLine = text.split(/\r?\n/u)[0]?.trim() ?? ''
        const title = firstLine ? firstLine.slice(0, 28) : t('infoPanel.chatSnippetTitle')
        void snippetApi.create(normalizedNovelId, {
            title,
            content: plainTextToSnippetHtml(text),
            pinned: false,
        })
            .then(() => {
                setSnippetState('saved')
                window.setTimeout(() => setSnippetState('idle'), 1200)
            })
            .catch((error) => {
                console.error('Failed to save Codex message to snippet:', error)
                setSnippetState('idle')
            })
    }

    return (
        <div className="flex items-center gap-0.5 px-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground"
                title={t('infoPanel.chatCopyMessage')}
                aria-label={t('infoPanel.chatCopyMessage')}
                onClick={copyMessage}
            >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            {!isUser && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    title={t('infoPanel.chatSaveToSnippet')}
                    aria-label={t('infoPanel.chatSaveToSnippet')}
                    disabled={snippetState === 'busy' || !novelId?.trim()}
                    onClick={saveToSnippet}
                >
                    {snippetState === 'saved' ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                </Button>
            )}
        </div>
    )
}

function MessageBubble({ message }: { message: CodexSessionMessage }) {
    const t = useTranslations('editor')
    if (message.role === 'event') {
        const [title, ...body] = message.content.split(/\n\n/u)
        const eventBody = body.join('\n\n').trim()
        if (message.kind === 'plan') {
            return <ProposedPlanEvent content={eventBody || message.content} />
        }
        if (message.kind === 'plan_update') {
            return null
        }
        // Context compaction (auto at the token threshold, or manual via `/compact`) renders as a
        // centered divider: plain text while running, an icon + label once it lands. The state is
        // carried in the message content ('running' | 'done').
        if (message.kind === 'context_compaction') {
            const done = message.content.trim() === 'done'
            return (
                <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span className="flex items-center gap-1.5">
                        {done && <FoldVertical className="h-3.5 w-3.5 shrink-0" />}
                        {done ? t('codex.compaction.done') : t('codex.compaction.running')}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                </div>
            )
        }
        if (message.kind === 'steer') {
            return (
                <div className="flex justify-end">
                    <div className="flex max-w-[86%] flex-col items-end gap-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CornerDownRight className="h-4 w-4 shrink-0" />
                            <span className="font-medium">{title || 'Steered conversation'}</span>
                        </div>
                        <div className="max-w-full rounded-2xl bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                            <ImageThumbnails urls={message.attachments} className="mb-1.5" />
                            <div className="whitespace-pre-wrap break-words">{eventBody || message.content}</div>
                        </div>
                    </div>
                </div>
            )
        }
        const eventTitle = title || message.kind || 'Event'
        const displayTitle = formatEventTitleForDisplay(eventTitle)
        const EventIcon = message.kind === 'web_search' ? Search : Sparkles
        return (
            <div className="ml-10 w-[86%] min-w-0 overflow-hidden rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                    <EventIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={eventTitle}>{displayTitle}</span>
                    {message.kind && <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">{message.kind}</Badge>}
                </div>
                {eventBody && (
                    <div className="mt-2 max-h-40 min-w-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
                        {eventBody}
                    </div>
                )}
                <ImageThumbnails urls={message.attachments} className="mt-2" />
            </div>
        )
    }

    const isUser = message.role === 'user'
    return (
        <div className={cn('group flex gap-3', isUser && 'justify-end')}>
            {!isUser && (
                <Avatar className="mt-1 h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary">
                        <Bot className="h-4 w-4" />
                    </AvatarFallback>
                </Avatar>
            )}
            <div className={cn('flex min-w-0 max-w-[86%] flex-col gap-1', isUser && 'items-end')}>
                <div
                    className={cn(
                        'min-w-0 max-w-full overflow-hidden rounded-2xl px-4 py-3 text-sm leading-6 break-words [overflow-wrap:anywhere]',
                        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted/70 text-foreground'
                    )}
                >
                    <ImageThumbnails urls={message.attachments} className={cn(message.content.trim() && 'mb-1.5')} />
                    {isUser && <JsonArtifactChips fileNames={message.jsonArtifacts} className={message.content.trim() ? 'mb-1.5' : undefined} />}
                    {isUser ? (
                        <UserMessageContent content={message.content} />
                    ) : (
                        <CodexMarkdown content={message.content} />
                    )}
                </div>
                <MessageActions message={message} />
            </div>
        </div>
    )
}

function WorkEventGroup({
    messages,
    defaultCollapsed,
}: {
    messages: CodexSessionMessage[]
    defaultCollapsed: boolean
}) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed || messages.length > 8)
    const summary = formatWorkEventSummary(messages)

    return (
        <div className="space-y-3">
            <button
                type="button"
                className="flex w-full items-center gap-2 border-t pt-3 text-left text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setCollapsed((current) => !current)}
            >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate">{summary}</span>
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {!collapsed && (
                <div className="space-y-3">
                    {messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                    ))}
                </div>
            )}
        </div>
    )
}

type HunkUiState = { status: 'idle' | 'busy' | 'accepted' | 'rejected'; error?: string }

function SceneEditHunkRow({
    hunk,
    state,
    onResolve,
}: {
    hunk: SceneEditHunk
    state: HunkUiState
    onResolve: (action: 'accept' | 'reject') => void
}) {
    const resolved = state.status === 'accepted' || state.status === 'rejected'
    const busy = state.status === 'busy'

    return (
        <div className="rounded-lg border bg-background/60 p-2 text-xs">
            {hunk.beforeText.trim() && (
                <div className="whitespace-pre-wrap break-words rounded bg-rose-500/10 px-2 py-1 text-rose-700 line-through dark:text-rose-300">
                    {hunk.beforeText}
                </div>
            )}
            {hunk.afterText.trim() && (
                <div className="mt-1 whitespace-pre-wrap break-words rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                    {hunk.afterText}
                </div>
            )}
            <div className="mt-1.5 flex items-center gap-2">
                {resolved ? (
                    <span className="text-[11px] text-muted-foreground">
                        {state.status === 'accepted' ? '已接受' : '已撤销'}
                    </span>
                ) : (
                    <>
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" disabled={busy} onClick={() => onResolve('accept')}>
                            <Check className="h-3 w-3" /> 接受
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" disabled={busy} onClick={() => onResolve('reject')}>
                            <Undo2 className="h-3 w-3" /> 撤销
                        </Button>
                    </>
                )}
                {state.error && <span className="text-[11px] text-rose-600">{state.error}</span>}
            </div>
        </div>
    )
}

function SceneEditCard({ result }: { result: SceneEditToolResult }) {
    const novelId = useContext(CodexNovelIdContext)
    const onNavigate = useContext(CodexNavContext)
    const [states, setStates] = useState<Record<string, HunkUiState>>({})

    // When this edit first surfaces (Codex just applied it), pull the new scene content
    // and pending edits into the manuscript view so it updates live without a refresh.
    const appliedKey = result.applied.map((hunk) => hunk.id).join(',')
    useEffect(() => {
        if (novelId) emitSceneEditsChanged(novelId)
    }, [novelId, appliedKey])

    const setHunk = (id: string, next: HunkUiState) => setStates((prev) => ({ ...prev, [id]: next }))

    const resolve = async (id: string, action: 'accept' | 'reject') => {
        if (!novelId) return
        setHunk(id, { status: 'busy' })
        try {
            await sceneEditApi.resolve(novelId, id, action)
            setHunk(id, { status: action === 'accept' ? 'accepted' : 'rejected' })
            emitSceneEditsChanged(novelId)
        } catch (error) {
            setHunk(id, { status: 'idle', error: error instanceof Error ? error.message : '操作失败' })
        }
    }

    const canJump = Boolean(onNavigate && result.chapterId && result.sceneId)

    return (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3">
            <div className="flex items-center gap-2">
                <Pencil className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    改写了正文 · 第 {result.actNumber} 卷（{result.applied.length} 处{result.failedCount ? `，${result.failedCount} 处未匹配` : ''}）
                </span>
                {canJump && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 px-2 text-[11px]"
                        onClick={() => onNavigate?.({ kind: 'scene', chapterId: result.chapterId, sceneId: result.sceneId })}
                    >
                        <ArrowUpRight className="h-3 w-3" /> 查看
                    </Button>
                )}
            </div>
            <div className="mt-2 space-y-2">
                {result.applied.map((hunk) => (
                    <SceneEditHunkRow
                        key={hunk.id}
                        hunk={hunk}
                        state={states[hunk.id] ?? { status: 'idle' }}
                        onResolve={(action) => resolve(hunk.id, action)}
                    />
                ))}
            </div>
        </div>
    )
}

function isImageGenerationMessage(message: CodexSessionMessage) {
    return message.role === 'event' && message.kind === 'image_generation'
}

/**
 * Generated images presented standalone below the turn's work group (like the
 * Codex app), instead of being folded into the "Worked for…" collapse. Clicking
 * an image opens the shared viewer.
 */
function ImageGenerationCard({ message }: { message: CodexSessionMessage }) {
    const [openUrl, setOpenUrl] = useState<string | null>(null)
    const [promptExpanded, setPromptExpanded] = useState(false)
    const [, ...body] = message.content.split(/\n\n/u)
    const prompt = body.join('\n\n').trim()
    const urls = message.attachments ?? []

    // pl-10 lines the card up with assistant bubbles (avatar h-7 + gap-3).
    // No file yet (still generating, or the run failed before saving) — keep a quiet hint.
    if (urls.length === 0) {
        return (
            <div className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={prompt || undefined}>Image generation</span>
            </div>
        )
    }

    return (
        <div className="space-y-1.5 pl-10">
            <div className="flex flex-wrap gap-2">
                {urls.map((url, index) => (
                    <button
                        key={`${url}-${index}`}
                        type="button"
                        className="overflow-hidden rounded-xl border transition-opacity hover:opacity-90"
                        onClick={() => setOpenUrl(url)}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="max-h-80 w-auto max-w-full object-contain" />
                    </button>
                ))}
            </div>
            {prompt && (
                promptExpanded ? (
                    <div className="text-xs leading-5 text-muted-foreground">
                        <span className="select-text whitespace-pre-wrap break-words">{prompt}</span>
                        <button
                            type="button"
                            className="ml-1.5 align-baseline text-primary hover:underline"
                            onClick={() => setPromptExpanded(false)}
                        >
                            收起
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
                        title={prompt}
                        onClick={() => setPromptExpanded(true)}
                    >
                        {prompt}
                    </button>
                )
            )}
            <ImageViewerDialog src={openUrl} open={openUrl !== null} onOpenChange={(isOpen) => !isOpen && setOpenUrl(null)} />
        </div>
    )
}

function CodexTurnBody({ messages, running }: { messages: CodexSessionMessage[]; running: boolean }) {
    const nodes: ReactNode[] = []

    for (let index = 0; index < messages.length;) {
        const message = messages[index]
        if (message && isPinnedPlanUpdateMessage(message)) {
            index += 1
            continue
        }
        if (message && isSceneEditToolMessage(message)) {
            const result = parseSceneEditToolMessage(message)
            if (result) nodes.push(<SceneEditCard key={message.id} result={result} />)
            index += 1
            continue
        }
        if (message && isImageGenerationMessage(message)) {
            nodes.push(<ImageGenerationCard key={message.id} message={message} />)
            index += 1
            continue
        }
        if (message && isWorkEvent(message)) {
            const group: CodexSessionMessage[] = []
            let cursor = index
            while (cursor < messages.length && isWorkEvent(messages[cursor]) && !isSceneEditToolMessage(messages[cursor])) {
                group.push(messages[cursor])
                cursor += 1
            }
            const hasLaterAssistant = messages.slice(cursor).some((item) => item.role === 'assistant')
            const defaultCollapsed = hasLaterAssistant || !running
            nodes.push(
                <WorkEventGroup
                    key={`work-${group[0]?.id ?? index}-${defaultCollapsed ? 'collapsed' : 'expanded'}-${group.length > 8 ? 'large' : 'small'}`}
                    messages={group}
                    defaultCollapsed={defaultCollapsed}
                />
            )
            index = cursor
            continue
        }

        if (message) nodes.push(<MessageBubble key={message.id} message={message} />)
        index += 1
    }

    return <>{nodes}</>
}

function splitMessagesIntoTurns(messages: CodexSessionMessage[]) {
    const turns: CodexSessionMessage[][] = []
    let current: CodexSessionMessage[] = []

    messages.forEach((message) => {
        if (message.role === 'user' && current.length > 0) {
            turns.push(current)
            current = []
        }
        current.push(message)
    })

    if (current.length > 0) turns.push(current)
    return turns
}

function getLastAssistantIndex(messages: CodexSessionMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'assistant') return index
    }
    return -1
}

function CodexTurnWorkGroup({
    messages,
    durationMessages,
    running,
    now,
}: {
    messages: CodexSessionMessage[]
    durationMessages: CodexSessionMessage[]
    running: boolean
    now: number
}) {
    const [collapsed, setCollapsed] = useState(() => !running || messages.length > 8)
    const summary = getTurnDurationLabel(durationMessages, running, now)

    return (
        <div className="space-y-4">
            <button
                type="button"
                className="flex w-full items-center gap-2 border-t pt-3 text-left text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setCollapsed((current) => !current)}
            >
                <span className="min-w-0 flex-1 truncate">{summary}</span>
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {!collapsed && <CodexTurnBody messages={messages} running={running} />}
        </div>
    )
}

function CodexTurnGroup({
    messages,
    running,
    now,
}: {
    messages: CodexSessionMessage[]
    running: boolean
    now: number
}) {
    const userMessage = messages[0]
    const lastAssistantIndex = getLastAssistantIndex(messages)
    if (!userMessage || userMessage.role !== 'user' || lastAssistantIndex < 0) {
        return <CodexTurnBody messages={messages} running={running} />
    }

    const middleMessages = messages.slice(1, lastAssistantIndex)
    const editMessages = middleMessages.filter(isSceneEditToolMessage)
    const imageGenMessages = middleMessages.filter(isImageGenerationMessage)
    const workMessages = middleMessages.filter(
        (message) => message.kind !== 'steer' && !isSceneEditToolMessage(message) && !isImageGenerationMessage(message)
    )
    const steerMessages = middleMessages.filter((message) => message.kind === 'steer')
    const finalAssistantMessage = messages[lastAssistantIndex]
    const trailingMessages = messages.slice(lastAssistantIndex + 1)

    return (
        <div className="space-y-4">
            <MessageBubble message={userMessage} />
            {workMessages.length > 0 && (
                <CodexTurnWorkGroup
                    key={`${userMessage.id}-${running ? 'running' : 'done'}-${workMessages.length > 8 ? 'large' : 'small'}`}
                    messages={workMessages}
                    durationMessages={messages.slice(0, lastAssistantIndex + 1)}
                    running={running}
                    now={now}
                />
            )}
            {steerMessages.length > 0 && (
                <div className="space-y-4">
                    {steerMessages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                    ))}
                </div>
            )}
            {editMessages.map((message) => {
                const result = parseSceneEditToolMessage(message)
                return result ? <SceneEditCard key={message.id} result={result} /> : null
            })}
            {finalAssistantMessage && <MessageBubble message={finalAssistantMessage} />}
            {imageGenMessages.map((message) => (
                <ImageGenerationCard key={message.id} message={message} />
            ))}
            {trailingMessages.length > 0 && <CodexTurnBody messages={trailingMessages} running={running} />}
        </div>
    )
}

function codexTurnPreviewText(value: string) {
    return value
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
        .replace(/[`*_>#~-]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
}

function CodexTimeline({
    messages,
    running,
    scrollRootRef,
}: {
    messages: CodexSessionMessage[]
    running: boolean
    scrollRootRef: RefObject<HTMLDivElement | null>
}) {
    const [now, setNow] = useState(() => Date.now())
    const turns = useMemo(() => splitMessagesIntoTurns(messages), [messages])
    const turnRefs = useRef<Array<HTMLDivElement | null>>([])
    const turnOffsetsRef = useRef<number[]>([])
    const animationFrameRef = useRef<number | null>(null)
    const [activeTurnIndex, setActiveTurnIndex] = useState(0)
    const [navigatorHeight, setNavigatorHeight] = useState(0)

    const navigableTurns = useMemo(
        () => turns
            .map((turn, turnIndex) => ({ turn, turnIndex }))
            .filter(({ turn }) => turn[0]?.role === 'user'),
        [turns]
    )
    const navigatorEntries = useMemo<CodexTurnNavigatorEntry[]>(
        () => navigableTurns.map(({ turn }) => {
            const userMessage = turn[0]
            const assistantMessage = [...turn].reverse().find((message) => message.role === 'assistant')
            return {
                id: userMessage?.id ?? `turn-${turn.length}`,
                userText: codexTurnPreviewText(userMessage?.content ?? ''),
                assistantText: codexTurnPreviewText(assistantMessage?.content ?? ''),
            }
        }),
        [navigableTurns]
    )

    useEffect(() => {
        if (!running) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [running])

    useLayoutEffect(() => {
        const root = scrollRootRef.current
        if (!root || navigableTurns.length === 0) return

        const updateActiveTurn = () => {
            const targetOffset = root.scrollTop + Math.min(root.clientHeight * 0.28, 180)
            let nextActive = 0
            turnOffsetsRef.current.forEach((offset, index) => {
                if (offset <= targetOffset) nextActive = index
            })
            setActiveTurnIndex(nextActive)
        }

        const computeGeometry = () => {
            const rootRect = root.getBoundingClientRect()
            const offsets = navigableTurns.map(({ turnIndex }) => {
                const element = turnRefs.current[turnIndex]
                if (!element) return 0
                return element.getBoundingClientRect().top - rootRect.top + root.scrollTop
            })
            turnOffsetsRef.current = offsets
            setNavigatorHeight(Math.max(0, root.clientHeight - 24))
            updateActiveTurn()
        }

        const scheduleGeometry = () => {
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = requestAnimationFrame(() => {
                animationFrameRef.current = null
                computeGeometry()
            })
        }
        const scheduleActiveTurn = () => {
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = requestAnimationFrame(() => {
                animationFrameRef.current = null
                updateActiveTurn()
            })
        }

        scheduleGeometry()
        root.addEventListener('scroll', scheduleActiveTurn, { passive: true })
        const resizeObserver = new ResizeObserver(scheduleGeometry)
        resizeObserver.observe(root)
        navigableTurns.forEach(({ turnIndex }) => {
            const element = turnRefs.current[turnIndex]
            if (element) resizeObserver.observe(element)
        })

        return () => {
            root.removeEventListener('scroll', scheduleActiveTurn)
            resizeObserver.disconnect()
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
        }
    }, [navigableTurns, scrollRootRef])

    const jumpToTurn = (navigatorIndex: number) => {
        const root = scrollRootRef.current
        const turnIndex = navigableTurns[navigatorIndex]?.turnIndex
        const element = turnIndex === undefined ? null : turnRefs.current[turnIndex]
        if (!root || !element) return
        const rootRect = root.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const top = elementRect.top - rootRect.top + root.scrollTop - 16
        root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        setActiveTurnIndex(navigatorIndex)
    }

    return (
        <div className="relative min-w-0">
            <div className="pointer-events-none sticky top-3 z-30 h-0">
                <CodexTurnNavigator
                    entries={navigatorEntries}
                    activeIndex={activeTurnIndex}
                    height={navigatorHeight}
                    onJump={jumpToTurn}
                />
            </div>
            <div className="space-y-4">
                {turns.map((turn, index) => (
                    <div
                        key={turn[0]?.id ?? index}
                        ref={(element) => {
                            turnRefs.current[index] = element
                        }}
                        className="scroll-mt-4"
                    >
                        <CodexTurnGroup
                            messages={turn}
                            running={running && index === turns.length - 1}
                            now={now}
                        />
                    </div>
                ))}
            </div>
        </div>
    )
}

export function RightPanelCodex({ novelId, onNavigateToWrite }: RightPanelCodexProps) {
    const t = useTranslations('editor')
    const sessionState = useEditorCodexStore((state) => state.sessionsByNovel[novelId?.trim() || '__default__'])
    const loadSessions = useEditorCodexStore((state) => state.loadSessions)
    const createSession = useEditorCodexStore((state) => state.createSession)
    const selectSession = useEditorCodexStore((state) => state.selectSession)
    const updateDraft = useEditorCodexStore((state) => state.updateDraft)
    const updateReviewLevel = useEditorCodexStore((state) => state.updateReviewLevel)
    const updateModelSettings = useEditorCodexStore((state) => state.updateModelSettings)
    const updatePlanMode = useEditorCodexStore((state) => state.updatePlanMode)
    const ensureSessionPersisted = useEditorCodexStore((state) => state.ensureSessionPersisted)
    const sendMessage = useEditorCodexStore((state) => state.sendMessage)
    const compact = useEditorCodexStore((state) => state.compact)
    const pendingApprovalsBySession = useEditorCodexStore((state) => state.pendingApprovalsBySession)
    const resolveApproval = useEditorCodexStore((state) => state.resolveApproval)
    const [runError, setRunError] = useState<string | null>(null)
    const [connections, setConnections] = useState<CodexConnectionSummary[]>([])
    const [activeModelCatalog, setActiveModelCatalog] = useState<CodexModelCatalogEntry[]>([])
    const [activeConnectionRateLimits, setActiveConnectionRateLimits] = useState<CodexRateLimits | null>(null)
    const [planHintDismissed, setPlanHintDismissed] = useState(false)
    const [dismissedComposerActions, setDismissedComposerActions] = useState<Record<string, true>>({})
    const [composerActionSelection, setComposerActionSelection] = useState<{ actionId: string; optionId: string } | null>(null)
    const [composerActionInput, setComposerActionInput] = useState('')
    const [approvalActionSelection, setApprovalActionSelection] = useState<{ approvalId: string; optionId: string } | null>(null)
    const [approvalActionInput, setApprovalActionInput] = useState('')
    const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
    const [dismissedPlanUpdateId, setDismissedPlanUpdateId] = useState<string | null>(null)
    const [queuedMessagesBySession, setQueuedMessagesBySession] = useState<Record<string, QueuedCodexMessage[]>>({})
    const [queueingEnabledBySession, setQueueingEnabledBySession] = useState<Record<string, boolean>>({})
    const [optimisticSteerMessagesBySession, setOptimisticSteerMessagesBySession] = useState<Record<string, CodexSessionMessage[]>>({})
    const [jsonArtifactsBySession, setJsonArtifactsBySession] = useState<Record<string, CodexJsonArtifact[]>>({})
    const [jsonArtifactUploading, setJsonArtifactUploading] = useState(false)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const previousRunningRef = useRef(false)
    const resolvingApprovalRef = useRef<string | null>(null)
    const queueProcessingRef = useRef<string | null>(null)
    const composerRef = useRef<HTMLTextAreaElement | null>(null)
    const composerOverlayRef = useRef<HTMLDivElement | null>(null)
    const composerOverlayTextRef = useRef<HTMLDivElement | null>(null)
    const composerFileInputRef = useRef<HTMLInputElement | null>(null)
    const composerDragDepthRef = useRef(0)
    const [composerDragActive, setComposerDragActive] = useState(false)
    const syncComposerOverlayScroll = useCallback(() => {
        const textarea = composerRef.current
        const overlayText = composerOverlayTextRef.current
        if (!textarea || !overlayText) return
        overlayText.style.width = `${textarea.clientWidth}px`
        overlayText.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
    }, [])
    const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
    const [mentionIndex, setMentionIndex] = useState(0)
    // Dismiss the `/compact` suggestion for the current keystroke (Escape); reset on the next edit.
    const [slashCommandDismissed, setSlashCommandDismissed] = useState(false)
    const [modelGroups, setModelGroups] = useState<ModelGroup[] | null>(null)
    const [skills, setSkills] = useState<Skill[] | null>(null)
    // Terms are `@`-mentionable so the author can point Codex at a glossary entry's projected file
    // (`novel/terms/<file>.md`) instead of making it hunt for the term itself.
    const termEntries = useStoredTermEntries(novelId)
    // Snippets are `@`-mentionable too, pointing Codex at `novel/snippets/<id>.md`.
    const [snippets, setSnippets] = useState<Snippet[] | null>(null)
    // Imported materials (资料) are `@`-mentionable, pointing Codex at `novel/materials/<id>.md`. They
    // can be large, so Codex only reads one when the author @-mentions it (never browses the folder).
    const [materials, setMaterials] = useState<MaterialSummary[] | null>(null)
    // Volumes (acts) and chapters are `@`-mentionable so the author can point Codex at a whole volume
    // (its outline section) or a chapter's projected file. They can be matched by title or by number.
    const [acts, setActs] = useState<Act[] | null>(null)
    const [chapters, setChapters] = useState<Chapter[] | null>(null)
    // Detailed outlines (细纲) are `@`-mentionable too: the author can point Codex at a chapter's 章纲
    // or a volume's 卷纲. Only chapters/acts that have a non-empty 细纲 surface as mentions.
    const [outlines, setOutlines] = useState<OutlineSummary[] | null>(null)
    // When an `@`-mentioned ai_chat skill has a bound prompt, a Tweak dialog lets the author fill it
    // (auto-injecting overview + terms) and ship the resolved blocks as the message's artifact.
    const [tweakOpen, setTweakOpen] = useState(false)
    const [tweakChatInput, setTweakChatInput] = useState('')
    const [tweakBlocks, setTweakBlocks] = useState<CodexRenderedBlock[] | null>(null)

    const handleAttachmentError = (error: ImageAttachmentError) => {
        const key = (
            {
                type: 'attachmentErrorType',
                size: 'attachmentErrorSize',
                count: 'attachmentErrorCount',
                disabled: 'attachmentErrorVision',
                upload: 'attachmentErrorUpload',
            } as const
        )[error]
        setRunError(t(`infoPanel.${key}`))
    }
    const imageAttachments = useImageAttachments({ onError: handleAttachmentError })

    const handleComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        composerDragDepthRef.current += 1
        setComposerDragActive(true)
    }

    const handleComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
    }

    const handleComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return
        composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1)
        if (composerDragDepthRef.current === 0) setComposerDragActive(false)
    }

    const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
        composerDragDepthRef.current = 0
        setComposerDragActive(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        void addComposerFiles(files)
    }

    const addComposerFiles = async (files: File[]) => {
        const images = files.filter((file) => file.type.startsWith('image/'))
        const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith('.json'))
        const unsupported = files.length - images.length - jsonFiles.length
        if (images.length > 0) imageAttachments.addFiles(images)
        if (unsupported > 0) setRunError(t('codex.artifactJsonOnly'))
        if (jsonFiles.length === 0) return
        if (running) {
            setRunError(t('codex.artifactWhileRunning'))
            return
        }
        setJsonArtifactUploading(true)
        try {
            const sessionId = selectedSession?.id ?? await ensureSession()
            if (!sessionId) return
            await ensureSessionPersisted(novelId, sessionId)
            for (const file of jsonFiles) {
                const result = await codexSessionApi.uploadJsonArtifact(sessionId, file)
                setJsonArtifactsBySession((current) => ({
                    ...current,
                    [sessionId]: [...(current[sessionId] ?? []), result.artifact],
                }))
            }
        } catch (error) {
            setRunError(error instanceof Error ? error.message : String(error))
        } finally {
            setJsonArtifactUploading(false)
        }
    }

    useEffect(() => {
        void loadSessions(novelId)
    }, [loadSessions, novelId])

    useEffect(() => {
        if (mention === null) return
        let cancelled = false
        if (modelGroups === null) {
            void authFetch('/api/ai/groups')
                .then(async (response) => (response.ok ? response.json() : null))
                .then((data) => {
                    if (cancelled) return
                    setModelGroups(Array.isArray(data?.groups) ? (data.groups as ModelGroup[]) : [])
                })
                .catch(() => {
                    if (!cancelled) setModelGroups([])
                })
        }
        if (skills === null) {
            void skillApi.list()
                .then((data) => {
                    if (cancelled) return
                    // Only AI-chat skills are mentionable in the composer; the other
                    // categories are driven by their own workflows, not `@` mentions.
                    setSkills(
                        (data.skills ?? []).filter(
                            (skill) => skill.enabled && normalizeSkillCategory(skill.category) === 'ai_chat'
                        )
                    )
                })
                .catch(() => {
                    if (!cancelled) setSkills([])
                })
        }
        if (snippets === null && novelId) {
            void snippetApi.list(novelId)
                .then((list) => {
                    if (!cancelled) setSnippets(Array.isArray(list) ? list : [])
                })
                .catch(() => {
                    if (!cancelled) setSnippets([])
                })
        }
        if (materials === null && novelId) {
            void materialApi.list(novelId)
                .then((list) => {
                    if (!cancelled) setMaterials(Array.isArray(list) ? list : [])
                })
                .catch(() => {
                    if (!cancelled) setMaterials([])
                })
        }
        if (acts === null && novelId) {
            void actApi.list(novelId)
                .then((list) => {
                    if (!cancelled) setActs(Array.isArray(list) ? list : [])
                })
                .catch(() => {
                    if (!cancelled) setActs([])
                })
        }
        if (chapters === null && novelId) {
            void chapterApi.list(novelId)
                .then((list) => {
                    if (!cancelled) setChapters(Array.isArray(list) ? list : [])
                })
                .catch(() => {
                    if (!cancelled) setChapters([])
                })
        }
        if (outlines === null && novelId) {
            void outlineApi.list(novelId)
                .then((list) => {
                    if (!cancelled) setOutlines(Array.isArray(list) ? list : [])
                })
                .catch(() => {
                    if (!cancelled) setOutlines([])
                })
        }
        return () => {
            cancelled = true
        }
    }, [mention, modelGroups, skills, snippets, materials, acts, chapters, outlines, novelId])

    const snippetMentions = useMemo(() => buildSnippetMentionList(snippets ?? []), [snippets])
    const materialMentions = useMemo(() => buildMaterialMentionList(materials ?? []), [materials])
    const actMentions = useMemo(() => buildActMentionList(acts ?? [], chapters ?? []), [acts, chapters])
    const chapterMentions = useMemo(() => buildChapterMentionList(chapters ?? []), [chapters])
    const detailedOutlineMentions = useMemo(
        () => buildDetailedOutlineMentionList(outlines ?? [], chapters ?? [], acts ?? []),
        [outlines, chapters, acts]
    )

    const mentionMatches = useMemo<MentionItem[]>(() => {
        if (mention === null) return []
        const rawQuery = mention.query
        const query = rawQuery.toLocaleLowerCase()
        const isNumericQuery = /^\d+$/.test(rawQuery)
        const target = isNumericQuery ? Number(rawQuery) : NaN

        // A bare number is meant for volume/chapter lookup, so skip the name-matched categories — a
        // model like "gemini-3-1-pro" would otherwise match "@1" and crowd the volumes/chapters out.
        const groupItems: MentionItem[] = isNumericQuery ? [] : (modelGroups ?? [])
            .filter((group) => !query || group.name.toLocaleLowerCase().includes(query))
            .map((group) => ({ kind: 'model', group }))
        const skillItems: MentionItem[] = isNumericQuery ? [] : (skills ?? [])
            .filter((skill) => !query || skill.name.toLocaleLowerCase().includes(query))
            .map((skill) => ({ kind: 'skill', skill }))
        const termItems: MentionItem[] = isNumericQuery ? [] : termEntries
            .filter((term) => term.title.trim() && (!query || term.title.toLocaleLowerCase().includes(query)))
            .map((term) => ({ kind: 'term', term }))
        const snippetItems: MentionItem[] = isNumericQuery ? [] : snippetMentions
            .filter((snippet) => !query || snippet.label.toLocaleLowerCase().includes(query))
            .map((snippet) => ({ kind: 'snippet', snippet }))
        // Materials are often named with bare numbers (a chapter number like "1832", a year, …), so —
        // unlike the other name-matched categories — they must still match a numeric query by label.
        const materialItems: MentionItem[] = materialMentions
            .filter((material) => !query || material.label.toLocaleLowerCase().includes(query))
            .map((material) => ({ kind: 'material', material }))
        // Detailed outlines match by the chapter/act number for a numeric query (exact match first),
        // otherwise by label — same behavior as the chapter/volume mentions they mirror.
        const detailedOutlineItems: MentionItem[] = detailedOutlineMentions
            .filter((outline) => {
                if (!query) return true
                if (isNumericQuery) return String(outline.number).startsWith(rawQuery)
                return outline.label.toLocaleLowerCase().includes(query)
            })
            .sort((a, b) => {
                if (!isNumericQuery) return 0
                const aExact = a.number === target ? 0 : 1
                const bExact = b.number === target ? 0 : 1
                return aExact !== bExact ? aExact - bExact : a.number - b.number
            })
            .map((outline) => ({ kind: 'detailedOutline', outline }))

        // Volumes/chapters match by number prefix for a numeric query (with the exact number first),
        // otherwise by title.
        const actItems: MentionItem[] = actMentions
            .filter((act) => {
                if (!query) return true
                if (isNumericQuery) return String(act.actNumber).startsWith(rawQuery)
                return act.title.toLocaleLowerCase().includes(query)
            })
            .sort((a, b) => {
                if (!isNumericQuery) return 0
                const aExact = a.actNumber === target ? 0 : 1
                const bExact = b.actNumber === target ? 0 : 1
                return aExact !== bExact ? aExact - bExact : a.actNumber - b.actNumber
            })
            .map((act) => ({ kind: 'act', act }))
        const chapterItems: MentionItem[] = chapterMentions
            .filter((chapter) => {
                if (!query) return true
                if (isNumericQuery) return String(chapter.number).startsWith(rawQuery)
                return chapter.title.toLocaleLowerCase().includes(query)
            })
            .sort((a, b) => {
                if (!isNumericQuery) return 0
                const aExact = a.number === target ? 0 : 1
                const bExact = b.number === target ? 0 : 1
                return aExact !== bExact ? aExact - bExact : a.number - b.number
            })
            .map((chapter) => ({ kind: 'chapter', chapter }))

        return [...groupItems, ...skillItems, ...termItems, ...snippetItems, ...materialItems, ...detailedOutlineItems, ...actItems, ...chapterItems].slice(0, 10)
    }, [mention, modelGroups, skills, termEntries, snippetMentions, materialMentions, detailedOutlineMentions, actMentions, chapterMentions])

    useEffect(() => {
        setMentionIndex(0)
    }, [mention?.query])

    const closeMention = () => setMention(null)

    const ensureModelGroups = async (): Promise<ModelGroup[]> => {
        if (modelGroups) return modelGroups
        try {
            const response = await authFetch('/api/ai/groups')
            const data = response.ok ? await response.json() : null
            const groups = Array.isArray(data?.groups) ? (data.groups as ModelGroup[]) : []
            setModelGroups(groups)
            return groups
        } catch {
            setModelGroups([])
            return []
        }
    }

    const ensureSkills = async (): Promise<Skill[]> => {
        if (skills) return skills
        try {
            const { skills: list } = await skillApi.list()
            const mentionable = list.filter(
                (skill) => skill.enabled && normalizeSkillCategory(skill.category) === 'ai_chat'
            )
            setSkills(mentionable)
            return mentionable
        } catch {
            setSkills([])
            return []
        }
    }

    const ensureSnippets = async (): Promise<Snippet[]> => {
        if (snippets) return snippets
        if (!novelId) return []
        try {
            const list = await snippetApi.list(novelId)
            const next = Array.isArray(list) ? list : []
            setSnippets(next)
            return next
        } catch {
            setSnippets([])
            return []
        }
    }

    const ensureMaterials = async (): Promise<MaterialSummary[]> => {
        if (materials) return materials
        if (!novelId) return []
        try {
            const list = await materialApi.list(novelId)
            const next = Array.isArray(list) ? list : []
            setMaterials(next)
            return next
        } catch {
            setMaterials([])
            return []
        }
    }

    const ensureActs = async (): Promise<Act[]> => {
        if (acts) return acts
        if (!novelId) return []
        try {
            const list = await actApi.list(novelId)
            const next = Array.isArray(list) ? list : []
            setActs(next)
            return next
        } catch {
            setActs([])
            return []
        }
    }

    const ensureChapters = async (): Promise<Chapter[]> => {
        if (chapters) return chapters
        if (!novelId) return []
        try {
            const list = await chapterApi.list(novelId)
            const next = Array.isArray(list) ? list : []
            setChapters(next)
            return next
        } catch {
            setChapters([])
            return []
        }
    }

    const ensureOutlines = async (): Promise<OutlineSummary[]> => {
        if (outlines) return outlines
        if (!novelId) return []
        try {
            const list = await outlineApi.list(novelId)
            const next = Array.isArray(list) ? list : []
            setOutlines(next)
            return next
        } catch {
            setOutlines([])
            return []
        }
    }

    const handleComposerChange = (value: string, caret: number) => {
        setMention(detectMentionAtCaret(value, caret))
        setSlashCommandDismissed(false)
        // Reset the (transient) plan-hint dismissal once the trigger word leaves the draft, so a
        // fresh "plan" later re-shows the hint while a single dismissal still sticks for this draft.
        if (!/\bplan\b/iu.test(value)) setPlanHintDismissed(false)
        if (value.includes('@')) {
            if (modelGroups === null) void ensureModelGroups()
            if (skills === null) void ensureSkills()
            if (snippets === null) void ensureSnippets()
            if (materials === null) void ensureMaterials()
            if (acts === null) void ensureActs()
            if (chapters === null) void ensureChapters()
            if (outlines === null) void ensureOutlines()
        }
    }

    const insertMentionName = (name: string, sessionId: string) => {
        if (mention === null) return
        const value = selectedSession?.draftContent ?? draft
        // Show a clean `@name` in the textarea; models expand to `[name](model:id)` and skills to
        // `$name` at submit time.
        const token = `@${name} `
        const nextValue = `${value.slice(0, mention.start)}${token}${value.slice(mention.start + 1 + mention.query.length)}`
        updateDraft(novelId, sessionId, nextValue)
        setMention(null)
        const caret = mention.start + token.length
        requestAnimationFrame(() => {
            const textarea = composerRef.current
            if (!textarea) return
            textarea.focus()
            textarea.setSelectionRange(caret, caret)
        })
    }

    const insertMentionItem = (item: MentionItem, sessionId: string) => {
        insertMentionName(mentionItemName(item), sessionId)
    }

    const confirmMention = async () => {
        const item = mentionMatches[mentionIndex]
        if (!item) return
        const sessionId = selectedSession?.id ?? (await ensureSession())
        if (sessionId) insertMentionItem(item, sessionId)
    }

    useEffect(() => {
        void codexApi.listConnections()
            .then(setConnections)
            .catch((error) => {
                console.error('Failed to load Codex connections for model settings:', error)
            })
    }, [])

    const sessions = sessionState?.sessions ?? []
    const selectedSessionId = sessionState?.selectedSessionId ?? null
    const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null
    const draft = selectedSession?.draftContent ?? ''
    const reviewLevel = selectedSession?.reviewLevel ?? 'user_review'
    const modelId = selectedSession?.modelId ?? DEFAULT_CODEX_MODEL
    const reasoningEffort = selectedSession?.reasoningEffort ?? 'high'
    const serviceTier = selectedSession?.serviceTier ?? 'standard'
    const planMode = selectedSession?.planMode ?? false
    const running = selectedSession?.status === 'running'
    const pendingApproval = selectedSession ? pendingApprovalsBySession[selectedSession.id] ?? null : null
    const queuedMessages = selectedSession ? queuedMessagesBySession[selectedSession.id] ?? [] : []
    const queueingEnabled = selectedSession ? queueingEnabledBySession[selectedSession.id] ?? true : true
    const jsonArtifacts = selectedSessionId ? jsonArtifactsBySession[selectedSessionId] ?? [] : []
    const draftIsEmpty = !draft.trim()

    useEffect(() => {
        if (!selectedSession?.id) return
        void codexApi.listConnections()
            .then(setConnections)
            .catch((error) => {
                console.error('Failed to refresh Codex connections for the selected session:', error)
            })
    }, [selectedSession?.id])

    // `/compact` slash command. Only matches when the WHOLE composer is `/` + a prefix of "compact"
    // (so any other text — including a bare "compact" without the slash — suppresses it), the turn
    // is idle, and the session already has a Codex thread worth compacting.
    const slashCommandActive = useMemo(() => {
        if (running || slashCommandDismissed) return false
        if (!selectedSession?.codexThreadId) return false
        const match = /^\/([a-zA-Z]+)$/.exec(draft)
        if (!match) return false
        return 'compact'.startsWith(match[1].toLowerCase())
    }, [draft, running, slashCommandDismissed, selectedSession?.codexThreadId])

    // `/plan` slash command. Unlike `/compact`, it triggers as a trailing `/`-token even with other
    // text in the box (e.g. "你这个 /pl"), needs no Codex thread, and only toggles plan mode locally.
    // Returns the slice range of the command token so activating it can strip the token from the draft.
    const planSlash = useMemo(() => {
        if (running || slashCommandDismissed) return null
        const match = /(^|\s)\/([a-zA-Z]*)$/u.exec(draft)
        if (!match) return null
        const query = match[2].toLowerCase()
        if (query.length === 0 || !'plan'.startsWith(query)) return null
        return { tokenStart: match.index + match[1].length }
    }, [draft, running, slashCommandDismissed])

    // Load model groups and skills when a restored draft already contains an `@` mention so the
    // overlay can highlight it (and the Tweak button can appear) without the user reopening the
    // menu. Skills must be re-ensured here too — otherwise a draft that survives a re-render keeps
    // model/term highlights (those come from other sources) but silently loses the skill pill.
    useEffect(() => {
        if (!draft.includes('@')) return
        if (modelGroups === null) void ensureModelGroups()
        if (skills === null) void ensureSkills()
        if (snippets === null) void ensureSnippets()
        if (materials === null) void ensureMaterials()
        if (acts === null) void ensureActs()
        if (chapters === null) void ensureChapters()
        if (outlines === null) void ensureOutlines()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft, modelGroups, skills, snippets, materials, acts, chapters, outlines])

    const mentionTargets = useMemo<ComposerMentionTarget[]>(
        () => [
            ...(modelGroups ?? []).map((group) => ({ name: group.name, kind: 'model' as const })),
            ...(skills ?? []).map((skill) => ({ name: skill.name, kind: 'skill' as const })),
            ...termEntries
                .map((term) => term.title)
                .filter(Boolean)
                .map((name) => ({ name, kind: 'term' as const })),
            ...snippetMentions.map((snippet) => ({ name: snippet.label, kind: 'snippet' as const })),
            ...materialMentions.map((material) => ({ name: material.label, kind: 'material' as const })),
            ...detailedOutlineMentions.map((outline) => ({ name: outline.label, kind: 'detailedOutline' as const })),
            ...actMentions.map((act) => ({ name: act.label, kind: 'act' as const })),
            ...chapterMentions.map((chapter) => ({ name: chapter.label, kind: 'chapter' as const })),
        ],
        [modelGroups, skills, termEntries, snippetMentions, materialMentions, detailedOutlineMentions, actMentions, chapterMentions]
    )

    const composerSegments = useMemo(
        () => buildComposerSegments(draft, mentionTargets),
        [draft, mentionTargets]
    )

    useLayoutEffect(() => {
        let secondFrame = 0
        syncComposerOverlayScroll()
        const firstFrame = window.requestAnimationFrame(() => {
            syncComposerOverlayScroll()
            secondFrame = window.requestAnimationFrame(syncComposerOverlayScroll)
        })
        return () => {
            window.cancelAnimationFrame(firstFrame)
            if (secondFrame) window.cancelAnimationFrame(secondFrame)
        }
    }, [composerSegments, syncComposerOverlayScroll])

    // The first `@`-mentioned ai_chat skill that carries a bound prompt — it gets a Tweak dialog.
    const activePromptSkill = useMemo(() => {
        if (!draft.includes('@') || !skills) return null
        const promptSkills = skills.filter((skill) => skill.prompt?.trim())
        if (promptSkills.length === 0) return null
        const { skillIds } = expandSkillMentions(draft, promptSkills)
        return promptSkills.find((skill) => skill.id === skillIds[0]) ?? null
    }, [draft, skills])

    // Drop the staged artifact + chat input when the active prompt-skill changes or disappears so a
    // stale draft can't be attached to a different skill's message.
    const activePromptSkillId = activePromptSkill?.id ?? null
    useEffect(() => {
        setTweakBlocks(null)
        setTweakChatInput('')
        setTweakOpen(false)
    }, [activePromptSkillId])

    const timelineMessages = useMemo(() => {
        if (!selectedSession) return []
        return mergeTimelineMessages(
            selectedSession.messages,
            optimisticSteerMessagesBySession[selectedSession.id] ?? []
        )
    }, [optimisticSteerMessagesBySession, selectedSession])
    const latestContextWindow = selectedSession ? getLatestContextWindow(selectedSession.messages) : null
    const latestPlanMessage = selectedSession
        ? [...selectedSession.messages].reverse().find((message) => message.role === 'event' && message.kind === 'plan') ?? null
        : null
    const latestPlanUpdateMessage = selectedSession
        ? [...selectedSession.messages].reverse().find(isPinnedPlanUpdateMessage) ?? null
        : null
    const showPlanProgressCard = Boolean(
        latestPlanUpdateMessage
        && latestPlanUpdateMessage.id !== dismissedPlanUpdateId
    )
    const planComposerActionId = latestPlanMessage ? `plan:${latestPlanMessage.id}` : null
    const showPlanComposerAction = Boolean(
        planComposerActionId
        && planMode
        && !running
        && !draft.trim()
        && !dismissedComposerActions[planComposerActionId]
    )
    const selectedPlanComposerActionOption = planComposerActionId && composerActionSelection?.actionId === planComposerActionId
        ? composerActionSelection.optionId
        : PLAN_COMPOSER_ACTION_OPTIONS[0].id
    const activeConnection = useMemo(() => connections.find((connection) => connection.isActive) ?? null, [connections])
    const sessionConnection = useMemo(
        () => connections.find((connection) => connection.id === selectedSession?.codexConnectionId) ?? activeConnection,
        [activeConnection, connections, selectedSession?.codexConnectionId]
    )
    const hasCodexFastModeAuth = canUseCodexFastMode(sessionConnection)
    const currentModelSupportsFastMode = modelSupportsFastMode(activeModelCatalog, modelId)
    const showServiceTier = hasCodexFastModeAuth && currentModelSupportsFastMode
    const fastModeActive = showServiceTier && serviceTier === 'fast'
    // `/fast` follows the same trailing-token completion behavior as `/plan`: `/fa` is only a
    // prefix used to find the canonical command, not a separate compatibility alias.
    const fastSlash = useMemo(() => {
        if (running || slashCommandDismissed || !showServiceTier) return null
        const match = /(^|\s)\/([a-zA-Z]*)$/u.exec(draft)
        if (!match) return null
        const query = match[2].toLowerCase()
        if (query.length === 0 || !'fast'.startsWith(query)) return null
        return { tokenStart: match.index + match[1].length }
    }, [draft, running, showServiceTier, slashCommandDismissed])
    const quotaSummary = useMemo(
        () =>
            getCodexRateLimitSummary(
                activeConnectionRateLimits,
                (key, values) => t(`codex.${key}` as never, values as never)
            ),
        [activeConnectionRateLimits, t]
    )
    const quotaSummaryText = quotaSummary.join(', ')
    const showQuotaSummary = hasCodexFastModeAuth && hasMeaningfulCodexRateLimits(activeConnectionRateLimits) && quotaSummary.length > 0
    const showPlanHint = !planMode && !planHintDismissed && !running && !planSlash && /\bplan\b/iu.test(draft)
    const approvalOptions = pendingApproval ? getApprovalComposerOptions(pendingApproval, t) : []
    const selectedApprovalOptionId =
        pendingApproval && approvalActionSelection?.approvalId === pendingApproval.id
            ? approvalActionSelection.optionId
            : approvalOptions[0]?.id ?? 'accept'
    const composerButtonTitle = running
        ? draftIsEmpty
            ? 'Stop Codex'
            : queueingEnabled
                ? 'Queue message'
                : 'Steer message'
        : 'Send message'

    useEffect(() => {
        let cancelled = false
        if (!sessionConnection?.id) return

        setActiveModelCatalog([])
        void codexApi.getConnection(sessionConnection.id)
            .then((detail) => {
                if (cancelled) return
                setActiveConnectionRateLimits(detail.rateLimits)
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('Failed to load active Codex connection detail:', error)
                }
            })
        void codexApi.listConnectionModels(sessionConnection.id)
            .then((catalog) => {
                if (!cancelled) setActiveModelCatalog(catalog.models)
            })
            .catch((error) => {
                if (!cancelled) console.error('Failed to load Codex model catalog:', error)
            })

        return () => {
            cancelled = true
        }
    }, [sessionConnection?.id])

    useEffect(() => {
        const wasRunning = previousRunningRef.current
        previousRunningRef.current = running
        if (!wasRunning || running || !sessionConnection?.id) return

        let cancelled = false
        void codexApi.getConnection(sessionConnection.id)
            .then((detail) => {
                if (cancelled) return
                setActiveConnectionRateLimits(detail.rateLimits)
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('Failed to refresh Codex rate limits:', error)
                }
            })

        return () => {
            cancelled = true
        }
    }, [sessionConnection?.id, running])

    useEffect(() => {
        const root = scrollRef.current
        if (!root) return
        root.scrollTop = root.scrollHeight
    }, [selectedSession?.id, selectedSession?.messages.length, running])

    const ensureSession = async () => {
        if (selectedSession) return selectedSession.id
        const sessionId = await createSession(novelId)
        if (sessionId) selectSession(novelId, sessionId)
        return sessionId
    }

    const sendContent = async (
        content: string,
        sessionId?: string | null,
        skillIds?: string[],
        promptArtifact?: CodexPromptArtifact,
        attachments?: string[],
        artifactFiles?: string[]
    ) => {
        if (!content.trim() || running) return
        setRunError(null)
        const targetSessionId = sessionId ?? await ensureSession()
        if (!targetSessionId) return
        try {
            await sendMessage(novelId, targetSessionId, content.trim(), { skillIds, promptArtifact, attachments, artifactFiles })
        } catch (error) {
            setRunError(error instanceof Error ? error.message : String(error))
        }
    }

    const setQueuedMessages = (
        sessionId: string,
        updater: (current: QueuedCodexMessage[]) => QueuedCodexMessage[]
    ) => {
        setQueuedMessagesBySession((current) => ({
            ...current,
            [sessionId]: updater(current[sessionId] ?? []),
        }))
    }

    const setOptimisticSteerMessages = (
        sessionId: string,
        updater: (current: CodexSessionMessage[]) => CodexSessionMessage[]
    ) => {
        setOptimisticSteerMessagesBySession((current) => {
            const nextMessages = updater(current[sessionId] ?? [])
            const previousMessages = current[sessionId] ?? []
            if (
                nextMessages.length === previousMessages.length &&
                nextMessages.every((message, index) => message.id === previousMessages[index]?.id)
            ) {
                return current
            }
            return {
                ...current,
                [sessionId]: nextMessages,
            }
        })
    }

    const enqueueQueuedMessage = (sessionId: string, content: string, attachments: string[]) => {
        setQueuedMessages(sessionId, (current) => [...current, createQueuedCodexMessage(content, attachments)])
    }

    const updateQueuedMessage = (sessionId: string, messageId: string, content: string) => {
        setQueuedMessages(sessionId, (current) =>
            current.map((message) =>
                message.id === messageId
                    ? { ...message, content }
                    : message
            )
        )
    }

    const removeQueuedMessage = (sessionId: string, messageId: string) => {
        setQueuedMessages(sessionId, (current) => current.filter((message) => message.id !== messageId))
    }

    const toggleQueueing = async (sessionId: string, enabled: boolean) => {
        setRunError(null)
        if (enabled) {
            setQueueingEnabledBySession((current) => ({
                ...current,
                [sessionId]: true,
            }))
            return
        }

        const currentQueue = queuedMessagesBySession[sessionId] ?? []
        if (currentQueue.length === 0) {
            setQueueingEnabledBySession((current) => ({
                ...current,
                [sessionId]: false,
            }))
            return
        }

        const merged = mergeQueuedCodexMessages(currentQueue)
        setQueuedMessagesBySession((current) => ({
            ...current,
            [sessionId]: [],
        }))
        setQueueingEnabledBySession((current) => ({
            ...current,
            [sessionId]: false,
        }))

        try {
            if (running) {
                await steerContent(merged.content, sessionId, merged.attachments)
            } else if (merged.content) {
                await sendContent(merged.content, sessionId, undefined, undefined, merged.attachments)
            }
        } catch (error) {
            setQueuedMessagesBySession((current) => ({
                ...current,
                [sessionId]: currentQueue,
            }))
            setQueueingEnabledBySession((current) => ({
                ...current,
                [sessionId]: true,
            }))
            setRunError(error instanceof Error ? error.message : String(error))
        }
    }

    const processQueuedMessage = useEffectEvent(async (sessionId: string, message: QueuedCodexMessage) => {
        if (queueProcessingRef.current === sessionId) return

        queueProcessingRef.current = sessionId
        setQueuedMessages(sessionId, (current) => current.slice(1))

        try {
            await sendContent(message.content, sessionId, undefined, undefined, message.attachments)
        } catch (error) {
            setRunError(error instanceof Error ? error.message : String(error))
            setQueuedMessages(sessionId, (current) => [message, ...current])
        } finally {
            queueProcessingRef.current = null
        }
    })

    const steerContent = async (content: string, sessionId?: string | null, attachments: string[] = []) => {
        const normalizedContent = content.trim()
        if (!normalizedContent) return
        setRunError(null)
        const targetSessionId = sessionId ?? await ensureSession()
        if (!targetSessionId) return
        const optimisticMessage = createOptimisticSteerMessage(normalizedContent, attachments)
        setOptimisticSteerMessages(targetSessionId, (current) => [...current, optimisticMessage])

        try {
            await codexSessionApi.steerMessage(targetSessionId, normalizedContent, attachments)
            updateDraft(novelId, targetSessionId, '')
        } catch (error) {
            setOptimisticSteerMessages(targetSessionId, (current) =>
                current.filter((message) => message.id !== optimisticMessage.id)
            )
            setRunError(error instanceof Error ? error.message : String(error))
            throw error
        }
    }

    const stopTurn = async (sessionId?: string | null) => {
        setRunError(null)
        const targetSessionId = sessionId ?? selectedSession?.id ?? await ensureSession()
        if (!targetSessionId) return

        try {
            await codexSessionApi.stop(targetSessionId)
        } catch (error) {
            setRunError(error instanceof Error ? error.message : String(error))
            throw error
        }
    }

    const runCompaction = () => {
        const sessionId = selectedSession?.id
        if (!sessionId || running) return
        setSlashCommandDismissed(false)
        setRunError(null)
        // The store action clears the draft and flips to the running (stop) state optimistically.
        void compact(novelId, sessionId).catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    // Activate the `/plan` command: toggle plan mode, strip the command token from the draft, keep
    // the rest. It never sends — `/plan` only flips the mode.
    const runPlanSlash = () => {
        if (running || !planSlash) return
        const nextDraft = draft.slice(0, planSlash.tokenStart)
        const caret = nextDraft.length
        setRunError(null)
        void (async () => {
            const sessionId = await applyPlanMode(!planMode)
            if (!sessionId) return
            updateDraft(novelId, sessionId, nextDraft)
            requestAnimationFrame(() => {
                const textarea = composerRef.current
                if (!textarea) return
                textarea.focus()
                textarea.setSelectionRange(caret, caret)
            })
        })().catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    const runFastSlash = () => {
        if (running || !fastSlash) return
        const nextDraft = draft.slice(0, fastSlash.tokenStart)
        const caret = nextDraft.length
        setRunError(null)
        void (async () => {
            const sessionId = await applyModelSettings({
                serviceTier: fastModeActive ? 'standard' : 'fast',
            })
            if (!sessionId) return
            updateDraft(novelId, sessionId, nextDraft)
            requestAnimationFrame(() => {
                const textarea = composerRef.current
                if (!textarea) return
                textarea.focus()
                textarea.setSelectionRange(caret, caret)
            })
        })().catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    const submit = () => {
        // A pending `/compact` is a command, never a message — route it to compaction even if the
        // user clicks the send button instead of pressing Tab/Enter.
        if (slashCommandActive) {
            runCompaction()
            return
        }
        // Likewise `/plan` is a command — toggle plan mode instead of sending the literal text.
        if (planSlash) {
            runPlanSlash()
            return
        }
        if (fastSlash) {
            runFastSlash()
            return
        }
        if (!draft.trim() || imageAttachments.uploading || jsonArtifactUploading) return

        void (async () => {
            const targetSessionId = selectedSession?.id ?? await ensureSession()
            if (!targetSessionId) return

            const hasMention = draft.includes('@')
            const groups = hasMention ? await ensureModelGroups() : []
            const skillList = hasMention ? await ensureSkills() : []
            const snippetList = hasMention ? await ensureSnippets() : []
            const materialList = hasMention ? await ensureMaterials() : []
            const actList = hasMention ? await ensureActs() : []
            const chapterList = hasMention ? await ensureChapters() : []
            const outlineList = hasMention ? await ensureOutlines() : []
            const expandedModels = expandModelMentions(draft, groups)
            const { text: expandedSkills, skillIds } = expandSkillMentions(expandedModels, skillList)
            const expandedTerms = expandTermMentions(expandedSkills, hasMention ? termEntries : [])
            const expandedSnippets = expandSnippetMentions(expandedTerms, hasMention ? buildSnippetMentionList(snippetList) : [])
            const expandedMaterials = expandMaterialMentions(expandedSnippets, hasMention ? buildMaterialMentionList(materialList) : [])
            // 细纲 must expand before volumes/chapters: its label is a superstring of the chapter label,
            // so doing it first stops the chapter/volume passes from clipping "第 5 章 标题 细纲".
            const expandedOutlines = expandDetailedOutlineMentions(expandedMaterials, hasMention ? buildDetailedOutlineMentionList(outlineList, chapterList, actList) : [])
            const expandedActs = expandActMentions(expandedOutlines, hasMention ? buildActMentionList(actList, chapterList) : [])
            const expandedText = expandChapterMentions(expandedActs, hasMention ? buildChapterMentionList(chapterList) : [])
            const content = expandedText.trim()
            if (!content) return
            const attachments = imageAttachments.readyUrls
            const artifactFiles = jsonArtifacts.map((artifact) => artifact.fileName)

            if (running) {
                if (queueingEnabled) {
                    // Steering/queueing can't carry a skill input item; the `$name` text still
                    // lets Codex resolve the skill itself.
                    enqueueQueuedMessage(targetSessionId, content, attachments)
                    imageAttachments.clear()
                    updateDraft(novelId, targetSessionId, '')
                    return
                }

                imageAttachments.clear()
                await steerContent(content, targetSessionId, attachments)
                return
            }

            // If the author tweaked a bound-prompt skill, ship the resolved blocks so the route can
            // materialize them into the session's artifacts for run_llm / context.
            const promptArtifact: CodexPromptArtifact | undefined =
                activePromptSkill && skillIds.includes(activePromptSkill.id) && tweakBlocks && tweakBlocks.length > 0
                    ? { skillId: activePromptSkill.id, renderedBlocks: tweakBlocks }
                    : undefined

            setTweakOpen(false)
            imageAttachments.clear()
            setJsonArtifactsBySession((current) => ({ ...current, [targetSessionId]: [] }))
            await sendContent(content, targetSessionId, skillIds, promptArtifact, attachments, artifactFiles)
            setTweakBlocks(null)
            setTweakChatInput('')
        })().catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    useEffect(() => {
        if (!selectedSession?.id || running) return
        const nextQueuedMessage = queuedMessagesBySession[selectedSession.id]?.[0]
        if (!nextQueuedMessage) return

        void processQueuedMessage(selectedSession.id, nextQueuedMessage)
    }, [queuedMessagesBySession, running, selectedSession?.id])

    useEffect(() => {
        if (!selectedSession?.id) return

        const committedSteerContents = new Set(
            selectedSession.messages
                .filter((message) => message.role === 'event' && message.kind === 'steer')
                .map((message) => message.content)
        )
        if (committedSteerContents.size === 0) return

        setOptimisticSteerMessages(selectedSession.id, (current) =>
            current.filter((message) => !committedSteerContents.has(message.content))
        )
    }, [selectedSession])

    const selectReviewLevel = (nextReviewLevel: CodexReviewLevel) => {
        void (async () => {
            const sessionId = selectedSession?.id ?? await ensureSession()
            if (!sessionId) return
            await updateReviewLevel(novelId, sessionId, nextReviewLevel)
        })().catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    const applyModelSettings = async (
        settings: Partial<{ modelId: string; reasoningEffort: CodexReasoningEffort; serviceTier: CodexServiceTier }>
    ) => {
        const sessionId = selectedSession?.id ?? await ensureSession()
        if (!sessionId) return null
        const nextSettings = settings.modelId
            && serviceTier === 'fast'
            && !modelSupportsFastMode(activeModelCatalog, settings.modelId)
            ? { ...settings, serviceTier: 'standard' as const }
            : settings
        await updateModelSettings(novelId, sessionId, nextSettings)
        return sessionId
    }

    const selectModelSetting = (
        settings: Partial<{ modelId: string; reasoningEffort: CodexReasoningEffort; serviceTier: CodexServiceTier }>
    ) => {
        void applyModelSettings(settings).catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    const setFastMode = (enabled: boolean) => {
        void applyModelSettings({ serviceTier: enabled ? 'fast' : 'standard' }).catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    const dismissPlanHint = () => {
        setPlanHintDismissed(true)
    }

    const applyPlanMode = async (nextPlanMode: boolean) => {
        const sessionId = selectedSession?.id ?? await ensureSession()
        if (!sessionId) return null
        await updatePlanMode(novelId, sessionId, nextPlanMode)
        return sessionId
    }

    const setPlanMode = (nextPlanMode: boolean) => {
        void applyPlanMode(nextPlanMode).catch((error) => {
            setRunError(error instanceof Error ? error.message : String(error))
        })
    }

    const dismissComposerAction = (actionId: string | null) => {
        if (!actionId) return
        setDismissedComposerActions((current) => ({ ...current, [actionId]: true }))
        setComposerActionInput('')
    }

    const selectComposerActionOption = (actionId: string, optionId: string) => {
        setComposerActionSelection({ actionId, optionId })
    }

    const submitPlanComposerAction = (optionId: string, inputValue: string) => {
        if (!planComposerActionId || running) return

        if (optionId === 'revise') {
            const content = inputValue.trim()
            if (!content) return
            setDismissedComposerActions((current) => ({ ...current, [planComposerActionId]: true }))
            setComposerActionInput('')
            void sendContent(content)
            return
        }

        setDismissedComposerActions((current) => ({ ...current, [planComposerActionId]: true }))
        setComposerActionInput('')
        void (async () => {
            try {
                const sessionId = await applyPlanMode(false)
                if (!sessionId) return
                await sendContent('Yes, implement this plan.', sessionId)
            } catch (error) {
                setRunError(error instanceof Error ? error.message : String(error))
            }
        })()
    }

    const submitApprovalAction = (optionId: string, inputValue: string) => {
        if (!pendingApproval) return
        if (resolvingApprovalRef.current === pendingApproval.id) return
        const decision = optionId as CodexApprovalOption
        const message = inputValue.trim()
        if (decision === 'steer' && !message) return

        const approvalId = pendingApproval.id
        const sessionId = selectedSession?.id ?? pendingApproval.sessionId
        resolvingApprovalRef.current = approvalId
        setResolvingApprovalId(approvalId)
        setApprovalActionInput('')
        setApprovalActionSelection(null)
        void resolveApproval(sessionId, approvalId, decision, message)
            .catch((error) => {
                setRunError(error instanceof Error ? error.message : String(error))
            })
            .finally(() => {
                resolvingApprovalRef.current = null
                setResolvingApprovalId(null)
            })
    }

    const dismissApprovalAction = () => {
        if (!pendingApproval) return
        if (resolvingApprovalRef.current === pendingApproval.id) return
        const approvalId = pendingApproval.id
        const sessionId = selectedSession?.id ?? pendingApproval.sessionId
        resolvingApprovalRef.current = approvalId
        setResolvingApprovalId(approvalId)
        setApprovalActionInput('')
        setApprovalActionSelection(null)
        void resolveApproval(sessionId, approvalId, 'decline')
            .catch((error) => {
                setRunError(error instanceof Error ? error.message : String(error))
            })
            .finally(() => {
                resolvingApprovalRef.current = null
                setResolvingApprovalId(null)
            })
    }

    return (
        <CodexNovelIdContext.Provider value={novelId}>
        <CodexSessionIdContext.Provider value={selectedSession?.id ?? null}>
        <CodexNavContext.Provider value={onNavigateToWrite}>
        <ImageViewerExtraActionsProvider render={(src) => <TermGalleryImportButton novelId={novelId} src={src} />}>
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <span className="truncate text-sm font-medium">{selectedSession?.title || t('codex.untitled')}</span>
                </div>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => void createSession(novelId)}
                    title={t('codex.newSession')}
                    aria-label={t('codex.newSession')}
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <div className="flex min-h-full w-full min-w-0 flex-col px-4 py-4">
                    {!selectedSession || timelineMessages.length === 0 ? (
                        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center text-muted-foreground">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-muted-foreground/20 text-muted-foreground/60">
                                <Bot className="h-8 w-8" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-sm font-medium text-foreground">{t('codex.startTitle')}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <CodexTimeline
                                messages={timelineMessages}
                                running={running}
                                scrollRootRef={scrollRef}
                            />
                            {running && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <CircleStop className="h-3.5 w-3.5 animate-pulse" />
                                    <span>{t('codex.running')}</span>
                                </div>
                            )}
                            {(runError || selectedSession.lastError) && (
                                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                    {runError || selectedSession.lastError}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="shrink-0 p-3">
                {selectedSession && queuedMessages.length > 0 && (
                    <div className="mb-3 space-y-2">
                        <div className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                            <CornerDownRight className="h-4 w-4 shrink-0" />
                            <span className="truncate">Queued messages</span>
                            <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                                {queuedMessages.length}
                            </Badge>
                        </div>
                        <div className="space-y-2">
                            {queuedMessages.map((message) => (
                                <QueuedMessageRow
                                    key={message.id}
                                    message={message}
                                    onSave={(content) => updateQueuedMessage(selectedSession.id, message.id, content)}
                                    onDelete={() => removeQueuedMessage(selectedSession.id, message.id)}
                                    onSteer={() => {
                                        void (async () => {
                                            const targetSessionId = selectedSession.id
                                            removeQueuedMessage(targetSessionId, message.id)
                                            try {
                                                await steerContent(message.content, targetSessionId, message.attachments)
                                            } catch {
                                                enqueueQueuedMessage(targetSessionId, message.content, message.attachments)
                                            }
                                        })()
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {showPlanProgressCard && latestPlanUpdateMessage && (
                    <div className="mb-3">
                        <PlanProgressCard
                            key={`${selectedSession?.id ?? 'no-session'}:${latestPlanUpdateMessage.id}`}
                            content={latestPlanUpdateMessage.content.split(/\n\n/u).slice(1).join('\n\n') || latestPlanUpdateMessage.content}
                            title="Progress"
                            hideLabel="Hide progress"
                            onHide={() => setDismissedPlanUpdateId(latestPlanUpdateMessage.id)}
                        />
                    </div>
                )}
                {showPlanHint && !showPlanComposerAction && (
                    <div className="mb-3 flex justify-center px-2">
                        <div className="inline-flex max-w-full items-center justify-center gap-3 rounded-[1.35rem] border bg-background/95 px-4 py-2.5 text-sm shadow-lg shadow-black/10 backdrop-blur">
                            <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{t('codex.createPlan')}</span>
                            <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-8 rounded-full px-4"
                                onClick={() => setPlanMode(true)}
                                disabled={running}
                            >
                                {t('codex.usePlanMode')}
                            </Button>
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                className="h-8 w-8 rounded-full"
                                onClick={dismissPlanHint}
                                title={t('codex.dismissPlanHint')}
                                aria-label={t('codex.dismissPlanHint')}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
                {pendingApproval ? (
                    <CodexComposerActionPrompt
                        title={getApprovalTitle(pendingApproval, t)}
                        detail={getApprovalDetail(pendingApproval)}
                        options={approvalOptions}
                        selectedOptionId={selectedApprovalOptionId}
                        inputValue={approvalActionInput}
                        submitLabel={t('codex.approval.submit')}
                        dismissLabel={t('codex.approval.dismiss')}
                        disabled={resolvingApprovalId === pendingApproval.id}
                        onSelect={(optionId) => setApprovalActionSelection({ approvalId: pendingApproval.id, optionId })}
                        onInputChange={setApprovalActionInput}
                        onSubmit={submitApprovalAction}
                        onDismiss={dismissApprovalAction}
                    />
                ) : showPlanComposerAction && planComposerActionId ? (
                    <CodexComposerActionPrompt
                        title="Implement this plan?"
                        options={PLAN_COMPOSER_ACTION_OPTIONS}
                        selectedOptionId={selectedPlanComposerActionOption}
                        inputValue={composerActionInput}
                        submitLabel="Submit"
                        disabled={running}
                        onSelect={(optionId) => selectComposerActionOption(planComposerActionId, optionId)}
                        onInputChange={setComposerActionInput}
                        onSubmit={submitPlanComposerAction}
                        onDismiss={() => dismissComposerAction(planComposerActionId)}
                    />
                ) : (
                    <>
                    {activePromptSkill && (
                        <div className="mb-2 flex justify-end">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 gap-2 rounded-full"
                                onClick={() => setTweakOpen(true)}
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                {t('codexSkillTweak.tweak')}
                                {tweakBlocks && tweakBlocks.length > 0 && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                            </Button>
                        </div>
                    )}
                    <div
                        className={cn(
                            'relative rounded-[1.6rem] border bg-background px-3 py-3 shadow-sm transition-colors',
                            composerDragActive && 'border-primary/70'
                        )}
                        onDrop={handleComposerDrop}
                        onDragEnter={handleComposerDragEnter}
                        onDragOver={handleComposerDragOver}
                        onDragLeave={handleComposerDragLeave}
                    >
                    {composerDragActive && (
                        <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center rounded-[1.6rem] border-2 border-dashed border-primary bg-background/95 px-6 text-center shadow-sm backdrop-blur-sm">
                            <div className="flex items-center gap-3 text-primary">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                                    <Paperclip className="h-5 w-5" />
                                </span>
                                <div className="text-left">
                                    <div className="text-sm font-medium">{t('codex.dropFilesTitle')}</div>
                                    <div className="mt-0.5 text-xs text-muted-foreground">{t('codex.dropFilesDescription')}</div>
                                </div>
                            </div>
                        </div>
                    )}
                    <AttachmentStrip items={imageAttachments.items} onRemove={imageAttachments.removeItem} className="mb-2" />
                    {jsonArtifacts.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                            {jsonArtifacts.map((artifact) => (
                                <span
                                    key={artifact.fileName}
                                    className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 text-xs text-foreground"
                                >
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{artifact.originalName}</span>
                                    <button
                                        type="button"
                                        className="shrink-0 text-muted-foreground hover:text-foreground"
                                        title={t('codex.artifactRemove')}
                                        aria-label={t('codex.artifactRemove')}
                                        onClick={() => {
                                            if (!selectedSessionId) return
                                            setJsonArtifactsBySession((current) => ({
                                                ...current,
                                                [selectedSessionId]: (current[selectedSessionId] ?? []).filter((item) => item.fileName !== artifact.fileName),
                                            }))
                                        }}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    {mention !== null && (
                        <CodexMentionMenu
                            items={mentionMatches}
                            activeIndex={mentionIndex}
                            loading={modelGroups === null || skills === null}
                            onHover={setMentionIndex}
                            onSelect={(item) => {
                                const sessionId = selectedSession?.id
                                if (sessionId) {
                                    insertMentionItem(item, sessionId)
                                    return
                                }
                                void confirmMention()
                            }}
                        />
                    )}
                    {slashCommandActive && mention === null && (
                        <div className="absolute bottom-full left-2 right-2 z-50 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg">
                            <button
                                type="button"
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent"
                                // mousedown (not click) fires before the textarea blur so the menu acts before it closes.
                                onMouseDown={(event) => {
                                    event.preventDefault()
                                    runCompaction()
                                }}
                            >
                                <FoldVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="text-sm font-medium text-foreground">{t('codex.slashCompact.title')}</span>
                                <span className="truncate text-xs text-muted-foreground">{t('codex.slashCompact.description')}</span>
                            </button>
                        </div>
                    )}
                    {planSlash && !slashCommandActive && mention === null && (
                        <div className="absolute bottom-full left-2 right-2 z-50 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg">
                            <button
                                type="button"
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent"
                                // mousedown (not click) fires before the textarea blur so the menu acts before it closes.
                                onMouseDown={(event) => {
                                    event.preventDefault()
                                    runPlanSlash()
                                }}
                            >
                                <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="text-sm font-medium text-foreground">{t('codex.slashPlan.title')}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {planMode ? t('codex.slashPlan.turnOff') : t('codex.slashPlan.turnOn')}
                                </span>
                            </button>
                        </div>
                    )}
                    {fastSlash && !slashCommandActive && !planSlash && mention === null && (
                        <div className="absolute bottom-full left-2 right-2 z-50 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg">
                            <button
                                type="button"
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent"
                                onMouseDown={(event) => {
                                    event.preventDefault()
                                    runFastSlash()
                                }}
                            >
                                <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="text-sm font-medium text-foreground">{t('codex.slashFast.title')}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {fastModeActive ? t('codex.slashFast.turnOff') : t('codex.slashFast.turnOn')}
                                </span>
                            </button>
                        </div>
                    )}
                    <div className="relative">
                    <div
                        ref={composerOverlayRef}
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-[2] max-h-48 min-h-10 overflow-hidden"
                    >
                        <div
                            ref={composerOverlayTextRef}
                            className="whitespace-pre-wrap break-words px-1 py-1 text-sm text-transparent will-change-transform"
                        >
                            {composerSegments.map((segment, index) =>
                                segment.type === 'mention' ? (
                                    <span
                                        key={index}
                                        className={cn(
                                            'rounded-sm bg-muted [box-decoration-break:clone]',
                                            getComposerMentionTextClass(segment.kind)
                                        )}
                                    >
                                        {segment.text}
                                    </span>
                                ) : (
                                    <span key={index}>{segment.text}</span>
                                )
                            )}
                        </div>
                    </div>
                    <AutoResizeTextarea
                        ref={composerRef}
                        value={draft}
                        rows={1}
                        placeholder={t('codex.composerPlaceholder')}
                        className="onw-editor-scrollbar relative z-[1] max-h-48 min-h-10 overflow-auto border-0 bg-transparent px-1 py-1 text-sm text-foreground shadow-none selection:bg-primary/30 focus-visible:ring-0"
                        onScroll={syncComposerOverlayScroll}
                        onChange={(event) => {
                            const { value, selectionStart } = event.target
                            handleComposerChange(value, selectionStart ?? value.length)
                            if (!selectedSession) {
                                void (async () => {
                                    const sessionId = await ensureSession()
                                    if (sessionId) updateDraft(novelId, sessionId, value)
                                })()
                                return
                            }
                            updateDraft(novelId, selectedSession.id, value)
                        }}
                        onPaste={imageAttachments.handlePaste}
                        onBlur={() => {
                            // Delay so a menu click (mousedown) can fire before close.
                            window.setTimeout(closeMention, 120)
                        }}
                        onKeyDown={(event) => {
                            if (isKeyboardEventComposing(event)) return
                            if (slashCommandActive && mention === null) {
                                if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                                    event.preventDefault()
                                    runCompaction()
                                    return
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setSlashCommandDismissed(true)
                                    return
                                }
                            }
                            if (planSlash && !slashCommandActive && mention === null) {
                                if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                                    event.preventDefault()
                                    runPlanSlash()
                                    return
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setSlashCommandDismissed(true)
                                    return
                                }
                            }
                            if (fastSlash && !slashCommandActive && !planSlash && mention === null) {
                                if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                                    event.preventDefault()
                                    runFastSlash()
                                    return
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setSlashCommandDismissed(true)
                                    return
                                }
                            }
                            if (mention !== null && event.key === 'Escape') {
                                event.preventDefault()
                                closeMention()
                                return
                            }
                            if (mention !== null && mentionMatches.length > 0) {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault()
                                    setMentionIndex((index) => (index + 1) % mentionMatches.length)
                                    return
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault()
                                    setMentionIndex((index) => (index - 1 + mentionMatches.length) % mentionMatches.length)
                                    return
                                }
                                if (event.key === 'Enter' || event.key === 'Tab') {
                                    event.preventDefault()
                                    void confirmMention()
                                    return
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault()
                                    closeMention()
                                    return
                                }
                            }
                            // Backspace at a mention edge deletes the whole `@mention` token at once.
                            if (event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                                const { selectionStart, selectionEnd } = event.currentTarget
                                if (selectionStart !== null && selectionStart === selectionEnd) {
                                    const removal = findMentionTokenToDeleteBeforeCaret(draft, selectionStart, mentionTargets)
                                    if (removal) {
                                        event.preventDefault()
                                        const nextValue = draft.slice(0, removal.start) + draft.slice(removal.end)
                                        const caret = removal.start
                                        setMention(detectMentionAtCaret(nextValue, caret))
                                        const applyCaret = () => requestAnimationFrame(() => {
                                            const textarea = composerRef.current
                                            if (!textarea) return
                                            textarea.focus()
                                            textarea.setSelectionRange(caret, caret)
                                        })
                                        if (selectedSession) {
                                            updateDraft(novelId, selectedSession.id, nextValue)
                                            applyCaret()
                                        } else {
                                            void (async () => {
                                                const sessionId = await ensureSession()
                                                if (sessionId) updateDraft(novelId, sessionId, nextValue)
                                                applyCaret()
                                            })()
                                        }
                                        return
                                    }
                                }
                            }
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                submit()
                            }
                        }}
                    />
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2 pr-11">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    title={t('codex.composerSettings')}
                                    aria-label={t('codex.composerSettings')}
                                >
                                    <SlidersHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-52">
                                <DropdownMenuItem disabled={running} onSelect={() => setPlanMode(!planMode)}>
                                    <ListChecks className="h-4 w-4" />
                                    <span>{t('codex.plan')}</span>
                                    <span
                                        role="switch"
                                        aria-checked={planMode}
                                        className={cn(
                                            'ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
                                            planMode ? 'bg-primary' : 'bg-muted'
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                                                planMode && 'translate-x-4'
                                            )}
                                        />
                                    </span>
                                </DropdownMenuItem>
                                {showServiceTier && (
                                    <DropdownMenuItem disabled={running} onSelect={() => setFastMode(!fastModeActive)}>
                                        <Zap className="h-4 w-4" />
                                        <span>{t('codex.serviceTiers.fast')}</span>
                                        <span
                                            role="switch"
                                            aria-checked={fastModeActive}
                                            className={cn(
                                                'ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
                                                fastModeActive ? 'bg-primary' : 'bg-muted'
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                                                    fastModeActive && 'translate-x-4'
                                                )}
                                            />
                                        </span>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                    disabled={!selectedSession}
                                    onSelect={() => {
                                        if (!selectedSession) return
                                        void toggleQueueing(selectedSession.id, !queueingEnabled)
                                    }}
                                >
                                    {queueingEnabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                                    <span>{queueingEnabled ? t('codex.turnOffQueueing') : t('codex.turnOnQueueing')}</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <input
                            ref={composerFileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/json,.json"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                                void addComposerFiles(Array.from(event.target.files ?? []))
                                event.target.value = ''
                            }}
                        />
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            title={t('codex.artifactAdd')}
                            aria-label={t('codex.artifactAdd')}
                            onClick={() => composerFileInputRef.current?.click()}
                        >
                            <Paperclip className="h-4 w-4" />
                        </Button>
                        {planMode && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="group h-8 gap-2 rounded-full bg-muted/70 px-3 text-muted-foreground hover:bg-sky-100 hover:text-foreground"
                                disabled={running}
                                onClick={() => setPlanMode(false)}
                                title={t('codex.disablePlan')}
                            >
                                <span className="flex h-4 w-4 items-center justify-center">
                                    <ListChecks className="h-4 w-4 group-hover:hidden" />
                                    <span className="hidden h-4 w-4 items-center justify-center rounded-full bg-muted-foreground text-background group-hover:flex">
                                        <X className="h-3 w-3" />
                                    </span>
                                </span>
                                <span>{t('codex.plan')}</span>
                            </Button>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={cn(
                                        'min-w-0 gap-1',
                                        reviewLevel === 'no_review' ? 'text-amber-700' : 'text-muted-foreground'
                                    )}
                                >
                                    <Shield className="h-4 w-4" />
                                    <span className="truncate">{t(`codex.reviewLevels.${reviewLevel}`)}</span>
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-44">
                                <DropdownMenuRadioGroup
                                    value={reviewLevel}
                                    onValueChange={(value) => selectReviewLevel(value as CodexReviewLevel)}
                                >
                                    {CODEX_REVIEW_LEVELS.map((level) => (
                                        <DropdownMenuRadioItem key={level} value={level}>
                                            {t(`codex.reviewLevels.${level}`)}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {showQuotaSummary && (
                            <div className="min-w-0 flex-1 px-1">
                                <div
                                    className="flex items-center justify-center"
                                    title={quotaSummaryText}
                                    aria-label={t('codex.remainingQuota')}
                                >
                                    <div className="max-w-full truncate rounded-full bg-muted px-3 py-1 text-[11px] leading-none text-muted-foreground">
                                        {quotaSummaryText}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="ml-auto flex min-w-0 max-w-[55%] items-center gap-1 overflow-hidden">
                            <ContextWindowIndicator contextWindow={latestContextWindow} />
                            <div className="min-w-0 flex-1 overflow-hidden">
                                <CodexModelPicker
                                    modelId={modelId}
                                    reasoningEffort={reasoningEffort}
                                    serviceTier={serviceTier}
                                    models={activeModelCatalog}
                                    includeBuiltinModels={
                                        sessionConnection?.providerType !== 'custom' || isNativeCodexModelId(modelId)
                                    }
                                    showServiceTier={showServiceTier}
                                    disabled={running}
                                    onChange={selectModelSetting}
                                />
                            </div>
                        </div>
                    </div>
                    <Button
                        type="button"
                        size="icon-sm"
                        className="absolute bottom-3 right-3 h-9 w-9 rounded-full"
                        disabled={!running && draftIsEmpty}
                        onClick={() => {
                            if (running && draftIsEmpty) {
                                void stopTurn(selectedSession?.id)
                                return
                            }
                            submit()
                        }}
                        title={composerButtonTitle}
                        aria-label={composerButtonTitle}
                    >
                        {running && draftIsEmpty ? (
                            <CircleStop className="h-3.5 w-3.5 animate-pulse" />
                        ) : running ? (
                            <ArrowUp className="h-4 w-4" />
                        ) : (
                            <SendHorizonal className="h-4 w-4" />
                        )}
                    </Button>
                    </div>
                    </>
                )}
            </div>
        </div>
        {activePromptSkill && novelId && (
            <CodexSkillTweakDialog
                novelId={novelId}
                sessionId={selectedSession?.id ?? null}
                skill={activePromptSkill}
                open={tweakOpen}
                onOpenChange={setTweakOpen}
                chatInput={tweakChatInput}
                onChatInputChange={setTweakChatInput}
                onBlocksChange={setTweakBlocks}
                onSend={submit}
                disabled={running}
            />
        )}
        </ImageViewerExtraActionsProvider>
        </CodexNavContext.Provider>
        </CodexSessionIdContext.Provider>
        </CodexNovelIdContext.Provider>
    )
}
