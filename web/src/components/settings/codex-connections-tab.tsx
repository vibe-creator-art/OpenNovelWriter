'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
    ApiError,
    codexApi,
    type CodexConnectionDetail,
    type CodexConnectionProviderType,
    type CodexConnectionSummary,
    type CodexModel,
    type CodexProviderModel,
    type CodexRateLimits,
    type CodexReasoningEffort,
    type CodexUpstreamFormat,
} from '@/lib/api'
import {
    applyNativeCodexModelCapabilities,
    createDefaultCodexProviderModel,
    getDefaultCodexAuthJson,
    getDefaultCodexConfig,
    getDefaultCodexCustomSettings,
} from '@/lib/codex-config'
import { getCodexRateLimitSummary, hasMeaningfulCodexRateLimits } from '@/lib/codex-rate-limits'

const EFFORTS: CodexReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

type FormState = {
    id: string | null
    name: string
    note: string
    providerType: CodexConnectionProviderType
    isActive: boolean
    authStatus: string
    authJson: string
    configToml: string
    upstreamFormat: CodexUpstreamFormat
    baseUrl: string
    apiKey: string
    hasApiKey: boolean
    defaultModelId: string
    models: CodexProviderModel[]
    rateLimits: CodexRateLimits | null
}

function newForm(providerType: CodexConnectionProviderType): FormState {
    const custom = getDefaultCodexCustomSettings()
    return {
        id: null,
        name: providerType === 'custom' ? 'Custom Codex' : 'OpenAI Official',
        note: '',
        providerType,
        isActive: false,
        authStatus: 'unauthenticated',
        authJson: getDefaultCodexAuthJson(),
        configToml: getDefaultCodexConfig(),
        upstreamFormat: custom.upstreamFormat,
        baseUrl: custom.baseUrl,
        apiKey: '',
        hasApiKey: false,
        defaultModelId: custom.defaultModelId,
        models: custom.models,
        rateLimits: null,
    }
}

function detailToForm(detail: CodexConnectionDetail): FormState {
    const connection = detail.connection
    return {
        id: connection.id,
        name: connection.name,
        note: connection.note || '',
        providerType: connection.providerType as CodexConnectionProviderType,
        isActive: connection.isActive,
        authStatus: connection.authStatus,
        authJson: detail.authJson,
        configToml: detail.configToml,
        upstreamFormat: connection.upstreamFormat || 'responses',
        baseUrl: connection.baseUrl || getDefaultCodexCustomSettings().baseUrl,
        apiKey: '',
        hasApiKey: connection.hasApiKey,
        defaultModelId: connection.defaultModelId || connection.models[0]?.id || '',
        models: connection.models.map(applyNativeCodexModelCapabilities),
        rateLimits: detail.rateLimits,
    }
}

