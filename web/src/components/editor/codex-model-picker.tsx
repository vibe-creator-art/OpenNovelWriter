'use client'

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const ADVANCED_MODE_KEY = 'codex.modelPicker.advanced'
const GENERIC_CUSTOM_EFFORTS: CodexReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']

const PRESETS: Array<{ modelId: string; effort: CodexReasoningEffort }> = [
    { modelId: 'gpt-5.6-terra', effort: 'low' },
    { modelId: 'gpt-5.6-sol', effort: 'low' },
    { modelId: 'gpt-5.6-sol', effort: 'medium' },
    { modelId: 'gpt-5.6-sol', effort: 'high' },
    { modelId: 'gpt-5.6-sol', effort: 'xhigh' },
    { modelId: 'gpt-5.6-sol', effort: 'max' },
    { modelId: 'gpt-5.6-sol', effort: 'ultra' },
]

const BUILTIN_56_MODELS: CodexModelCatalogEntry[] = [
    {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        description: '',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'low',
    },
    {
        id: 'gpt-5.6-terra',
        displayName: 'GPT-5.6-Terra',
        description: '',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'medium',
    },
    {
        id: 'gpt-5.6-luna',
        displayName: 'GPT-5.6-Luna',
        description: '',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'medium',
    },
]

function formatModelLabel(modelId: string) {
    const normalized = modelId.trim().toLowerCase()
    const match = normalized.match(/^gpt-(\d+\.\d+)-(sol|terra|luna)$/u)
    if (match) return `${match[1]} ${match[2][0].toUpperCase()}${match[2].slice(1)}`
    if (normalized === 'gpt-5.4-mini') return '5.4 Mini'
    if (normalized.startsWith('gpt-')) return normalized.slice(4).replaceAll('-', ' ')
    return modelId.trim()
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

type CodexModelPickerProps = {
    modelId: string
    reasoningEffort: CodexReasoningEffort
    serviceTier: CodexServiceTier
    models: CodexModelCatalogEntry[]
    showServiceTier: boolean
    disabled?: boolean
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
    showServiceTier,
    disabled,
    onChange,
}: CodexModelPickerProps) {
    const t = useTranslations('editor')
    const [open, setOpen] = useState(false)
    const [advancedSticky, setAdvancedSticky] = useState(false)
    const [dragging, setDragging] = useState(false)
    const draggingRef = useRef(false)
    const currentPresetIndex = findPresetIndex(modelId, reasoningEffort)
    const [previewIndex, setPreviewIndex] = useState(currentPresetIndex >= 0 ? currentPresetIndex : 1)
    const [ultraBurst, setUltraBurst] = useState(0)

    const availableModels = useMemo(() => {
        const catalog = new Map(BUILTIN_56_MODELS.map((model) => [model.id, model]))
        for (const model of models) catalog.set(model.id.toLowerCase(), model)
        return [...catalog.values()]
    }, [models])
    const selectedModel = useMemo(
        () => availableModels.find((model) => model.id.toLowerCase() === modelId.trim().toLowerCase()),
        [availableModels, modelId]
    )
    const isCustomModel = !selectedModel
    const advanced = advancedSticky || isCustomModel || currentPresetIndex < 0
    const preview = PRESETS[previewIndex]
    const ultra = preview.effort === 'ultra'
    const max = preview.effort === 'max'
    const effortOptions = getModelEfforts(selectedModel)
    const modelOptions = selectedModel
        ? availableModels
        : [
            ...availableModels,
            {
                id: modelId,
                displayName: modelId,
                description: '',
                supportedReasoningEfforts: GENERIC_CUSTOM_EFFORTS,
                defaultReasoningEffort: 'medium' as const,
            },
        ]

    const setAdvanced = (value: boolean) => {
        setAdvancedSticky(value)
        window.localStorage.setItem(ADVANCED_MODE_KEY, String(value))
    }

    const commitPreset = (index: number) => {
        const preset = PRESETS[index]
        onChange({ modelId: preset.modelId, reasoningEffort: preset.effort })
    }

    const updatePreview = (index: number) => {
        if (index === PRESETS.length - 1 && previewIndex !== index) {
            setUltraBurst((value) => value + 1)
        }
        setPreviewIndex(index)
    }

    const selectModel = (nextModel: CodexModelCatalogEntry) => {
        const supported = getModelEfforts(nextModel)
        onChange({
            modelId: nextModel.id,
            reasoningEffort: supported.includes(reasoningEffort)
                ? reasoningEffort
                : nextModel.defaultReasoningEffort,
        })
    }

    const resetToDefault = () => {
        onChange({ modelId: 'gpt-5.6-sol', reasoningEffort: 'high' })
        setPreviewIndex(3)
        setAdvanced(false)
        setOpen(false)
    }

    return (
        <DropdownMenu
            open={open}
            onOpenChange={(nextOpen) => {
                if (nextOpen) {
                    setAdvancedSticky(window.localStorage.getItem(ADVANCED_MODE_KEY) === 'true')
                    if (currentPresetIndex >= 0) setPreviewIndex(currentPresetIndex)
                }
                setOpen(nextOpen)
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="max-w-52 gap-1 text-muted-foreground"
                    disabled={disabled}
                >
                    <span className="truncate text-foreground">{formatModelLabel(modelId)}</span>
                    <span className={cn(reasoningEffort === 'ultra' && 'codex-ultra-text')}>
                        {t(`codex.reasoningEfforts.${reasoningEffort}`)}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            {advanced ? (
                <DropdownMenuContent align="end" className="w-56 p-1">
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <span>{t('codex.model')}</span>
                            <span className="ml-auto text-muted-foreground">{formatModelLabel(modelId)}</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-52">
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('codex.model')}</div>
                            {modelOptions.map((model) => (
                                <DropdownMenuItem key={model.id} onSelect={() => selectModel(model)}>
                                    <span>{formatModelLabel(model.id)}</span>
                                    {modelId.toLowerCase() === model.id.toLowerCase() && <Check className="ml-auto" />}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <span>{t('codex.effort')}</span>
                            <span className={cn('ml-auto text-muted-foreground', reasoningEffort === 'ultra' && 'codex-ultra-text')}>
                                {t(`codex.reasoningEfforts.${reasoningEffort}`)}
                            </span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('codex.effort')}</div>
                            {effortOptions.map((effort) => (
                                <DropdownMenuItem key={effort} onSelect={() => onChange({ reasoningEffort: effort })} className="items-start">
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
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {showServiceTier && (
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <span>{t('codex.speed')}</span>
                                <span className="ml-auto text-muted-foreground">{t(`codex.serviceTiers.${serviceTier}`)}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-52">
                                {(['standard', 'fast'] as CodexServiceTier[]).map((tier) => (
                                    <DropdownMenuItem key={tier} onSelect={() => onChange({ serviceTier: tier })}>
                                        <span>{t(`codex.serviceTiers.${tier}`)}</span>
                                        {serviceTier === tier && <Check className="ml-auto" />}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    )}
                    <DropdownMenuSeparator />
                    {(modelId !== 'gpt-5.6-sol' || reasoningEffort !== 'high') && (
                        <DropdownMenuItem onSelect={resetToDefault} className="text-muted-foreground">
                            <span>{t('codex.resetToDefault')}</span>
                            <RotateCcw className="ml-auto" />
                        </DropdownMenuItem>
                    )}
                    <button
                        type="button"
                        className="flex h-8 w-full items-center px-2 text-left text-sm text-muted-foreground"
                        onClick={() => currentPresetIndex >= 0 && setAdvanced(false)}
                    >
                        {t('codex.advanced')}
                        <ChevronUp className="ml-1 h-4 w-4" />
                    </button>
                </DropdownMenuContent>
            ) : (
                <DropdownMenuContent
                    align="end"
                    className="w-64 overflow-visible p-3"
                    onCloseAutoFocus={(event) => dragging && event.preventDefault()}
                >
                    <div className="mb-2 flex min-h-5 items-center text-xs text-muted-foreground">
                        {dragging ? (
                            <>
                                <span>{t('codex.faster')}</span>
                                <span className="ml-auto">{t('codex.smarter')}</span>
                            </>
                        ) : max || ultra ? (
                            <span className={cn('font-medium', ultra ? 'codex-ultra-text' : 'text-blue-500')}>
                                {t('codex.usageLimitWarning')}
                            </span>
                        ) : (
                            <button type="button" className="flex items-center" onClick={() => setAdvanced(true)}>
                                {t('codex.advanced')}
                                <ChevronDown className="ml-1 h-4 w-4 -rotate-90" />
                            </button>
                        )}
                    </div>
                    <div className={cn('codex-effort-slider-wrap', ultra && 'is-ultra', max && 'is-max')}>
                        <div className="codex-effort-dots" aria-hidden="true">
                            {PRESETS.map((_, index) => (
                                <span key={index} className={index === previewIndex ? 'is-selected' : undefined} />
                            ))}
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={PRESETS.length - 1}
                            step={1}
                            value={previewIndex}
                            aria-label={t('codex.intelligence')}
                            style={{ '--codex-slider-fill': `${(previewIndex / (PRESETS.length - 1)) * 100}%` } as CSSProperties}
                            onPointerDown={() => {
                                draggingRef.current = true
                                setDragging(true)
                            }}
                            onPointerUp={(event) => {
                                draggingRef.current = false
                                setDragging(false)
                                commitPreset(Number(event.currentTarget.value))
                            }}
                            onPointerCancel={() => {
                                draggingRef.current = false
                                setDragging(false)
                                updatePreview(currentPresetIndex)
                            }}
                            onChange={(event) => {
                                const nextIndex = Number(event.target.value)
                                updatePreview(nextIndex)
                                if (!draggingRef.current) commitPreset(nextIndex)
                            }}
                        />
                        {ultra && (
                            <div key={ultraBurst} className="codex-ultra-burst" aria-hidden="true">
                                {Array.from({ length: 12 }, (_, index) => (
                                    <span key={index} style={{ '--particle-index': index } as CSSProperties} />
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="mt-2 text-center text-sm">
                        <span>{formatModelLabel(preview.modelId)}</span>{' '}
                        <span className={cn('text-muted-foreground', ultra && 'codex-ultra-text')}>
                            {t(`codex.reasoningEfforts.${preview.effort}`)}
                        </span>
                    </div>
                </DropdownMenuContent>
            )}
        </DropdownMenu>
    )
}
