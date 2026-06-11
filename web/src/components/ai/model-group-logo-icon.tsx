'use client'

import { useState } from 'react'
import Image from 'next/image'
import OpenAIProviderLogo from '@/lib/cherrystudio-model-config/assets/images/providers/openai.png'
import { getCherryStudioModelLogoById } from '@/lib/cherrystudio-model-config'
import { useAiStore, type AiConnection, type ModelGroup } from '@/lib/ai-store'
import { cn } from '@/lib/utils'

type ModelGroupLogoGroup = Pick<ModelGroup, 'name' | 'assignments'>

function getPrimaryAssignment(group?: ModelGroupLogoGroup | null) {
    return group?.assignments.find((assignment) => assignment.modelId.trim())
}

function getModelGroupLogoKey(group?: ModelGroupLogoGroup | null, fallbackLabel?: string) {
    const assignedModelId = getPrimaryAssignment(group)?.modelId.trim()
    if (assignedModelId) return assignedModelId

    const groupName = group?.name?.trim()
    if (groupName) return groupName

    return fallbackLabel?.trim() ?? ''
}

function isOfficialOpenAIConnection(connection?: AiConnection | null) {
    if (!connection || connection.providerType !== 'openai-chat') {
        return false
    }

    const baseUrl = connection.baseUrl?.trim().toLocaleLowerCase()
    if (!baseUrl) {
        return true
    }

    return baseUrl.includes('openai.com') || baseUrl.includes('azure.com')
}

function isOpenAIModelFamily(modelId: string) {
    const normalized = modelId.trim().toLocaleLowerCase()
    return /(^|\/)(gpt|o[1-4]|text-embedding|dall-e|whisper|tts)/.test(normalized)
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
    const logoKey = getModelGroupLogoKey(group, fallbackLabel)
    const primaryAssignment = getPrimaryAssignment(group)
    const primaryModelId = primaryAssignment?.modelId?.trim() || ''
    const primaryConnection = connections.find(
        (connection) => connection.id === primaryAssignment?.connectionId
    )
    const usesOpenAIProviderLogo =
        Boolean(logoKey) &&
        Boolean(primaryModelId) &&
        isOfficialOpenAIConnection(primaryConnection) &&
        isOpenAIModelFamily(primaryModelId)
    const logo = usesOpenAIProviderLogo
        ? OpenAIProviderLogo
        : logoKey
            ? getCherryStudioModelLogoById(logoKey)
            : undefined
    const logoIdentity = `${usesOpenAIProviderLogo ? 'openai-provider' : 'model'}:${logoKey}`
    const [failedLogoIdentity, setFailedLogoIdentity] = useState<string | null>(null)

    if (!logo || failedLogoIdentity === logoIdentity) {
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

    return (
        <div
            className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-muted bg-background',
                className
            )}
        >
            <Image
                key={logoIdentity}
                src={logo}
                alt=""
                width={16}
                height={16}
                className={cn('h-4 w-4 object-contain', imageClassName)}
                unoptimized
                onError={() => setFailedLogoIdentity(logoIdentity)}
            />
        </div>
    )
}
