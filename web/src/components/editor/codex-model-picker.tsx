'use client'

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, RotateCcw, Zap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    type CodexModelCatalogEntry,
    type CodexReasoningEffort,
    type CodexServiceTier,
} from '@/lib/api'
import { CODEX_NATIVE_PROVIDER_MODELS, DEFAULT_CODEX_CHAT_SETTINGS, isGptCodexModelId } from '@/lib/codex-config'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-is-mobile'
import styles from './codex-model-picker.module.css'

const GENERIC_CUSTOM_EFFORTS: CodexReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']

const PRESETS: Array<{ modelId: string; effort: CodexReasoningEffort }> = [
    { modelId: 'gpt-5.6-terra', effort: 'low' },
    { modelId: 'gpt-5.6-sol', effort: 'low' },
    { modelId: 'gpt-5.6-sol', effort: 'medium' },
    { modelId: 'gpt-6-astra', effort: 'low' },
    { modelId: 'gpt-6-astra', effort: 'medium' },
    { modelId: 'gpt-6-astra', effort: 'xhigh' },
]

function createSliderParticles() {
    let seed = 9417
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
    }
    return Array.from({ length: 28 }, () => ({
        x: `${random() * 100}%`,
        y: `${12 + random() * 70}%`,
        size: `${1.5 + random() * 2}px`,
        duration: `${1.4 + random() * 0.68}s`,
        delay: `${-random() * 3}s`,
    }))
}

const SLIDER_PARTICLES = createSliderParticles()

const BUILTIN_MODELS: CodexModelCatalogEntry[] = CODEX_NATIVE_PROVIDER_MODELS.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: '',
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    serviceTiers: [],
}))

function formatModelLabel(modelId: string, displayName?: string) {
    const nativeModel = BUILTIN_MODELS.find((model) => model.id === modelId.trim().toLowerCase())
    return nativeModel?.displayName || displayName?.trim() || modelId.trim()
}

function findPresetIndex(modelId: string, effort: CodexReasoningEffort) {
    return PRESETS.findIndex(
        (preset) => preset.modelId === modelId.trim().toLowerCase() && preset.effort === effort
    )
}

function getModelEfforts(model: CodexModelCatalogEntry | undefined) {
    if (!model) return GENERIC_CUSTOM_EFFORTS
    return model.supportedReasoningEfforts
}

function ModelPickerSubmenu({ label, value, className, children }: {
    label: string
    value: ReactNode
    className: string
    children: ReactNode
}) {
    const isMobile = useIsMobile()
    const [expanded, setExpanded] = useState(false)
    const triggerContent = <><span className="shrink-0">{label}</span>{value}</>

    if (isMobile) {
        return (
            <>
                <DropdownMenuItem
                    aria-expanded={expanded}
                    onSelect={(event) => {
                        event.preventDefault()
                        setExpanded((current) => !current)
                    }}
                >
                    {triggerContent}
                    <ChevronDown className={cn('ml-auto', expanded && 'rotate-180')} />
                </DropdownMenuItem>
                {expanded && <div role="group" aria-label={label} className="pl-2">{children}</div>}
            </>
        )
    }

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>{triggerContent}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={className}>{children}</DropdownMenuSubContent>
        </DropdownMenuSub>
    )
}

type CodexModelPickerProps = {
    modelId: string
    reasoningEffort: CodexReasoningEffort
    serviceTier: CodexServiceTier
    models: CodexModelCatalogEntry[]
    includeBuiltinModels: boolean
    showServiceTier: boolean
    fastModeDescription: string
    modelSettingsDisabled?: boolean
    onFastModeChange: (enabled: boolean) => void
    onChange: (settings: Partial<{
        modelId: string
        reasoningEffort: CodexReasoningEffort
        serviceTier: CodexServiceTier
    }>) => void
}

