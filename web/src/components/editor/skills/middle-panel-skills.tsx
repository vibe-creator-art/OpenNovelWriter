'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Check,
    ChevronDown,
    ChevronRight,
    List,
    MessageCircle,
    MoreVertical,
    PenLine,
    Plus,
    Search,
    Wand2,
    X,
    type LucideIcon,
} from 'lucide-react'

import { promptApi, skillApi, type Prompt, type Skill } from '@/lib/api'
import { normalizeSkillCategory, type SkillCategory } from '@/lib/skills'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

const CATEGORY_ITEMS: Array<{ id: SkillCategory; icon: LucideIcon; translationKey: string }> = [
    { id: 'scene_continuation', icon: PenLine, translationKey: 'sceneContinuation' },
    { id: 'scene_action', icon: List, translationKey: 'sceneAction' },
    { id: 'text_replacement', icon: Wand2, translationKey: 'textReplacement' },
    { id: 'ai_chat', icon: MessageCircle, translationKey: 'aiChat' },
]

const DEFAULT_EXPANDED_CATEGORIES: Record<SkillCategory, boolean> = {
    scene_continuation: true,
    scene_action: true,
    text_replacement: true,
    ai_chat: true,
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type MiddlePanelSkillsProps = {
    novelId?: string
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function replaceSkillNameInMarkdown(content: string, nextName: string, previousName: string | null) {
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

    let nextBody = body
    const trimmedPrevious = previousName?.trim() ?? ''
    if (trimmedPrevious) {
        const headingPattern = new RegExp(`^#\\s+${escapeRegExp(trimmedPrevious)}\\s*$`, 'm')
        if (headingPattern.test(nextBody)) {
            nextBody = nextBody.replace(headingPattern, `# ${nextName}`)
        }
    }

    return `---\n${nextFrontmatter}\n---\n${nextBody}`
}

function extractSkillPromptFromMarkdown(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return null
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return null

    const frontmatter = normalized.slice(4, closingIndex)
    const match = frontmatter.match(/^prompt\s*:\s*(.+)$/m)
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

function extractSkillCategoryFromMarkdown(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return null
    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return null

    const frontmatter = normalized.slice(4, closingIndex)
    const match = frontmatter.match(/^category\s*:\s*(.+)$/m)
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

function replaceSkillPromptInMarkdown(content: string, promptName: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return normalized

    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return normalized

    const frontmatter = normalized.slice(4, closingIndex)
    const body = normalized.slice(closingIndex + 5)
    const nextFrontmatterLine = `prompt: ${escapeDoubleQuotedYaml(promptName)}`
    const nextFrontmatter = /^prompt\s*:\s*.+$/m.test(frontmatter)
        ? frontmatter.replace(/^prompt\s*:\s*.+$/m, nextFrontmatterLine)
        : `${frontmatter}\n${nextFrontmatterLine}`

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
    // Tracks which skill `draftContent` currently belongs to. Unlike a ref, this state value is
    // captured per-render, so it stays "stale" during the transitional render right after the
    // selection switches — letting the autosave effect skip that render instead of validating the
    // previous skill's draft against the newly selected skill (which produced a false "name exists").
    const [draftSkillId, setDraftSkillId] = useState<string | null>(null)
    const [saveState, setSaveState] = useState<SaveState>('idle')
    const [isEditingName, setIsEditingName] = useState(false)
    const [prompts, setPrompts] = useState<Prompt[]>([])

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const latestDraftRef = useRef('')
    const lastSavedContentRef = useRef<{ id: string; content: string } | null>(null)
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
                if (!cancelled) setPrompts(list)
            } catch {
                if (!cancelled) setPrompts([])
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

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
    const draftSkillName = useMemo(
        () => extractSkillNameFromMarkdown(draftContent) ?? selectedSkill?.name ?? '',
        [draftContent, selectedSkill?.name]
    )
    const draftSkillDescription = useMemo(
        () => extractSkillDescriptionFromMarkdown(draftContent) ?? selectedSkill?.description ?? '',
        [draftContent, selectedSkill?.description]
    )
    const draftSkillPrompt = useMemo(
        () => extractSkillPromptFromMarkdown(draftContent) ?? selectedSkill?.prompt ?? '',
        [draftContent, selectedSkill?.prompt]
    )
    // A skill can only bind a prompt from its own category — no cross-category selection.
    const draftSkillCategory = useMemo(
        () =>
            normalizeSkillCategory(extractSkillCategoryFromMarkdown(draftContent))
            ?? normalizeSkillCategory(selectedSkill?.category)
            ?? null,
        [draftContent, selectedSkill?.category]
    )
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

    useEffect(() => {
        if (!selectedSkill) {
            setDraftContent('')
            setDraftSkillId(null)
            setSaveState('idle')
            lastSavedContentRef.current = null
            setIsEditingName(false)
            return
        }

        setDraftContent(selectedSkill.content)
        setDraftSkillId(selectedSkill.id)
        latestDraftRef.current = selectedSkill.content
        lastSavedContentRef.current = {
            id: selectedSkill.id,
            content: selectedSkill.content,
        }
        setSaveState('idle')

        const category = normalizeSkillCategory(selectedSkill.category)
        if (category) setActiveCategory(category)
    }, [selectedSkill])

    useEffect(() => {
        latestDraftRef.current = draftContent
    }, [draftContent])

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
        // Skip the transitional render right after a selection switch, where `draftContent` still
        // holds the previously selected skill's markdown. Validating/saving here would compare the
        // wrong draft against the new selection.
        if (draftSkillId !== selectedSkill.id) return
        const lastSaved = lastSavedContentRef.current
        if (!lastSaved || lastSaved.id !== selectedSkill.id) return
        if (draftContent === lastSaved.content) return
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
                setDraftContent((prev) => replaceSkillNameInMarkdown(prev, savedName, currentDraftName))
            }
            return
        }

        saveTimerRef.current = setTimeout(async () => {
            const requestId = ++saveRequestIdRef.current
            const previousSkillId = selectedSkill.id
            setSaveState('saving')
            try {
                const { skill } = await skillApi.update(previousSkillId, { content: draftContent })

                if (requestId !== saveRequestIdRef.current) return
                if (latestDraftRef.current !== draftContent) return

                setSkills((prev) => prev.map((item) => (item.id === previousSkillId ? skill : item)))
                setSelectedSkillId((prev) => (prev === previousSkillId ? skill.id : prev))
                lastSavedContentRef.current = { id: skill.id, content: skill.content }
                setDraftContent(skill.content)
                latestDraftRef.current = skill.content
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
    }, [draftContent, draftSkillId, getSkillNameError, isEditingName, selectedSkill, t])

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
            text_replacement: [],
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

        try {
            setError(null)
            // Enabled state lives outside SKILL.md: toggling adds/removes the CODEX_HOME symlink.
            const { skill: updated } = await skillApi.setEnabled(skill.id, enabled)
            setSkills((prev) => prev.map((item) => (item.id === skill.id ? updated : item)))
            if (selectedSkillId === skill.id) {
                setDraftContent(updated.content)
                latestDraftRef.current = updated.content
                lastSavedContentRef.current = { id: updated.id, content: updated.content }
            }
        } catch (err) {
            console.error(err)
            setError(err instanceof Error ? err.message : t('errors.saveFailed'))
        }
    }, [selectedSkillId, t])

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
                                                                        !skill.enabled && 'text-muted-foreground'
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
                                    onFocus={() => {
                                        setError(null)
                                        setIsEditingName(true)
                                    }}
                                    onBlur={() => setIsEditingName(false)}
                                    onChange={(event) => {
                                        setError(null)
                                        setDraftContent((prev) =>
                                            replaceSkillNameInMarkdown(prev, event.target.value, draftSkillName)
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
                                <div className="shrink-0 text-sm font-medium">{t('editor.associatedPrompt')}</div>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" className="min-w-[180px] justify-between gap-2">
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
                                                setDraftContent((prev) => replaceSkillPromptInMarkdown(prev, ''))
                                            }}
                                        >
                                            {t('editor.associatedPromptNone')}
                                        </DropdownMenuItem>
                                        {promptOptions.map((prompt) => (
                                            <DropdownMenuItem
                                                key={prompt.id}
                                                onClick={() => {
                                                    setError(null)
                                                    setDraftContent((prev) => replaceSkillPromptInMarkdown(prev, prompt.name))
                                                }}
                                            >
                                                <span className="truncate">{prompt.name}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{t('editor.associatedPromptHint')}</p>
                        </div>

                        <Separator />

                        <div className="px-5 py-3">
                            <div className="text-base font-semibold">{t('editor.sectionTitle')}</div>
                        </div>

                        <div className="flex-1 min-h-0 px-5 pb-5">
                            <Textarea
                                value={draftContent}
                                onChange={(event) => {
                                    setError(null)
                                    setDraftContent(event.target.value)
                                }}
                                className="h-full min-h-[420px] resize-none font-mono text-sm leading-6"
                                placeholder={t('editor.placeholder')}
                            />
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}
