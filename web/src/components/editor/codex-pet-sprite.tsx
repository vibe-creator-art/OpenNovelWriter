'use client'

import { useEffect, useState } from 'react'

import { PET_ANIMATIONS, type PetAnimationName } from '@/lib/pets'
import { useAuthStore } from '@/lib/store'

type CodexPetSpriteProps = {
    spriteUrl: string
    animation: PetAnimationName
    width?: number
    label?: string
    className?: string
}

export function CodexPetSprite({
    spriteUrl,
    animation,
    width = 144,
    label,
    className,
}: CodexPetSpriteProps) {
    const token = useAuthStore((state) => state.token)
    const [frame, setFrame] = useState(0)
    const [reducedMotion, setReducedMotion] = useState(false)
    const [authenticatedSprite, setAuthenticatedSprite] = useState<{ source: string; url: string } | null>(null)

    useEffect(() => {
        if (!spriteUrl.startsWith('/api/')) return
        let active = true
        let objectUrl: string | null = null
        void fetch(spriteUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to load pet sprite: ${response.status}`)
                return response.blob()
            })
            .then((blob) => {
                if (!active) return
                objectUrl = URL.createObjectURL(blob)
                setAuthenticatedSprite({ source: spriteUrl, url: objectUrl })
            })
            .catch((error) => console.error('Failed to load Codex pet spritesheet:', error))
        return () => {
            active = false
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [spriteUrl, token])

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => setReducedMotion(media.matches)
        update()
        media.addEventListener('change', update)
        return () => media.removeEventListener('change', update)
    }, [])

    useEffect(() => {
        if (reducedMotion) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        const durations = PET_ANIMATIONS[animation].durations
        let nextFrame = 0
        const advance = () => {
            timer = setTimeout(() => {
                if (cancelled) return
                nextFrame = (nextFrame + 1) % durations.length
                setFrame(nextFrame)
                advance()
            }, durations[nextFrame])
        }
        advance()
        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
        }
    }, [animation, reducedMotion])

    const height = width * 208 / 192
    const resolvedAnimation = reducedMotion ? PET_ANIMATIONS.idle : PET_ANIMATIONS[animation]
    const resolvedFrame = reducedMotion ? 0 : frame % resolvedAnimation.durations.length
    const resolvedSpriteUrl = spriteUrl.startsWith('/api/')
        ? authenticatedSprite?.source === spriteUrl ? authenticatedSprite.url : null
        : spriteUrl

    return (
        <div
            role={label ? 'img' : undefined}
            aria-label={label}
            className={className}
            style={{
                width,
                height,
                backgroundImage: resolvedSpriteUrl ? `url("${resolvedSpriteUrl}")` : undefined,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${width * 8}px ${height * 9}px`,
                backgroundPosition: `${-resolvedFrame * width}px ${-resolvedAnimation.row * height}px`,
                imageRendering: 'pixelated',
            }}
        />
    )
}
