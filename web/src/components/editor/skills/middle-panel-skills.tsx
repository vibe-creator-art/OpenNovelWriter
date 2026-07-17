'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Check,
    ChevronDown,
    ChevronRight,
    FolderOpen,
    List,
    MessageCircle,
    MoreVertical,
    PenLine,
    Plus,
    Search,
    Sparkles,
    X,
    type LucideIcon,
} from 'lucide-react'

import {
    ApiError,
    promptApi,
    skillApi,
    skillPresetApi,
    type BuiltinSkillPreset,
    type Prompt,
    type Skill,
} from '@/lib/api'
import { normalizeSkillCategory, type SkillCategory } from '@/lib/skills'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { SkillPresetLibrarySection } from '@/components/editor/skills/skill-preset-library-section'
import { SkillPresetPublishDialog } from '@/components/editor/skills/skill-preset-publish-dialog'
import { SkillDirectoryBrowserDialog } from '@/components/editor/skills/skill-directory-browser-dialog'

const CATEGORY_ITEMS: Array<{ id: SkillCategory; icon: LucideIcon; translationKey: string }> = [
    { id: 'scene_continuation', icon: PenLine, translationKey: 'sceneContinuation' },
    { id: 'scene_action', icon: List, translationKey: 'sceneAction' },
    { id: 'ai_chat', icon: MessageCircle, translationKey: 'aiChat' },
]

