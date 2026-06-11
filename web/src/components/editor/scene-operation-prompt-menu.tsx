'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Heart, List, Sparkles } from 'lucide-react'
import type { ModelGroup } from '@/lib/ai-store'
import { skillApi, type DefaultPromptSelectionCategory, type Prompt, type PromptDefaultSelection, type Skill } from '@/lib/api'
import { getAvailableModelAssignments } from '@/lib/ai-runner'
import { PROMPTS_CHANGED_EVENT } from '@/lib/prompt-events'
import { MODEL_GROUPS_CHANGED_EVENT } from '@/lib/model-group-events'
import { invalidateSceneOperationMenuDataCache, loadSceneOperationMenuData } from '@/lib/scene-operation-menu-data'
import { cn } from '@/lib/utils'
import {
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'

type DefaultsState = Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>>

export type SceneOperationPromptMenuRunSpec = {
    prompt: Prompt
    groups: ModelGroup[]
}

function getPromptGroups(prompt: Prompt | null | undefined, groups: ModelGroup[] | null | undefined) {
    if (!prompt || !Array.isArray(groups)) return []
    const byId = new Map(groups.map((group) => [group.id, group]))
    return (prompt.modelGroupIds ?? [])
        .map((groupId) => byId.get(groupId) ?? null)
        .filter((group): group is ModelGroup => group !== null)
}

function hasRunnableGroup(groups: ModelGroup[]) {
    return groups.some((group) => getAvailableModelAssignments(group).length > 0)
}

function getPromptRunDisabledReason(prompt: Prompt | null | undefined, groups: ModelGroup[] | null | undefined) {
    if (!prompt) return 'missingPrompt' as const
    if ((prompt.modelGroupIds ?? []).length === 0) return 'noModelBinding' as const

    const promptGroups = getPromptGroups(prompt, groups)
    if (promptGroups.length === 0) return 'missingModelGroup' as const
    if (!hasRunnableGroup(promptGroups)) return 'noValidModel' as const

    return null
}

export function SceneOperationPromptMenu({
    disabled,
    onRun,
    onRunSkill,
}: {
    disabled?: boolean
    onRun: (spec: SceneOperationPromptMenuRunSpec) => void
    onRunSkill?: (skill: Skill) => void
}) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const tPrompts = useTranslations('prompts')
    const tSceneOperation = useTranslations('editor.sceneOperation')

    const [prompts, setPrompts] = useState<Prompt[] | null>(null)
    const [defaults, setDefaults] = useState<DefaultsState | null>(null)
    const [groups, setGroups] = useState<ModelGroup[] | null>(null)
    const [skills, setSkills] = useState<Skill[] | null>(null)
    const [loadError, setLoadError] = useState(false)

    const load = useCallback(async (options?: { force?: boolean }) => {
        if (options?.force) invalidateSceneOperationMenuDataCache()
        setLoadError(false)
        try {
            const data = await loadSceneOperationMenuData()
            setPrompts(data.prompts)
            setDefaults(data.defaults)
            setGroups(data.groups)
        } catch (error) {
            console.error('Failed to load scene operation menu data:', error)
            setLoadError(true)
            setPrompts([])
            setDefaults({})
            setGroups([])
        }
    }, [])

    useEffect(() => {
        if (!onRunSkill) return
        let cancelled = false
        void skillApi.list()
            .then((data) => {
                if (cancelled) return
                setSkills((data.skills ?? []).filter((skill) => skill.enabled && skill.category === 'scene_action'))
            })
            .catch(() => {
                if (!cancelled) setSkills([])
            })
        return () => {
            cancelled = true
        }
    }, [onRunSkill])

    useEffect(() => {
        let cancelled = false

        const loadIfActive = async (options?: { force?: boolean }) => {
            await load(options)
        }

        void loadIfActive()

        const handlePromptsChanged = () => {
            if (cancelled) return
            void loadIfActive({ force: true })
        }

        window.addEventListener(PROMPTS_CHANGED_EVENT, handlePromptsChanged)
        window.addEventListener(MODEL_GROUPS_CHANGED_EVENT, handlePromptsChanged)

        return () => {
            cancelled = true
            window.removeEventListener(PROMPTS_CHANGED_EVENT, handlePromptsChanged)
            window.removeEventListener(MODEL_GROUPS_CHANGED_EVENT, handlePromptsChanged)
        }
    }, [load])

    const selection = (defaults?.scene_action ?? null) as PromptDefaultSelection | null

    const defaultPrompt = useMemo(() => {
        if (!selection?.promptId || !Array.isArray(prompts)) return null
        return prompts.find((prompt) => prompt.id === selection.promptId) ?? null
    }, [prompts, selection])

    const defaultGroups = useMemo(() => getPromptGroups(defaultPrompt, groups), [defaultPrompt, groups])
    const defaultSelectionLabel = defaultPrompt?.name?.trim() || selection?.promptId || tPrompts('defaults.none')
    const defaultDisabledReason = getPromptRunDisabledReason(defaultPrompt, groups)

    const otherPrompts = useMemo(() => {
        if (!Array.isArray(prompts)) return []
        const excludedId = selection?.promptId ?? null
        return excludedId ? prompts.filter((prompt) => prompt.id !== excludedId) : prompts
    }, [prompts, selection])

    const canRunDefault = !disabled && !!defaultPrompt && !defaultDisabledReason

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled}>
                <List className="h-4 w-4" />
                {tPrompts('categories.sceneAction')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[18rem]">
                <DropdownMenuItem
                    className="items-start py-2"
                    disabled={!canRunDefault}
                    onSelect={() => {
                        if (!canRunDefault || !defaultPrompt) return
                        onRun({ prompt: defaultPrompt, groups: defaultGroups })
                    }}
                >
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                            <Heart className="h-4 w-4 text-muted-foreground" />
                            <span>{t('scene.useDefaultPrompt')}</span>
                        </div>
                        <div className="pl-6 text-xs text-muted-foreground">{defaultSelectionLabel}</div>
                        {defaultDisabledReason && defaultPrompt && (
                            <div className="pl-6 text-xs text-muted-foreground">
                                {tSceneOperation(`disabledReasons.${defaultDisabledReason}`)}
                            </div>
                        )}
                    </div>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {prompts === null ? (
                    <DropdownMenuItem disabled>{tPrompts('status.loading')}</DropdownMenuItem>
                ) : loadError ? (
                    <DropdownMenuItem disabled>{tCommon('operationFailed')}</DropdownMenuItem>
                ) : otherPrompts.length === 0 ? (
                    <DropdownMenuItem disabled>{tPrompts('library.empty')}</DropdownMenuItem>
                ) : (
                    otherPrompts.map((prompt) => {
                        const promptGroups = getPromptGroups(prompt, groups)
                        const disabledReason = getPromptRunDisabledReason(prompt, groups)
                        const runnable = !disabled && !disabledReason

                        return (
                            <DropdownMenuItem
                                key={prompt.id}
                                disabled={!runnable}
                                className={cn('items-start', !runnable && 'text-muted-foreground')}
                                onSelect={() => {
                                    if (!runnable) return
                                    onRun({ prompt, groups: promptGroups })
                                }}
                            >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="flex min-w-0 items-center gap-2">
                                        {disabledReason && <span className="text-muted-foreground">X</span>}
                                        <span className="truncate">{prompt.name}</span>
                                    </span>
                                    {disabledReason && (
                                        <span className="pl-4 text-xs text-muted-foreground">
                                            {tSceneOperation(`disabledReasons.${disabledReason}`)}
                                        </span>
                                    )}
                                </span>
                                <DropdownMenuShortcut>{promptGroups.length}</DropdownMenuShortcut>
                            </DropdownMenuItem>
                        )
                    })
                )}

                {onRunSkill && skills && skills.length > 0 && (
                    <>
                        <DropdownMenuSeparator />
                        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {tSceneOperation('skillsSection')}
                        </div>
                        {skills.map((skill) => (
                            <DropdownMenuItem
                                key={skill.id}
                                disabled={disabled}
                                className="items-start"
                                onSelect={() => {
                                    if (disabled) return
                                    onRunSkill(skill)
                                }}
                            >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{skill.name}</span>
                                    </span>
                                    {skill.description && (
                                        <span className="line-clamp-1 pl-6 text-xs text-muted-foreground">
                                            {skill.description}
                                        </span>
                                    )}
                                </span>
                            </DropdownMenuItem>
                        ))}
                    </>
                )}
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    )
}