export function CodexModelPicker({
    modelId,
    reasoningEffort,
    serviceTier,
    models,
    includeBuiltinModels,
    showServiceTier,
    fastModeDescription,
    modelSettingsDisabled,
    onChange,
    onFastModeChange,
}: CodexModelPickerProps) {
    const t = useTranslations('editor')
    const [open, setOpen] = useState(false)
    const [showModels, setShowModels] = useState(false)
    const [explicitModelId, setExplicitModelId] = useState<string | null>(null)
    const [dragIndex, setDragIndex] = useState<number | null>(null)
    const [maxBurst, setMaxBurst] = useState(0)
    const draggingRef = useRef(false)

    const availableModels = useMemo(() => {
        const catalog = new Map<string, CodexModelCatalogEntry>()
        if (includeBuiltinModels) {
            for (const model of BUILTIN_MODELS) catalog.set(model.id, model)
        }
        for (const model of models) {
            const builtin = catalog.get(model.id.toLowerCase())
            catalog.set(model.id.toLowerCase(), builtin ? { ...model, ...builtin, serviceTiers: model.serviceTiers } : model)
        }
        return [...catalog.values()]
    }, [includeBuiltinModels, models])
    const selectedModel = availableModels.find((model) => model.id.toLowerCase() === modelId.trim().toLowerCase())
    const useGptPicker = includeBuiltinModels && isGptCodexModelId(modelId)
    const currentPresetIndex = findPresetIndex(modelId, reasoningEffort)
    const defaultMode = explicitModelId !== modelId && currentPresetIndex >= 0
    const effortOptions = getModelEfforts(selectedModel)
    const steps = defaultMode ? PRESETS : effortOptions.map((effort) => ({ modelId, effort }))
    const selectedIndex = defaultMode ? currentPresetIndex : effortOptions.indexOf(reasoningEffort)
    const previewIndex = dragIndex ?? Math.max(0, selectedIndex)
    const preview = steps[previewIndex]
    const atMaximum = steps.length > 1 && previewIndex === steps.length - 1
    const fast = showServiceTier && serviceTier === 'fast'
    const effortLabel = (effort: CodexReasoningEffort) => t(`codex.${useGptPicker ? 'pickerEfforts' : 'reasoningEfforts'}.${effort}`)
    const resetToDefault = () => {
        if (useGptPicker) {
            onChange(DEFAULT_CODEX_CHAT_SETTINGS)
            setExplicitModelId(null)
        } else {
            const defaultModel = availableModels[0]
            if (!defaultModel) return
            onChange({ modelId: defaultModel.id, reasoningEffort: defaultModel.defaultReasoningEffort })
        }
        setDragIndex(null)
        setMaxBurst(0)
        setShowModels(false)
    }
    const selectModel = (nextModel: CodexModelCatalogEntry) => {
        const supported = getModelEfforts(nextModel)
        const effort = isGptCodexModelId(nextModel.id)
            ? (supported.includes('high') ? 'high' : nextModel.defaultReasoningEffort)
            : (supported.includes(reasoningEffort) ? reasoningEffort : nextModel.defaultReasoningEffort)
        onChange({ modelId: nextModel.id, reasoningEffort: effort })
        setExplicitModelId(nextModel.id)
        setDragIndex(null)
        setMaxBurst(0)
        setShowModels(false)
    }
    const commitStep = (index: number) => {
        const step = steps[index]
        if (step) onChange({ modelId: step.modelId, reasoningEffort: step.effort })
    }

    return (
        <DropdownMenu
            open={open}
            onOpenChange={(nextOpen) => {
                setShowModels(false)
                setDragIndex(null)
                setMaxBurst(0)
                draggingRef.current = false
                setOpen(nextOpen)
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="max-w-full min-w-0 gap-0.5 px-1.5 has-[>svg]:px-1.5 text-muted-foreground"
                >
                    {showServiceTier && serviceTier === 'fast' && (
                        <Zap className="h-4 w-4 shrink-0 fill-current text-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground">
                        {formatModelLabel(modelId, selectedModel?.displayName)}
                    </span>
                    <span className={cn('shrink-0', reasoningEffort === 'ultra' && 'codex-ultra-text')}>
                        {effortLabel(reasoningEffort)}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            {!useGptPicker ? (
                <DropdownMenuContent align="end" collisionPadding={8} className="w-56 max-w-[calc(100vw-1rem)] p-1">
                    <ModelPickerSubmenu
                        label={t('codex.model')}
                        value={
                            <span className="ml-auto min-w-0 truncate text-muted-foreground">
                                {formatModelLabel(modelId, selectedModel?.displayName)}
                            </span>
                        }
                        className="w-52"
                    >
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('codex.model')}</div>
                        {availableModels.map((model) => (
                            <DropdownMenuItem key={model.id} disabled={modelSettingsDisabled} onSelect={() => selectModel(model)}>
                                <span className="min-w-0 break-words">{formatModelLabel(model.id, model.displayName)}</span>
                                {modelId.toLowerCase() === model.id.toLowerCase() && <Check className="ml-auto" />}
                            </DropdownMenuItem>
                        ))}
                    </ModelPickerSubmenu>
                    <ModelPickerSubmenu
                        label={t('codex.effort')}
                        value={
                            <span className={cn('ml-auto text-muted-foreground', reasoningEffort === 'ultra' && 'codex-ultra-text')}>
                                {t(`codex.reasoningEfforts.${reasoningEffort}`)}
                            </span>
                        }
                        className="w-56"
                    >
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('codex.effort')}</div>
                        {effortOptions.map((effort) => (
                            <DropdownMenuItem key={effort} disabled={modelSettingsDisabled} onSelect={() => onChange({ reasoningEffort: effort })} className="items-start">
                                <div>
                                    <div>{t(`codex.reasoningEfforts.${effort}`)}</div>
                                    {(effort === 'max' || effort === 'ultra') && (
                                        <div className={cn('text-xs leading-5', effort === 'ultra' ? 'codex-ultra-text' : 'text-blue-500')}>
                                            {t('codex.usageLimitWarning')}
                                        </div>
                                    )}
                                </div>
                                {reasoningEffort === effort && <Check className="ml-auto mt-0.5" />}
                            </DropdownMenuItem>
                        ))}
                    </ModelPickerSubmenu>
                    {showServiceTier && (
                        <ModelPickerSubmenu
                            label={t('codex.speed')}
                            value={<span className="ml-auto text-muted-foreground">{t(`codex.serviceTiers.${serviceTier}`)}</span>}
                            className="w-64"
                        >
                            {(['standard', 'fast'] as CodexServiceTier[]).map((tier) => (
                                <DropdownMenuItem
                                    key={tier}
                                    className="items-start"
                                    onSelect={() => onFastModeChange(tier === 'fast')}
                                >
                                    <div>
                                        <div>{t(`codex.serviceTiers.${tier}`)}</div>
                                        <div className="text-xs leading-5 text-muted-foreground">
                                            {tier === 'fast'
                                                ? fastModeDescription
                                                : t('codex.serviceTierDescriptions.standard')}
                                        </div>
                                    </div>
                                    {serviceTier === tier && <Check className="ml-auto mt-0.5" />}
                                </DropdownMenuItem>
                            ))}
                        </ModelPickerSubmenu>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={modelSettingsDisabled} onSelect={resetToDefault} className="text-muted-foreground">
                        <span>{t('codex.resetToDefault')}</span>
                        <RotateCcw className="ml-auto" />
                    </DropdownMenuItem>
                </DropdownMenuContent>
            ) : (
                <DropdownMenuContent
                    align="end"
                    side="top"
                    collisionPadding={8}
                    className={cn('w-72 max-w-[calc(100vw-1rem)] rounded-2xl p-3 shadow-lg', !showModels && 'overflow-visible')}
                    onKeyDown={(event) => {
                        if (event.key === 'Tab') event.stopPropagation()
                    }}
                >
                    {showModels ? (
                        <>
                            <div className="px-2 pb-1 text-sm text-muted-foreground">{t('codex.selectModel')}</div>
                            <DropdownMenuItem
                                disabled={modelSettingsDisabled}
                                className="items-center rounded-xl"
                                onSelect={(event) => { event.preventDefault(); resetToDefault() }}
                            >
                                <div className="min-w-0">
                                    <div>{t('codex.defaultModels')}</div>
                                    <div className="text-xs text-muted-foreground">{t('codex.recommendedModels')}</div>
                                </div>
                                {defaultMode && <Check className="ml-auto" />}
                            </DropdownMenuItem>
                            {availableModels.map((model) => (
                                <DropdownMenuItem
                                    key={model.id}
                                    disabled={modelSettingsDisabled}
                                    className="rounded-lg"
                                    onSelect={(event) => { event.preventDefault(); selectModel(model) }}
                                >
                                    <span className="min-w-0 break-words">{formatModelLabel(model.id, model.displayName)}</span>
                                    {!defaultMode && modelId.toLowerCase() === model.id.toLowerCase() && <Check className="ml-auto" />}
                                </DropdownMenuItem>
                            ))}
                        </>
                    ) : (
                        <>
                            <div className="mb-3 flex min-h-9 items-start gap-1">
                                {showServiceTier ? (
                                    <button
                                        type="button"
                                        aria-label={t('codex.serviceTiers.fast')}
                                        aria-pressed={fast}
                                        title={fastModeDescription}
                                        className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring', fast ? 'text-blue-500' : 'text-muted-foreground')}
                                        onClick={() => onFastModeChange(!fast)}
                                    >
                                        <Zap className={cn('size-4', fast && 'fill-current')} />
                                    </button>
                                ) : <span className="size-8 shrink-0" />}
                                <button
                                    type="button"
                                    aria-label={t('codex.selectModel')}
                                    disabled={modelSettingsDisabled}
                                    className="min-w-0 flex-1 rounded-lg px-1 py-1 text-center text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                                    onClick={() => setShowModels(true)}
                                >
                                    {defaultMode ? (
                                        <span className="flex items-center justify-center gap-1">
                                            <span className="min-w-0">
                                                <span className="font-medium">{formatModelLabel(preview.modelId)}</span>{' '}
                                                <span className={cn('text-muted-foreground', atMaximum && styles.maximumLabel)}>{effortLabel(preview.effort)}</span>
                                            </span>
                                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                        </span>
                                    ) : (
                                        <>
                                            <span className={cn('flex items-center justify-center gap-1 text-blue-500', atMaximum && styles.maximumLabel)}>
                                                {effortLabel(preview.effort)}<ChevronRight className="size-4 text-muted-foreground" />
                                            </span>
                                            <span className="block text-xs text-muted-foreground">{formatModelLabel(modelId, selectedModel?.displayName)}</span>
                                        </>
                                    )}
                                </button>
                                {!defaultMode && (
                                    <button
                                        type="button"
                                        aria-label={t('codex.resetToDefault')}
                                        title={t('codex.resetToDefault')}
                                        disabled={modelSettingsDisabled}
                                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                                        onClick={resetToDefault}
                                    >
                                        <RotateCcw className="size-4" />
                                    </button>
                                )}
                            </div>
                            <div
                                className={cn(styles.slider, fast && styles.fast, atMaximum && styles.maximum)}
                                style={{ '--codex-slider-progress': steps.length > 1 ? previewIndex / (steps.length - 1) : 0 } as CSSProperties}
                            >
                                <div className={styles.track} aria-hidden="true">
                                    <div className={styles.fill}>
                                        <div className={styles.particles}>
                                            {SLIDER_PARTICLES.slice(0, fast ? 28 : 10).map((particle, index) => (
                                                <span key={index} style={{
                                                    '--particle-x': particle.x,
                                                    '--particle-y': particle.y,
                                                    '--particle-size': particle.size,
                                                    '--particle-duration': particle.duration,
                                                    '--particle-delay': particle.delay,
                                                } as CSSProperties} />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className={styles.dots} aria-hidden="true">
                                    {steps.map((_, index) => <span key={index} className={index <= previewIndex ? styles.filled : undefined} />)}
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={steps.length - 1}
                                    step={1}
                                    value={previewIndex}
                                    disabled={modelSettingsDisabled || steps.length < 2}
                                    aria-label={t(defaultMode ? 'codex.intelligence' : 'codex.effort')}
                                    aria-valuetext={`${formatModelLabel(preview.modelId, selectedModel?.displayName)} ${effortLabel(preview.effort)}`}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => {
                                        draggingRef.current = true
                                        event.currentTarget.setPointerCapture(event.pointerId)
                                    }}
                                    onPointerUp={(event) => {
                                        draggingRef.current = false
                                        commitStep(Number(event.currentTarget.value))
                                        setDragIndex(null)
                                    }}
                                    onPointerCancel={() => {
                                        draggingRef.current = false
                                        setDragIndex(null)
                                    }}
                                    onChange={(event) => {
                                        const index = Number(event.target.value)
                                        if (index === steps.length - 1 && previewIndex !== index) {
                                            setMaxBurst((current) => current + 1)
                                        }
                                        if (draggingRef.current) setDragIndex(index)
                                        else commitStep(index)
                                    }}
                                />
                                {maxBurst > 0 && (
                                    <div key={maxBurst} className={styles.burst} aria-hidden="true">
                                        {Array.from({ length: 12 }, (_, index) => (
                                            <span key={index} style={{ '--burst-index': index } as CSSProperties} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </DropdownMenuContent>
            )}
        </DropdownMenu>
    )
}