const DEFAULT_EXPANDED_CATEGORIES: Record<SkillCategory, boolean> = {
    scene_continuation: true,
    scene_action: true,
    ai_chat: true,
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type MiddlePanelSkillsProps = {
    novelId?: string
}

function escapeDoubleQuotedYaml(value: string) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function extractSkillNameFromMarkdown(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return null
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return null

    const frontmatter = normalized.slice(4, closingIndex)
    const match = frontmatter.match(/^name\s*:\s*(.+)$/m)
    if (!match) return null

    const raw = match[1]?.trim() ?? ''
    if (
        (raw.startsWith('"') && raw.endsWith('"'))
        || (raw.startsWith("'") && raw.endsWith("'"))
    ) {
        return raw.slice(1, -1)
    }
    return raw
}

function extractSkillDescriptionFromMarkdown(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return null
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return null

    const frontmatter = normalized.slice(4, closingIndex)
    const match = frontmatter.match(/^description\s*:\s*(.+)$/m)
    if (!match) return null

    const raw = match[1]?.trim() ?? ''
    if (
        (raw.startsWith('"') && raw.endsWith('"'))
        || (raw.startsWith("'") && raw.endsWith("'"))
    ) {
        return raw.slice(1, -1)
    }
    return raw
}

function replaceSkillNameInMarkdown(content: string, nextName: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return normalized

    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return normalized

    const frontmatter = normalized.slice(4, closingIndex)
    const body = normalized.slice(closingIndex + 5)
    const nextFrontmatterLine = `name: ${escapeDoubleQuotedYaml(nextName)}`
    const nextFrontmatter = /^name\s*:\s*.+$/m.test(frontmatter)
        ? frontmatter.replace(/^name\s*:\s*.+$/m, nextFrontmatterLine)
        : `${nextFrontmatterLine}\n${frontmatter}`

    return `---\n${nextFrontmatter}\n---\n${body}`
}

function replaceSkillDescriptionInMarkdown(content: string, description: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return normalized

    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return normalized

    const frontmatter = normalized.slice(4, closingIndex)
    const body = normalized.slice(closingIndex + 5)
    const nextFrontmatterLine = `description: ${escapeDoubleQuotedYaml(description)}`
    const nextFrontmatter = /^description\s*:\s*.+$/m.test(frontmatter)
        ? frontmatter.replace(/^description\s*:\s*.+$/m, nextFrontmatterLine)
        : `${frontmatter}\n${nextFrontmatterLine}`

    return `---\n${nextFrontmatter}\n---\n${body}`
}

/** The markdown body after the frontmatter block — this is the only part the user edits directly.
 *  Returned verbatim (no trimming) so extract/replace round-trip is idempotent: trimming on every
 *  render would fight edits at the very top (e.g. pressing Enter on line 1 would be undone, and the
 *  controlled textarea would jump the caret to the end). The body is flushed to the top once on load
 *  via {@link normalizeSkillDraftContent} instead. */
function extractSkillBodyFromMarkdown(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return normalized
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return normalized
    return normalized.slice(closingIndex + 5)
}

/** Strip the blank line(s) between the frontmatter and the body once, when a skill is loaded into the
 *  draft, so the body renders flush to the top without a non-idempotent per-render transform. */
function normalizeSkillDraftContent(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return normalized
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return normalized
    const frontmatter = normalized.slice(4, closingIndex)
    const body = normalized.slice(closingIndex + 5).replace(/^\n+/, '')
    return `---\n${frontmatter}\n---\n${body}`
}

/** Replace the body while keeping the frontmatter intact (frontmatter is edited via the fields above).
 *  Verbatim reconstruction — the inverse of {@link extractSkillBodyFromMarkdown} — so editing is stable. */
function replaceSkillBodyInMarkdown(content: string, body: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return body
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return body
    const frontmatter = normalized.slice(4, closingIndex)
    return `---\n${frontmatter}\n---\n${body}`
}

export function MiddlePanelSkills({ novelId }: MiddlePanelSkillsProps) {
    const t = useTranslations('skills')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [skills, setSkills] = useState<Skill[]>([])
    const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<SkillCategory>('scene_continuation')
    const [expandedCategories, setExpandedCategories] = useState<Record<SkillCategory, boolean>>(DEFAULT_EXPANDED_CATEGORIES)
    const [searchQuery, setSearchQuery] = useState('')
    const [draftContent, setDraftContent] = useState('')
    const [draftCategory, setDraftCategory] = useState<SkillCategory | null>(null)
    const [draftPrompt, setDraftPrompt] = useState('')
    const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
    // Tracks which skill `draftContent` currently belongs to. Unlike a ref, this state value is
    // captured per-render, so it stays "stale" during the transitional render right after the
    // selection switches — letting the autosave effect skip that render instead of validating the
    // previous skill's draft against the newly selected skill (which produced a false "name exists").
    const [draftSkillId, setDraftSkillId] = useState<string | null>(null)
    const [saveState, setSaveState] = useState<SaveState>('idle')
    const [isEditingName, setIsEditingName] = useState(false)
    const [prompts, setPrompts] = useState<Prompt[]>([])
    const [promptsLoaded, setPromptsLoaded] = useState(false)

    const [builtinPresets, setBuiltinPresets] = useState<BuiltinSkillPreset[]>([])
    const [builtinPresetsLoading, setBuiltinPresetsLoading] = useState(true)
    const [builtinPresetsError, setBuiltinPresetsError] = useState<string | null>(null)
    const [presetAuthoringEnabled, setPresetAuthoringEnabled] = useState(false)
    const [cloningPresetId, setCloningPresetId] = useState<string | null>(null)
    const [cloningAllPresets, setCloningAllPresets] = useState(false)
    const [cloneOverwritePresetId, setCloneOverwritePresetId] = useState<string | null>(null)
    const [cloneConflictNames, setCloneConflictNames] = useState<string[]>([])
    const [cloneOverwriteConfirmOpen, setCloneOverwriteConfirmOpen] = useState(false)
    const [publishDialogOpen, setPublishDialogOpen] = useState(false)
    const [publishDialogMode, setPublishDialogMode] = useState<'create' | 'overwrite'>('create')
    const [publishPresetName, setPublishPresetName] = useState('')
    const [publishDescription, setPublishDescription] = useState('')
    const [publishOverwritePresetId, setPublishOverwritePresetId] = useState('')
    const [publishBusy, setPublishBusy] = useState(false)
    const [publishError, setPublishError] = useState<string | null>(null)

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const latestDraftRef = useRef('')
    const latestMetadataRef = useRef<{ category: SkillCategory | null; prompt: string }>({ category: null, prompt: '' })
    const lastSavedContentRef = useRef<{
        id: string
        content: string
        category: SkillCategory
        prompt: string
    } | null>(null)
    const saveRequestIdRef = useRef(0)
    const hasRestoredViewStateRef = useRef(false)
    const hasInitializedPersistenceRef = useRef(false)

    const storageKey = useMemo(() => `editor_skill_view_state_${novelId ?? 'global'}`, [novelId])

    const categories = useMemo(
        () =>
            CATEGORY_ITEMS.map((item) => ({
                ...item,
                label: t(`categories.${item.translationKey}`),
            })),
        [t]
    )

    const loadSkills = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const { skills: list } = await skillApi.list()
            setSkills(list)
            setSelectedSkillId((prevSelected) => {
                if (prevSelected && list.some((skill) => skill.id === prevSelected)) return prevSelected
                return list[0]?.id ?? null
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : t('errors.loadFailed')
            setError(message)
        } finally {
            setLoading(false)
        }
    }, [t])

    useEffect(() => {
        void loadSkills()
    }, [loadSkills])

    useEffect(() => {
        let cancelled = false
        void (async () => {
            try {
                const { prompts: list } = await promptApi.list()
                if (!cancelled) {
                    setPrompts(list)
                    setPromptsLoaded(true)
                }
            } catch {
                if (!cancelled) setPrompts([])
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const loadBuiltinPresets = useCallback(async () => {
        setBuiltinPresetsLoading(true)
        setBuiltinPresetsError(null)
        try {
            const { authoringEnabled, presets } = await skillPresetApi.list()
            setPresetAuthoringEnabled(authoringEnabled)
            setBuiltinPresets(presets)
            setPublishOverwritePresetId((prev) => {
                if (prev && presets.some((preset) => preset.presetId === prev)) return prev
                return presets[0]?.presetId ?? ''
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load presets'
            setBuiltinPresetsError(message)
        } finally {
            setBuiltinPresetsLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadBuiltinPresets()
    }, [loadBuiltinPresets])

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (hasRestoredViewStateRef.current) return

        const raw = window.localStorage.getItem(storageKey)
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as {
                    selectedSkillId?: string | null
                    activeCategory?: SkillCategory
                    expandedCategories?: Partial<Record<SkillCategory, boolean>>
                }
                startTransition(() => {
                    if (typeof parsed.selectedSkillId === 'string' && parsed.selectedSkillId.trim()) {
                        setSelectedSkillId(parsed.selectedSkillId)
                    }
                    const restoredCategory = normalizeSkillCategory(parsed.activeCategory)
                    if (restoredCategory) setActiveCategory(restoredCategory)
                    if (parsed.expandedCategories && typeof parsed.expandedCategories === 'object') {
                        setExpandedCategories((prev) => ({ ...prev, ...parsed.expandedCategories }))
                    }
                })
            } catch {
                // Ignore invalid local state.
            }
        }

        hasRestoredViewStateRef.current = true
    }, [storageKey])

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (!hasRestoredViewStateRef.current) return
        if (!hasInitializedPersistenceRef.current) {
            hasInitializedPersistenceRef.current = true
            return
        }

        window.localStorage.setItem(
            storageKey,
            JSON.stringify({
                selectedSkillId,
                activeCategory,
                expandedCategories,
            })
        )
    }, [activeCategory, expandedCategories, selectedSkillId, storageKey])

    const selectedSkill = useMemo(
        () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
        [selectedSkillId, skills]
    )
    // A skill cloned from an official preset is read-only unless the user is in preset-authoring mode.
    // Editing requires cloning it first (which yields an unmarked, editable copy).
    const editorReadOnly = useMemo(
        () => Boolean(selectedSkill?.sourcePresetId) && !presetAuthoringEnabled,
        [presetAuthoringEnabled, selectedSkill?.sourcePresetId]
    )
    // For a preset-sourced skill: the cloned revision and whether the official preset is now newer.
    const skillPresetUpdate = useMemo(() => {
        const sourceId = selectedSkill?.sourcePresetId ?? null
        const clonedRevision = selectedSkill?.sourcePresetRevision ?? null
        if (!sourceId) return { sourceId: null as string | null, clonedRevision: null as number | null, updateAvailable: false }
        const current = builtinPresets.find((preset) => preset.presetId === sourceId) ?? null
        const updateAvailable = current != null && clonedRevision != null && current.revision > clonedRevision
        return { sourceId, clonedRevision, updateAvailable }
    }, [builtinPresets, selectedSkill?.sourcePresetId, selectedSkill?.sourcePresetRevision])
    const draftSkillName = useMemo(
        () => extractSkillNameFromMarkdown(draftContent) ?? selectedSkill?.name ?? '',
        [draftContent, selectedSkill?.name]
    )
    const draftSkillDescription = useMemo(
        () => extractSkillDescriptionFromMarkdown(draftContent) ?? selectedSkill?.description ?? '',
        [draftContent, selectedSkill?.description]
    )
    // The textarea edits only the body. Official SKILL.md frontmatter (name/description) is hidden;
    // ONW-only category/prompt metadata is edited separately and stored in onw.json.
    const draftSkillBody = useMemo(() => extractSkillBodyFromMarkdown(draftContent), [draftContent])
    // A skill can only bind a prompt from its own category — no cross-category selection.
    const draftSkillCategory = draftCategory
    const draftSkillPrompt = draftPrompt
    const promptOptions = useMemo(
        () =>
            [...prompts]
                .filter(
                    (prompt) =>
                        prompt.category !== 'component'
                        && prompt.allowAgentCall === true
                        && (!draftSkillCategory || prompt.category === draftSkillCategory)
                )
                .sort((a, b) => a.name.localeCompare(b.name)),
        [draftSkillCategory, prompts]
    )

    // Names of every prompt the user owns (case-insensitive) — used to detect skills whose bound prompt
    // no longer exists (deleted or renamed). Only meaningful once the prompt list has actually loaded.
    const promptNameSet = useMemo(() => new Set(prompts.map((prompt) => prompt.name.trim().toLowerCase())), [prompts])
    const isPromptNameMissing = useCallback(
        (promptName: string | null | undefined) => {
            const name = promptName?.trim()
            if (!name) return false
            return promptsLoaded && !promptNameSet.has(name.toLowerCase())
        },
        [promptNameSet, promptsLoaded]
    )
    const draftPromptMissing = useMemo(() => isPromptNameMissing(draftSkillPrompt), [draftSkillPrompt, isPromptNameMissing])

    // A skill that binds a now-missing prompt can't run, so default it to disabled (and surface why).
    useEffect(() => {
        if (!promptsLoaded) return
        const broken = skills.filter((skill) => skill.enabled && isPromptNameMissing(skill.prompt))
        if (broken.length === 0) return
        void (async () => {
            for (const skill of broken) {
                try {
                    const { skill: updated } = await skillApi.setEnabled(skill.id, false)
                    setSkills((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
                } catch (err) {
                    console.error(err)
                }
            }
        })()
    }, [isPromptNameMissing, promptsLoaded, skills])

    useEffect(() => {
        if (!selectedSkill) {
            setDraftContent('')
            setDraftCategory(null)
            setDraftPrompt('')
            setDraftSkillId(null)
            latestDraftRef.current = ''
            latestMetadataRef.current = { category: null, prompt: '' }
            setSaveState('idle')
            lastSavedContentRef.current = null
            setIsEditingName(false)
            return
        }

        const normalizedContent = normalizeSkillDraftContent(selectedSkill.content)
        const category = normalizeSkillCategory(selectedSkill.category)
        const prompt = selectedSkill.prompt?.trim() ?? ''
        setDraftContent(normalizedContent)
        setDraftCategory(category)
        setDraftPrompt(prompt)
        setDraftSkillId(selectedSkill.id)
        latestDraftRef.current = normalizedContent
        latestMetadataRef.current = { category, prompt }
        lastSavedContentRef.current = {
            id: selectedSkill.id,
            content: normalizedContent,
            category: category ?? 'ai_chat',
            prompt,
        }
        setSaveState('idle')

        if (category) setActiveCategory(category)
    }, [selectedSkill])

    useEffect(() => {
        latestDraftRef.current = draftContent
    }, [draftContent])

    useEffect(() => {
        latestMetadataRef.current = { category: draftCategory, prompt: draftPrompt }
    }, [draftCategory, draftPrompt])

    const getSkillNameError = useCallback((content: string) => {
        const name = extractSkillNameFromMarkdown(content)?.trim() ?? ''
        if (!name) return t('errors.nameCannotBeEmpty')

        const nameKey = name.toLowerCase()
        const duplicate = skills.some(
            (skill) => skill.id !== selectedSkillId && skill.name.trim().toLowerCase() === nameKey
        )
        return duplicate ? t('errors.nameAlreadyExists') : null
    }, [selectedSkillId, skills, t])

    useEffect(() => {
        if (!selectedSkill) return
        // Skills cloned from an official preset are read-only outside authoring mode: never autosave.
        // The server (PUT /skills/[id]) enforces the same rule; this just avoids no-op churn.
        if (editorReadOnly) return
        // Skip the transitional render right after a selection switch, where `draftContent` still
        // holds the previously selected skill's markdown. Validating/saving here would compare the
        // wrong draft against the new selection.
        if (draftSkillId !== selectedSkill.id) return
        const lastSaved = lastSavedContentRef.current
        if (!lastSaved || lastSaved.id !== selectedSkill.id) return
        if (
            draftContent === lastSaved.content
            && draftCategory === lastSaved.category
            && draftPrompt === lastSaved.prompt
        ) return
        if (!draftCategory) return
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        if (isEditingName) {
            const draftName = extractSkillNameFromMarkdown(draftContent)?.trim() ?? ''
            const savedName = extractSkillNameFromMarkdown(lastSaved.content)?.trim() ?? ''
            if (draftName !== savedName) return
        }

        const nameError = getSkillNameError(draftContent)
        if (nameError) {
            setError(nameError)
            setSaveState('error')
            const savedName = extractSkillNameFromMarkdown(lastSaved.content) ?? ''
            const currentDraftName = extractSkillNameFromMarkdown(draftContent) ?? ''
            if (savedName !== currentDraftName) {
                setDraftContent((prev) => replaceSkillNameInMarkdown(prev, savedName))
            }
            return
        }

        saveTimerRef.current = setTimeout(async () => {
            const requestId = ++saveRequestIdRef.current
            const previousSkillId = selectedSkill.id
            setSaveState('saving')
            try {
                const { skill } = await skillApi.update(previousSkillId, {
                    content: draftContent,
                    category: draftCategory,
                    prompt: draftPrompt.trim() || null,
                })

                if (requestId !== saveRequestIdRef.current) return
                if (latestDraftRef.current !== draftContent) return
                if (
                    latestMetadataRef.current.category !== draftCategory
                    || latestMetadataRef.current.prompt !== draftPrompt
                ) return

                setSkills((prev) => prev.map((item) => (item.id === previousSkillId ? skill : item)))
                setSelectedSkillId((prev) => (prev === previousSkillId ? skill.id : prev))
                const savedCategory = normalizeSkillCategory(skill.category) ?? draftCategory
                const savedPrompt = skill.prompt?.trim() ?? ''
                lastSavedContentRef.current = {
                    id: skill.id,
                    content: skill.content,
                    category: savedCategory,
                    prompt: savedPrompt,
                }
                setDraftContent(skill.content)
                setDraftCategory(savedCategory)
                setDraftPrompt(savedPrompt)
                latestDraftRef.current = skill.content
                latestMetadataRef.current = { category: savedCategory, prompt: savedPrompt }
                setError(null)

                const category = normalizeSkillCategory(skill.category)
                if (category) {
                    setActiveCategory(category)
                    setExpandedCategories((prev) => ({ ...prev, [category]: true }))
                }

                setSaveState('saved')
                window.setTimeout(() => {
                    if (saveRequestIdRef.current === requestId) setSaveState('idle')
                }, 900)
            } catch (err) {
                console.error(err)
                if (requestId !== saveRequestIdRef.current) return
                setSaveState('error')
                const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : null
                if (status === 409) {
                    setError(t('errors.nameAlreadyExists'))
                } else if (status === 400) {
                    setError(t('errors.nameCannotBeEmpty'))
                } else {
                    setError(err instanceof Error ? err.message : t('errors.saveFailed'))
                }
            }
        }, 650)

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        }
    }, [draftCategory, draftContent, draftPrompt, draftSkillId, editorReadOnly, getSkillNameError, isEditingName, selectedSkill, t])

    const filteredSkills = useMemo(() => {
        const normalized = searchQuery.trim().toLowerCase()
        if (!normalized) return skills

        return skills.filter((skill) => {
            const name = skill.name.toLowerCase()
            const description = skill.description?.toLowerCase() ?? ''
            const content = skill.content.toLowerCase()
            return name.includes(normalized) || description.includes(normalized) || content.includes(normalized)
        })
    }, [searchQuery, skills])

    const skillsByCategory = useMemo(() => {
        const grouped: Record<SkillCategory, Skill[]> = {
            scene_continuation: [],
            scene_action: [],
            ai_chat: [],
        }

        for (const skill of filteredSkills) {
            const category = normalizeSkillCategory(skill.category)
            if (!category) continue
            grouped[category].push(skill)
        }

        for (const key of Object.keys(grouped) as SkillCategory[]) {
            grouped[key].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name))
        }

        return grouped
    }, [filteredSkills])

    const handleToggleCategory = useCallback((category: SkillCategory) => {
        setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }))
    }, [])

    const handleCreate = useCallback(async (category?: SkillCategory) => {
        const nextCategory = category ?? activeCategory
        try {
            setError(null)
            const { skill } = await skillApi.create({
                name: t('actions.newSkillName'),
                category: nextCategory,
            })
            setSkills((prev) => [skill, ...prev])
            setSelectedSkillId(skill.id)
            setActiveCategory(nextCategory)
            setExpandedCategories((prev) => ({ ...prev, [nextCategory]: true }))
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.createFailed')}: ${detail}` : t('errors.createFailed'))
        }
    }, [activeCategory, t])

    const handleSetEnabled = useCallback(async (skill: Skill, enabled: boolean) => {
        if (skill.enabled === enabled) return

        // Refuse to enable a skill whose bound prompt no longer exists — it can't run.
        if (enabled && isPromptNameMissing(skill.prompt)) {
            setError(t('errors.missingPromptCannotEnable'))
            return
        }

        try {
            setError(null)
            // Enabled state lives outside SKILL.md: toggling adds/removes the CODEX_HOME symlink.
            const { skill: updated } = await skillApi.setEnabled(skill.id, enabled)
            setSkills((prev) => prev.map((item) => (item.id === skill.id ? updated : item)))
            if (selectedSkillId === skill.id) {
                const normalizedContent = normalizeSkillDraftContent(updated.content)
                const updatedCategory = normalizeSkillCategory(updated.category) ?? 'ai_chat'
                const updatedPrompt = updated.prompt?.trim() ?? ''
                setDraftContent(normalizedContent)
                setDraftCategory(updatedCategory)
                setDraftPrompt(updatedPrompt)
                latestDraftRef.current = normalizedContent
                latestMetadataRef.current = { category: updatedCategory, prompt: updatedPrompt }
                lastSavedContentRef.current = {
                    id: updated.id,
                    content: normalizedContent,
                    category: updatedCategory,
                    prompt: updatedPrompt,
                }
            }
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : t('errors.saveFailed'))
        }
    }, [isPromptNameMissing, selectedSkillId, t])

    const handleDelete = useCallback(async () => {
        if (!selectedSkill) return
        try {
            setError(null)
            await skillApi.delete(selectedSkill.id)
            setSkills((prev) => prev.filter((skill) => skill.id !== selectedSkill.id))
            setSelectedSkillId((prevSelected) => {
                if (prevSelected !== selectedSkill.id) return prevSelected
                const remaining = skills.filter((skill) => skill.id !== selectedSkill.id)
                return remaining[0]?.id ?? null
            })
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.deleteFailed')}: ${detail}` : t('errors.deleteFailed'))
        }
    }, [selectedSkill, skills, t])

    const handleCloneSkill = useCallback(async () => {
        if (!selectedSkill) return
        try {
            setError(null)
            // Produces an editable copy with the preset-origin marker stripped (the "clone to edit" path).
            const { skill } = await skillApi.clone(selectedSkill.id)
            setSkills((prev) => [skill, ...prev])
            const category = normalizeSkillCategory(skill.category)
            if (category) {
                setActiveCategory(category)
                setExpandedCategories((prev) => ({ ...prev, [category]: true }))
            }
            setSelectedSkillId(skill.id)
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setError(detail ? `${t('errors.cloneFailed')}: ${detail}` : t('errors.cloneFailed'))
        }
    }, [selectedSkill, t])

    const handleClonePreset = useCallback(async (presetId: string, overwriteExisting = false) => {
        setCloningPresetId(presetId)
        setBuiltinPresetsError(null)
        try {
            const { skills: importedSkills } = await skillPresetApi.clone(presetId, { overwriteExisting })
            const importedIds = new Set(importedSkills.map((skill) => skill.id))
            setSkills((prev) => [...importedSkills, ...prev.filter((skill) => !importedIds.has(skill.id))])

            const preset = builtinPresets.find((item) => item.presetId === presetId) ?? null
            const entryKey = (preset?.entrySkillName ?? importedSkills[0]?.name ?? '').trim().toLowerCase()
            const entrySkill = importedSkills.find((skill) => skill.name.trim().toLowerCase() === entryKey) ?? importedSkills[0] ?? null
            if (entrySkill) {
                const category = normalizeSkillCategory(entrySkill.category)
                if (category) {
                    setExpandedCategories((prev) => ({ ...prev, [category]: true }))
                    setActiveCategory(category)
                }
                setSelectedSkillId(entrySkill.id)
            }

            setCloneOverwriteConfirmOpen(false)
            setCloneOverwritePresetId(null)
            setCloneConflictNames([])
        } catch (err) {
            if (err instanceof ApiError) {
                const data = err.data as { code?: unknown; names?: unknown } | undefined
                const names = Array.isArray(data?.names)
                    ? data.names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
                    : []

                if (err.status === 409 && data?.code === 'SKILL_NAME_ALREADY_EXISTS' && names.length > 0 && !overwriteExisting) {
                    setCloneOverwritePresetId(presetId)
                    setCloneConflictNames(names)
                    setCloneOverwriteConfirmOpen(true)
                    return
                }
            }

            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setBuiltinPresetsError(detail || t('presets.errors.cloneFailed'))
        } finally {
            setCloningPresetId((prev) => (prev === presetId ? null : prev))
        }
    }, [builtinPresets, t])

    const handleConfirmCloneOverwrite = useCallback(async () => {
        if (!cloneOverwritePresetId) return
        await handleClonePreset(cloneOverwritePresetId, true)
    }, [cloneOverwritePresetId, handleClonePreset])

    const handleCloneAllPresets = useCallback(async () => {
        setCloningAllPresets(true)
        setBuiltinPresetsError(null)
        try {
            const allImported: Skill[] = []
            for (const preset of builtinPresets) {
                // Overwrite existing clones so "clone all" updates everything to the latest official version.
                const { skills: importedSkills } = await skillPresetApi.clone(preset.presetId, { overwriteExisting: true })
                allImported.push(...importedSkills)
            }
            if (allImported.length > 0) {
                const importedIds = new Set(allImported.map((skill) => skill.id))
                setSkills((prev) => [...allImported, ...prev.filter((skill) => !importedIds.has(skill.id))])
            }
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setBuiltinPresetsError(detail || t('presets.errors.cloneFailed'))
        } finally {
            setCloningAllPresets(false)
        }
    }, [builtinPresets, t])

    const handleOpenPublishDialog = useCallback((mode: 'create' | 'overwrite') => {
        if (!selectedSkill) return

        const skillName = (selectedSkill.name ?? '').trim() || t('actions.newSkillName')
        const key = skillName.trim().toLowerCase()
        const matchingPreset = builtinPresets.find(
            (preset) => preset.entrySkillName.trim().toLowerCase() === key || preset.name.trim().toLowerCase() === key
        ) ?? builtinPresets[0] ?? null

        setPublishDialogMode(mode)
        setPublishPresetName(mode === 'overwrite' ? matchingPreset?.name ?? skillName : skillName)
        setPublishDescription(mode === 'overwrite' ? matchingPreset?.description ?? selectedSkill.description ?? '' : selectedSkill.description ?? '')
        setPublishOverwritePresetId(matchingPreset?.presetId ?? builtinPresets[0]?.presetId ?? '')
        setPublishError(null)
        setPublishDialogOpen(true)
    }, [builtinPresets, selectedSkill, t])

    const handlePublishDialogOpenChange = useCallback((open: boolean) => {
        setPublishDialogOpen(open)
        if (!open) setPublishError(null)
    }, [])

    const handleSubmitPublishDialog = useCallback(async () => {
        if (!selectedSkill) return

        setPublishBusy(true)
        setPublishError(null)
        try {
            const description = publishDescription.trim() ? publishDescription.trim() : null
            if (publishDialogMode === 'create') {
                await skillPresetApi.publish({
                    skillId: selectedSkill.id,
                    name: publishPresetName,
                    description,
                })
            } else {
                if (!publishOverwritePresetId) {
                    throw new Error(t('presets.errors.selectPreset'))
                }
                await skillPresetApi.update(publishOverwritePresetId, {
                    skillId: selectedSkill.id,
                    name: publishPresetName,
                    description,
                })
            }

            await loadBuiltinPresets()
            setPublishDialogOpen(false)
        } catch (err) {
            console.error(err)
            const detail = err instanceof Error ? err.message : ''
            setPublishError(detail || t('presets.errors.publishFailed'))
        } finally {
            setPublishBusy(false)
        }
    }, [loadBuiltinPresets, publishDescription, publishDialogMode, publishOverwritePresetId, publishPresetName, selectedSkill, t])

    const saveLabel = useMemo(() => {
        if (saveState === 'saving') return t('status.saving')
        if (saveState === 'saved') return t('status.saved')
        if (saveState === 'error') return t('status.saveFailed')
        return ''
    }, [saveState, t])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('library.loading')}
            </div>
        )
    }

    return (
        <>
        <div className="flex h-full min-h-0">
            <section className="w-[340px] shrink-0 border-r bg-card flex flex-col">
                <div className="border-b p-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder={t('library.searchPlaceholder')}
                                className="pl-8"
                            />
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1">
                                    <Plus className="h-4 w-4" />
                                    {t('actions.new')}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                {categories.map((category) => (
                                    <DropdownMenuItem key={category.id} onClick={() => void handleCreate(category.id)}>
                                        <category.icon />
                                        {category.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                <SkillPresetLibrarySection
                    presets={builtinPresets}
                    loading={builtinPresetsLoading}
                    error={builtinPresetsError}
                    cloningPresetId={cloningPresetId}
                    cloningAll={cloningAllPresets}
                    cloneConflictNames={cloneConflictNames}
                    cloneOverwriteConfirmOpen={cloneOverwriteConfirmOpen}
                    onClonePreset={(presetId, overwriteExisting) => void handleClonePreset(presetId, overwriteExisting)}
                    onCloneAllPresets={() => void handleCloneAllPresets()}
                    onCloneOverwriteConfirmOpenChange={(open) => {
                        setCloneOverwriteConfirmOpen(open)
                        if (!open) {
                            setCloneOverwritePresetId(null)
                            setCloneConflictNames([])
                        }
                    }}
                    onConfirmCloneOverwrite={() => void handleConfirmCloneOverwrite()}
                />

                {error && <div className="border-b px-3 py-2 text-sm text-destructive">{error}</div>}

                <ScrollArea className="flex-1">
                    <div className="py-2">
                        {categories.map((category) => {
                            const expanded = expandedCategories[category.id]
                            const items = skillsByCategory[category.id]

                            return (
                                <div key={category.id} className="mb-1">
                                    <div
                                        className={cn(
                                            'w-full flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors',
                                            activeCategory === category.id ? 'bg-muted text-foreground' : 'hover:bg-muted'
                                        )}
                                    >
                                        <button
                                            type="button"
                                            className="flex-1 px-3 py-2 flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                            onClick={() => {
                                                setActiveCategory(category.id)
                                                handleToggleCategory(category.id)
                                            }}
                                        >
                                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            <category.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{category.label}</span>
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                {t('library.entries', { count: items.length })}
                                            </span>
                                        </button>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            className="mr-2"
                                            onClick={() => void handleCreate(category.id)}
                                            title={t('actions.newInCategory')}
                                        >
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    {expanded && (
                                        <div className="px-2 pb-2">
                                            {items.length === 0 ? (
                                                <div className="px-2 py-2 text-xs text-muted-foreground">{t('library.empty')}</div>
                                            ) : (
                                                items.map((skill) => {
                                                    const isActive = skill.id === selectedSkillId
                                                    return (
                                                        <div
                                                            key={skill.id}
                                                            role="button"
                                                            tabIndex={0}
                                                            className={cn(
                                                                'group mb-1 w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 focus-visible:ring-offset-1',
                                                                isActive
                                                                    ? 'border-primary/40 bg-muted'
                                                                    : skill.enabled
                                                                        ? 'border-emerald-200/80 bg-emerald-50/40 hover:border-emerald-300 hover:bg-emerald-50/60'
                                                                        : 'border-border hover:border-sky-200/60 hover:bg-muted'
                                                            )}
                                                            onClick={() => setSelectedSkillId(skill.id)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault()
                                                                    setSelectedSkillId(skill.id)
                                                                }
                                                            }}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <category.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                                <span
                                                                    className={cn(
                                                                        'truncate text-sm font-medium',
                                                                        !skill.enabled && 'text-muted-foreground',
                                                                        skill.sourcePresetId && 'italic text-muted-foreground'
                                                                    )}
                                                                >
                                                                    {skill.name}
                                                                </span>
                                                                <div className="ml-auto flex items-center gap-1">
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            'inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
                                                                            skill.enabled
                                                                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                                                                : 'border-border bg-background text-muted-foreground hover:bg-muted'
                                                                        )}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation()
                                                                            void handleSetEnabled(skill, true)
                                                                        }}
                                                                        title={t('actions.enableSkill')}
                                                                        aria-label={t('actions.enableSkill')}
                                                                    >
                                                                        <Check className="h-4 w-4" />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            'inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
                                                                            !skill.enabled
                                                                                ? 'border-destructive bg-destructive text-destructive-foreground'
                                                                                : 'border-border bg-background text-muted-foreground hover:bg-muted'
                                                                        )}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation()
                                                                            void handleSetEnabled(skill, false)
                                                                        }}
                                                                        title={t('actions.disableSkill')}
                                                                        aria-label={t('actions.disableSkill')}
                                                                    >
                                                                        <X className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            {skill.description ? (
                                                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                                                    {skill.description}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </ScrollArea>
            </section>

            <section className="flex-1 min-w-0 flex flex-col">
                {!selectedSkill ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        {t('editor.emptyState')}
                    </div>
                ) : (
                    <>
                        <div className="px-5 pt-3 pb-2">
                            <div className="mb-2 flex items-center gap-3">
                                <div className="shrink-0 text-sm font-medium">{t('editor.name')}</div>
                                <Input
                                    value={draftSkillName}
                                    disabled={editorReadOnly}
                                    onFocus={() => {
                                        setError(null)
                                        setIsEditingName(true)
                                    }}
                                    onBlur={() => setIsEditingName(false)}
                                    onChange={(event) => {
                                        setError(null)
                                        setDraftContent((prev) =>
                                            replaceSkillNameInMarkdown(prev, event.target.value)
                                        )
                                    }}
                                    placeholder={t('editor.namePlaceholder')}
                                />
                                <div className="flex shrink-0 items-center gap-2">
                                    {saveLabel && (
                                        <span className={cn('text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                                            {saveLabel}
                                        </span>
                                    )}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="icon-sm" title={t('actions.more')}>
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => setDirectoryBrowserOpen(true)}>
                                                <FolderOpen className="h-4 w-4" />
                                                {t('actions.browseDirectory')}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            {presetAuthoringEnabled && (
                                                <>
                                                    <DropdownMenuItem onClick={() => handleOpenPublishDialog('create')}>
                                                        {t('presets.publish.createMenu')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleOpenPublishDialog('overwrite')}>
                                                        {t('presets.publish.overwriteMenu')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                </>
                                            )}
                                            <DropdownMenuItem onClick={() => void handleCloneSkill()}>
                                                {t('actions.cloneSkill')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-destructive" onClick={() => void handleDelete()}>
                                                {t('actions.deleteSkill')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="shrink-0 text-sm font-medium">{t('editor.description')}</div>
                                <Input
                                    value={draftSkillDescription}
                                    disabled={editorReadOnly}
                                    onChange={(event) => {
                                        setError(null)
                                        setDraftContent((prev) =>
                                            replaceSkillDescriptionInMarkdown(prev, event.target.value)
                                        )
                                    }}
                                    placeholder={t('editor.descriptionPlaceholder')}
                                />
                            </div>

                            <div className="mt-2 flex items-center gap-3">
                                <div className="shrink-0 text-sm font-medium">{t('editor.category')}</div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" className="min-w-[180px] justify-between gap-2" disabled={editorReadOnly}>
                                            <span className="truncate">
                                                {categories.find((item) => item.id === draftSkillCategory)?.label ?? '—'}
                                            </span>
                                            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-56">
                                        {categories.map((item) => (
                                            <DropdownMenuItem
                                                key={item.id}
                                                onClick={() => {
                                                    setError(null)
                                                    setDraftCategory(item.id)
                                                }}
                                            >
                                                <item.icon className="h-4 w-4" />
                                                <span className="truncate">{item.label}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>

                            <div className="mt-2 flex items-center gap-3">
                                <div className="shrink-0 text-sm font-medium">{t('editor.associatedPrompt')}</div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" className="min-w-[180px] justify-between gap-2" disabled={editorReadOnly}>
                                            <span className="truncate">
                                                {draftSkillPrompt || t('editor.associatedPromptNone')}
                                            </span>
                                            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                                        <DropdownMenuItem
                                            onClick={() => {
                                                setError(null)
                                                setDraftPrompt('')
                                            }}
                                        >
                                            {t('editor.associatedPromptNone')}
                                        </DropdownMenuItem>
                                        {promptOptions.map((prompt) => (
                                            <DropdownMenuItem
                                                key={prompt.id}
                                                onClick={() => {
                                                    setError(null)
                                                    setDraftPrompt(prompt.name)
                                                }}
                                            >
                                                <span className="truncate">{prompt.name}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{t('editor.associatedPromptHint')}</p>

                            {draftPromptMissing && (
                                <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                    {t('editor.missingPromptNotice', { prompt: draftSkillPrompt })}
                                </div>
                            )}
                        </div>

                        <Separator />

                        {editorReadOnly && (
                            <div className="mx-5 mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-300">
                                <div>
                                    {skillPresetUpdate.clonedRevision != null
                                        ? t('editor.presetReadOnlyNoticeVersioned', { revision: skillPresetUpdate.clonedRevision.toFixed(1) })
                                        : t('editor.presetReadOnlyNotice')}
                                </div>
                                {skillPresetUpdate.updateAvailable && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="font-medium">{t('editor.presetUpdateAvailable')}</span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 gap-1 border-amber-400/60 bg-background/60"
                                            onClick={() => {
                                                if (skillPresetUpdate.sourceId) void handleClonePreset(skillPresetUpdate.sourceId, true)
                                            }}
                                        >
                                            <Sparkles className="h-3.5 w-3.5" />
                                            {t('editor.presetUpdateClone')}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="px-5 py-3">
                            <div className="text-base font-semibold">{t('editor.sectionTitle')}</div>
                        </div>

                        <div className="flex-1 min-h-0 px-5 pb-5">
                            <Textarea
                                value={draftSkillBody}
                                readOnly={editorReadOnly}
                                onChange={(event) => {
                                    setError(null)
                                    setDraftContent((prev) => replaceSkillBodyInMarkdown(prev, event.target.value))
                                }}
                                className={cn(
                                    'h-full min-h-[420px] resize-none font-mono text-sm leading-6',
                                    editorReadOnly && 'bg-muted/40 text-muted-foreground'
                                )}
                                placeholder={t('editor.placeholder')}
                            />
                        </div>
                    </>
                )}
            </section>
        </div>

        <SkillDirectoryBrowserDialog
            open={directoryBrowserOpen}
            onOpenChange={setDirectoryBrowserOpen}
            skill={selectedSkill}
        />

        <SkillPresetPublishDialog
            open={publishDialogOpen}
            mode={publishDialogMode}
            presets={builtinPresets}
            presetName={publishPresetName}
            description={publishDescription}
            overwritePresetId={publishOverwritePresetId}
            busy={publishBusy}
            error={publishError}
            onOpenChange={handlePublishDialogOpenChange}
            onPresetNameChange={setPublishPresetName}
            onDescriptionChange={setPublishDescription}
            onOverwritePresetIdChange={(presetId) => {
                const preset = builtinPresets.find((item) => item.presetId === presetId) ?? null
                setPublishOverwritePresetId(presetId)
                if (preset) {
                    setPublishPresetName(preset.name)
                    setPublishDescription(preset.description ?? '')
                }
            }}
            onSubmit={() => void handleSubmitPublishDialog()}
        />
        </>
    )
}