export function CodexConnectionsTab() {
    const t = useTranslations('settings.codex')
    const [connections, setConnections] = useState<CodexConnectionSummary[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [form, setForm] = useState<FormState>(() => newForm('openai-official'))
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [authorizing, setAuthorizing] = useState(false)
    const [fetchingModels, setFetchingModels] = useState(false)
    const [discoveredModels, setDiscoveredModels] = useState<CodexModel[]>([])
    const [discoveredModelId, setDiscoveredModelId] = useState('')
    const [showApiKey, setShowApiKey] = useState(false)
    const [deviceCodeLogin, setDeviceCodeLogin] = useState<{ verificationUrl: string; userCode: string } | null>(null)
    const [error, setError] = useState<string | null>(null)

    const selectedSummary = useMemo(
        () => connections.find((connection) => connection.id === selectedId) || null,
        [connections, selectedId]
    )

    const loadConnections = useCallback(async () => {
        setLoading(true)
        try {
            const items = await codexApi.listConnections()
            setConnections(items)
            const target = items.find((item) => item.id === selectedId) || items[0]
            if (target) {
                setSelectedId(target.id)
                setForm(detailToForm(await codexApi.getConnection(target.id)))
            } else {
                setSelectedId(null)
                setForm(newForm('openai-official'))
            }
            setError(null)
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.loadFailed')))
        } finally {
            setLoading(false)
        }
    }, [selectedId, t])

    useEffect(() => {
        void loadConnections()
        // Loading once on mount avoids replacing an in-progress edit when selection changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function selectConnection(id: string) {
        setSelectedId(id)
        setLoading(true)
        try {
            setForm(detailToForm(await codexApi.getConnection(id)))
            setDiscoveredModels([])
            setError(null)
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.loadFailed')))
        } finally {
            setLoading(false)
        }
    }

    function startDraft(providerType: CodexConnectionProviderType) {
        setSelectedId(null)
        setForm(newForm(providerType))
        setDiscoveredModels([])
        setError(null)
    }

    function payload(active = form.isActive) {
        return {
            name: form.name,
            note: form.note || null,
            providerType: form.providerType,
            isActive: active,
            ...(form.providerType === 'openai-official'
                ? { authJson: form.authJson, configToml: form.configToml }
                : {
                    upstreamFormat: form.upstreamFormat,
                    baseUrl: form.baseUrl,
                    apiKey: form.apiKey || undefined,
                    defaultModelId: form.defaultModelId,
                    models: form.models,
                }),
        }
    }

    async function save() {
        setSaving(true)
        try {
            const detail = form.id
                ? await codexApi.updateConnection(form.id, payload())
                : await codexApi.createConnection(payload())
            setForm(detailToForm(detail))
            setSelectedId(detail.connection.id)
            setConnections((current) => {
                const rest = current.filter((item) => item.id !== detail.connection.id)
                return [...rest.map((item) => detail.connection.isActive ? { ...item, isActive: false } : item), detail.connection]
            })
            setError(null)
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.saveFailed')))
        } finally {
            setSaving(false)
        }
    }

    async function activate(connection: CodexConnectionSummary) {
        try {
            const detail = connection.id === form.id ? null : await codexApi.getConnection(connection.id)
            const source = detail ? detailToForm(detail) : form
            const updated = await codexApi.updateConnection(connection.id, {
                name: source.name,
                note: source.note || null,
                providerType: source.providerType,
                isActive: true,
                ...(source.providerType === 'openai-official'
                    ? { authJson: source.authJson, configToml: source.configToml }
                    : {
                        upstreamFormat: source.upstreamFormat,
                        baseUrl: source.baseUrl,
                        defaultModelId: source.defaultModelId,
                        models: source.models,
                    }),
            })
            setConnections((current) => current.map((item) => ({ ...item, isActive: item.id === connection.id })))
            if (form.id === connection.id) setForm(detailToForm(updated))
            setError(null)
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.saveFailed')))
        }
    }

    async function remove() {
        if (!form.id) return startDraft('openai-official')
        if (!window.confirm(t('confirmDelete'))) return
        setDeleting(true)
        try {
            await codexApi.deleteConnection(form.id)
            const remaining = connections.filter((item) => item.id !== form.id)
            setConnections(remaining)
            if (remaining[0]) await selectConnection(remaining[0].id)
            else startDraft('openai-official')
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.deleteFailed')))
        } finally {
            setDeleting(false)
        }
    }

    async function authorize(type: 'chatgpt' | 'chatgptDeviceCode') {
        setAuthorizing(true)
        try {
            let connectionId = form.id
            if (!connectionId) {
                const detail = await codexApi.createConnection(payload())
                connectionId = detail.connection.id
                setForm(detailToForm(detail))
                setSelectedId(connectionId)
                setConnections((current) => [...current, detail.connection])
            }
            const result = await codexApi.startOfficialAuth(connectionId, type)
            if (result.type === 'chatgpt') {
                setDeviceCodeLogin(null)
                window.open(result.authUrl, '_blank', 'noopener,noreferrer')
            } else {
                setDeviceCodeLogin({ verificationUrl: result.verificationUrl, userCode: result.userCode })
            }
            setError(null)
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.authStartFailed')))
        } finally {
            setAuthorizing(false)
        }
    }

    async function fetchModels() {
        if (!form.apiKey.trim() && !form.hasApiKey) {
            setError(t('errors.missingCustomApiKey'))
            return
        }
        setFetchingModels(true)
        try {
            const result = await codexApi.fetchCustomModels({
                apiKey: form.apiKey || undefined,
                baseUrl: form.baseUrl,
                connectionId: form.id || undefined,
            })
            setDiscoveredModels(result.models)
            setDiscoveredModelId(result.models[0]?.id || '')
            setError(null)
        } catch (nextError) {
            setError(errorMessage(nextError, t('errors.fetchModelsFailed')))
        } finally {
            setFetchingModels(false)
        }
    }

    function addDiscoveredModel() {
        const discovered = discoveredModels.find((model) => model.id === discoveredModelId)
        if (!discovered || form.models.some((model) => model.id === discovered.id)) return
        const model = createDefaultCodexProviderModel(discovered.id)
        model.displayName = discovered.name || discovered.id
        setForm((current) => ({
            ...current,
            models: [...current.models, model],
            defaultModelId: current.defaultModelId || model.id,
        }))
    }

    function updateModel(index: number, update: Partial<CodexProviderModel>) {
        setForm((current) => {
            const previous = current.models[index]
            const models = current.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...update } : model)
            return {
                ...current,
                models,
                defaultModelId: current.defaultModelId === previous.id && update.id ? update.id : current.defaultModelId,
            }
        })
    }

    function removeModel(index: number) {
        setForm((current) => {
            const models = current.models.filter((_, modelIndex) => modelIndex !== index)
            return { ...current, models, defaultModelId: models.some((model) => model.id === current.defaultModelId) ? current.defaultModelId : models[0]?.id || '' }
        })
    }

    return (
        <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="min-h-0">
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>{t('connectionsListTitle')}</CardTitle>
                    <Button size="sm" variant="outline" onClick={() => startDraft('custom')}><Plus className="h-4 w-4" />{t('newConnection')}</Button>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-[620px] px-3 pb-3">
                        <div className="space-y-2">
                            {connections.map((connection) => (
                                <div key={connection.id} className={`flex h-16 items-center gap-2 rounded-lg border p-2 ${selectedId === connection.id ? 'border-primary bg-muted/50' : ''}`}>
                                    <button
                                        type="button"
                                        onClick={() => void selectConnection(connection.id)}
                                        className="min-w-0 flex-1 self-stretch rounded-md p-1 text-left"
                                    >
                                        <div className="truncate font-medium">{connection.name}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{connection.providerType === 'custom' ? t('providerTypes.custom') : t('providerTypes.openaiOfficial')}</div>
                                    </button>
                                    <div className="flex w-24 shrink-0 justify-end">
                                        {connection.isActive
                                            ? <Badge>{t('active')}</Badge>
                                            : <Button size="sm" variant="ghost" onClick={() => void activate(connection)}>{t('enable')}</Button>}
                                    </div>
                                </div>
                            ))}
                            {!loading && connections.length === 0 && <div className="p-4 text-sm text-muted-foreground">{t('noConnections')}</div>}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            <Card className="min-h-0">
                <CardHeader><CardTitle>{form.id ? form.name : t('draftTitle')}</CardTitle></CardHeader>
                <CardContent>
                    {loading ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</div> : (
                        <div className="space-y-5">
                            <div className="space-y-2"><Label>{t('connectionName')}</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
                            <div className="space-y-2"><Label>{t('providerTypes.custom')}</Label><Select value={form.providerType} onValueChange={(value: CodexConnectionProviderType) => setForm({ ...newForm(value), id: form.id, name: form.name, note: form.note, isActive: form.isActive })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai-official">{t('providerTypes.openaiOfficial')}</SelectItem><SelectItem value="custom">{t('providerTypes.custom')}</SelectItem></SelectContent></Select></div>

                            {form.providerType === 'custom' ? (
                                <>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2"><Label>{t('upstreamFormat')}</Label><Select value={form.upstreamFormat} onValueChange={(value: CodexUpstreamFormat) => setForm({ ...form, upstreamFormat: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="responses">Responses API</SelectItem><SelectItem value="chat-completions">Chat Completions API</SelectItem></SelectContent></Select></div>
                                        <div className="space-y-2"><Label>{t('customBaseUrl')}</Label><Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></div>
                                    </div>
                                    <div className="space-y-2"><Label>{t('customApiKey')}</Label><div className="flex gap-2"><Input type={showApiKey ? 'text' : 'password'} value={form.apiKey} placeholder={form.hasApiKey ? t('apiKeySavedPlaceholder') : t('customApiKeyPlaceholder')} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /><Button type="button" variant="outline" size="icon" onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button><Button type="button" variant="outline" onClick={() => void fetchModels()} disabled={fetchingModels}>{fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('fetchModels')}</Button></div></div>
                                    {discoveredModels.length > 0 && <div className="flex gap-2"><Select value={discoveredModelId} onValueChange={setDiscoveredModelId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{discoveredModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={addDiscoveredModel}><Plus className="h-4 w-4" />{t('addModel')}</Button></div>}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between"><Label>{t('modelList')}</Label><Button type="button" size="sm" variant="outline" onClick={() => setForm((current) => ({ ...current, models: [...current.models, createDefaultCodexProviderModel(`model-${current.models.length + 1}`)] }))}><Plus className="h-4 w-4" />{t('addModel')}</Button></div>
                                        {form.models.map((model, index) => <ModelEditor key={`${index}-${model.id}`} model={model} isDefault={form.defaultModelId === model.id} onDefault={() => setForm({ ...form, defaultModelId: model.id })} onChange={(update) => updateModel(index, update)} onRemove={() => removeModel(index)} t={t} />)}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-3 rounded-lg border p-3">
                                        <div className="flex flex-wrap items-center gap-3"><span>{t('authStatus')}</span><Badge variant="outline">{t(`status.${form.authStatus}` as never)}</Badge><Button onClick={() => void authorize('chatgpt')} disabled={authorizing}>{authorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}{t('authorize')}</Button><Button variant="secondary" onClick={() => void authorize('chatgptDeviceCode')} disabled={authorizing}><KeyRound className="h-4 w-4" />{t('authorizeDeviceCode')}</Button></div>
                                        {deviceCodeLogin && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"><div><div className="text-sm text-muted-foreground">{t('deviceCodeTitle')}</div><div className="font-mono text-2xl font-semibold">{deviceCodeLogin.userCode}</div></div><div className="flex gap-2"><Button variant="outline" onClick={() => void navigator.clipboard?.writeText(deviceCodeLogin.userCode)}><Copy className="h-4 w-4" />{t('copyDeviceCode')}</Button><Button variant="outline" onClick={() => window.open(deviceCodeLogin.verificationUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" />{t('openDeviceCodeUrl')}</Button></div></div>}
                                        {form.rateLimits && hasMeaningfulCodexRateLimits(form.rateLimits) && <div className="text-sm text-muted-foreground">{getCodexRateLimitSummary(form.rateLimits, t).join(' · ')}</div>}
                                    </div>
                                    <div className="space-y-2"><Label>{t('authJson')}</Label><Textarea className="min-h-32 font-mono" value={form.authJson} onChange={(event) => setForm({ ...form, authJson: event.target.value })} /></div>
                                    <div className="space-y-2"><Label>{t('configToml')}</Label><Textarea className="min-h-44 font-mono" value={form.configToml} onChange={(event) => setForm({ ...form, configToml: event.target.value })} /></div>
                                </>
                            )}

                            {error && <div className="text-sm text-destructive">{error}</div>}
                            <div className="flex justify-end gap-3"><Button variant="destructive" onClick={() => void remove()} disabled={deleting || saving}><Trash2 className="h-4 w-4" />{t('deleteConnection')}</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{t(form.id ? 'save' : 'create')}</Button></div>
                            {selectedSummary && <div className="text-xs text-muted-foreground">{t('lastUpdated', { value: new Date(selectedSummary.updatedAt).toLocaleString() })}</div>}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function ModelEditor({ model, isDefault, onDefault, onChange, onRemove, t }: {
    model: CodexProviderModel
    isDefault: boolean
    onDefault: () => void
    onChange: (update: Partial<CodexProviderModel>) => void
    onRemove: () => void
    t: ReturnType<typeof useTranslations>
}) {
    return <div className="space-y-2 rounded-lg border p-3">
        <div className="grid gap-3 md:grid-cols-2"><div className="space-y-1"><Label>{t('modelId')}</Label><Input value={model.id} onChange={(event) => onChange({ id: event.target.value })} /></div><div className="space-y-1"><Label>{t('modelDisplayName')}</Label><Input value={model.displayName} onChange={(event) => onChange({ displayName: event.target.value })} /></div></div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,0.55fr)_minmax(0,1.25fr)]"><div className="min-w-0 space-y-1"><Label className="whitespace-nowrap text-sm">{t('contextWindow')}</Label><Input type="number" min={1} value={model.contextWindow} onChange={(event) => onChange({ contextWindow: Number(event.target.value) })} /></div><div className="min-w-0 space-y-1"><Label className="whitespace-nowrap text-sm">{t('defaultEffort')}</Label><Select value={model.defaultReasoningEffort} onValueChange={(value: CodexReasoningEffort) => onChange({ defaultReasoningEffort: value, supportedReasoningEfforts: model.supportedReasoningEfforts.includes(value) ? model.supportedReasoningEfforts : [...model.supportedReasoningEfforts, value] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{EFFORTS.map((effort) => <SelectItem key={effort} value={effort}>{effort}</SelectItem>)}</SelectContent></Select></div><div className="min-w-0 space-y-1"><Label className="whitespace-nowrap text-sm">{t('supportedEfforts')}</Label><Input className="min-w-0" value={model.supportedReasoningEfforts.join(', ')} onChange={(event) => onChange({ supportedReasoningEfforts: event.target.value.split(',').map((item) => item.trim()).filter((item): item is CodexReasoningEffort => EFFORTS.includes(item as CodexReasoningEffort)) })} /></div></div>
        <div className="flex flex-wrap items-center gap-5"><label className="flex items-center gap-2 text-sm"><Switch checked={isDefault} onCheckedChange={(checked) => checked && onDefault()} />{t('defaultModel')}</label><label className="flex items-center gap-2 text-sm"><Switch checked={model.supportsParallelToolCalls} onCheckedChange={(checked) => onChange({ supportsParallelToolCalls: checked })} />{t('parallelTools')}</label><label className="flex items-center gap-2 text-sm"><Switch checked={model.inputModalities.includes('image')} onCheckedChange={(checked) => onChange({ inputModalities: checked ? ['text', 'image'] : ['text'] })} />{t('imageInput')}</label><Button type="button" variant="ghost" className="ml-auto text-destructive" onClick={onRemove}><Trash2 className="h-4 w-4" />{t('removeModel')}</Button></div>
    </div>
}

function errorMessage(error: unknown, fallback: string) {
    if (error instanceof ApiError || error instanceof Error) return error.message || fallback
    return fallback
}
