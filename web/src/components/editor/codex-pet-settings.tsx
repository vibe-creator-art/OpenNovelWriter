'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { CodexPetSprite } from '@/components/editor/codex-pet-sprite'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { petApi } from '@/lib/api'
import { DEFAULT_PET_ID, type PetSummary } from '@/lib/pets'
import { cn } from '@/lib/utils'

type CodexPetSettingsProps = {
    enabled: boolean
    selectedPetId: string
    onEnabledChange: (enabled: boolean) => void
    onSelectedPetChange: (petId: string) => void
    onPetDeleted: (petId: string) => void
}

export function CodexPetSettings({
    enabled,
    selectedPetId,
    onEnabledChange,
    onSelectedPetChange,
    onPetDeleted,
}: CodexPetSettingsProps) {
    const t = useTranslations('novelSettings.codex.pet')
    const [pets, setPets] = useState<PetSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        setLoading(true)
        void petApi.list()
            .then((result) => {
                if (active) setPets(result.pets)
            })
            .catch((error) => console.error('Failed to load Codex pets:', error))
            .finally(() => {
                if (active) setLoading(false)
            })
        return () => {
            active = false
        }
    }, [])

    const removePet = async (pet: PetSummary) => {
        if (pet.builtIn || deletingId) return
        if (!window.confirm(t('deleteConfirm', { name: pet.displayName }))) return
        setDeletingId(pet.id)
        try {
            await petApi.delete(pet.id)
            setPets((current) => current.filter((item) => item.id !== pet.id))
            onPetDeleted(pet.id)
            if (selectedPetId === pet.id) onSelectedPetChange(DEFAULT_PET_ID)
        } catch (error) {
            console.error('Failed to delete Codex pet:', error)
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <section className="space-y-4 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <Label htmlFor="codex-pet-enabled" className="text-sm font-medium">
                        {t('enabledLabel')}
                    </Label>
                    <p className="text-xs leading-5 text-muted-foreground">{t('enabledDescription')}</p>
                </div>
                <Switch id="codex-pet-enabled" checked={enabled} onCheckedChange={onEnabledChange} />
            </div>

            <div className={cn('space-y-3', !enabled && 'opacity-50')}>
                <div>
                    <div className="text-sm font-medium">{t('chooseLabel')}</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('chooseDescription')}</p>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('loading')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {pets.map((pet) => {
                            const selected = pet.id === selectedPetId
                            return (
                                <div
                                    key={pet.id}
                                    role="button"
                                    tabIndex={enabled ? 0 : -1}
                                    aria-pressed={selected}
                                    className={cn(
                                        'group relative flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                                        enabled && 'cursor-pointer hover:bg-muted/50',
                                        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border'
                                    )}
                                    onClick={() => enabled && onSelectedPetChange(pet.id)}
                                    onKeyDown={(event) => {
                                        if (!enabled || (event.key !== 'Enter' && event.key !== ' ')) return
                                        event.preventDefault()
                                        onSelectedPetChange(pet.id)
                                    }}
                                >
                                    <div className="flex h-[78px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                                        <CodexPetSprite
                                            spriteUrl={pet.spriteUrl}
                                            animation="idle"
                                            width={72}
                                            label={pet.displayName}
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-semibold">{pet.displayName}</span>
                                            {pet.builtIn && (
                                                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                                                    {t('builtIn')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                                            {pet.description}
                                        </p>
                                    </div>
                                    {selected && (
                                        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Check className="h-3 w-3" />
                                        </span>
                                    )}
                                    {!pet.builtIn && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            className="absolute bottom-2 right-2 h-7 w-7 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                                            disabled={deletingId === pet.id}
                                            title={t('delete')}
                                            aria-label={t('delete')}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                void removePet(pet)
                                            }}
                                        >
                                            {deletingId === pet.id
                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : <Trash2 className="h-3.5 w-3.5" />}
                                        </Button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </section>
    )
}
