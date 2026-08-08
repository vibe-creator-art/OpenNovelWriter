'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    getLoadedCherryStudioIcon,
    inferCherryStudioProviderId,
    loadCherryStudioIcon,
    resolveCherryStudioIcon,
    type CherryStudioIcon,
} from '@/lib/cherrystudio-model-config'
import { useAiStore, type ModelGroup } from '@/lib/ai-store'
import { cn } from '@/lib/utils'

type ModelGroupLogoGroup = Pick<ModelGroup, 'name' | 'assignments'>

function getPrimaryAssignment(group?: ModelGroupLogoGroup | null) {
    return group?.assignments.find((assignment) => assignment.modelId.trim())
}

export function ModelGroupLogoIcon({
    group,
    fallbackLabel,
    className,
    imageClassName,
}: {
    group?: ModelGroupLogoGroup | null
    fallbackLabel?: string
    className?: string
    imageClassName?: string
}) {
    const connections = useAiStore((state) => state.connections)
    const label = fallbackLabel?.trim() || group?.name?.trim() || '?'
    const primaryAssignment = getPrimaryAssignment(group)
    const modelId = primaryAssignment?.modelId.trim() || group?.name?.trim() || fallbackLabel?.trim() || ''
    const connection = connections.find((item) => item.id === primaryAssignment?.connectionId)
    const providerId = inferCherryStudioProviderId({
        providerType: connection?.providerType,
        baseUrl: connection?.baseUrl,
    })
    const iconRef = useMemo(
        () => resolveCherryStudioIcon(modelId, providerId),
        [modelId, providerId]
    )
    const iconIdentity = iconRef ? `${iconRef.kind}:${iconRef.key}` : ''
    const [iconState, setIconState] = useState<{
        identity: string
        icon: CherryStudioIcon
    } | null>(null)
    const loadedIcon =
        iconState?.identity === iconIdentity
            ? iconState.icon
            : iconRef
              ? getLoadedCherryStudioIcon(iconRef)
              : undefined

    useEffect(() => {
        let active = true
        if (!iconRef) return

        const cached = getLoadedCherryStudioIcon(iconRef)
        if (cached) return

        void loadCherryStudioIcon(iconRef).then((icon) => {
            if (active && icon) setIconState({ identity: iconIdentity, icon })
        })
        return () => {
            active = false
        }
    }, [iconIdentity, iconRef])

    if (!loadedIcon) {
        return (
            <div
                className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-muted bg-muted/40 text-[9px] font-semibold uppercase text-muted-foreground',
                    className
                )}
            >
                {label.charAt(0) || '?'}
            </div>
        )
    }

    const LightIcon = loadedIcon.light
    const DarkIcon = loadedIcon.dark

    return (
        <div
            className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-muted bg-background',
                className
            )}
        >
            <LightIcon
                aria-hidden="true"
                className={cn('h-4 w-4 object-contain', DarkIcon && 'dark:hidden', imageClassName)}
            />
            {DarkIcon && (
                <DarkIcon
                    aria-hidden="true"
                    className={cn('hidden h-4 w-4 object-contain dark:block', imageClassName)}
                />
            )}
        </div>
    )
}
