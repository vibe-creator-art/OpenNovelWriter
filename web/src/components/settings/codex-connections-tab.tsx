'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    ApiError,
    codexApi,
    type CodexConnectionDetail,
    type CodexModel,
    type CodexConnectionProviderType,
    type CodexRateLimits,
    type CodexConnectionSummary,
} from '@/lib/api'
import {
    buildCustomCodexAuthJson,
    buildCustomCodexConfigToml,
    getDefaultCodexAuthJson,
    getDefaultCodexConfig,
    getDefaultCodexCustomSettings,
    parseCodexCustomSettingsFromFiles,
} from '@/lib/codex-config'
import {
    getCodexRateLimitSummary,
    hasMeaningfulCodexRateLimits,
} from '@/lib/codex-rate-limits'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
    ArrowRight,
    Bot,
    Copy,
    ExternalLink,
    Eye,
    EyeOff,
    KeyRound,
    Loader2,
    Plus,
    RefreshCw,
    Trash2,
} from 'lucide-react'

type EditableConnection = {
    id: string | null
    name: string
    providerType: CodexConnectionProviderType
    isActive: boolean
    authStatus: string
    authType: string | null
    accountEmail: string | null
    accountPlan: string | null
    lastAuthError: string | null
    authJson: string
    configToml: string
    rateLimits: CodexRateLimits | null
    customApiKey: string
    customBaseUrl: string
    customModel: string
}

function createDraft(
    providerType: CodexConnectionProviderType,
    getLabel: (key: string) => string
): EditableConnection {
    const customSettings = getDefaultCodexCustomSettings()
    return {
        id: null,
        name:
            providerType === 'openai-official'
                ? getLabel('defaults.openaiOfficialName')
                : getLabel('defaults.customName'),
        providerType,
        isActive: false,
        authStatus: 'unauthenticated',
        authType: null,
        accountEmail: null,
        accountPlan: null,
        lastAuthError: null,
        authJson: getDefaultCodexAuthJson(providerType),
        configToml: getDefaultCodexConfig(providerType),
        rateLimits: null,
        customApiKey: customSettings.apiKey,
        customBaseUrl: customSettings.baseUrl,
        customModel: customSettings.model,
    }
}

function fromDetail(detail: CodexConnectionDetail): EditableConnection {
    const providerType = detail.connection.providerType as CodexConnectionProviderType
    const customSettings =
        providerType === 'custom'
            ? parseCodexCustomSettingsFromFiles({
                authJson: detail.authJson,
                configToml: detail.configToml,
            })
            : getDefaultCodexCustomSettings()

    return {
        id: detail.connection.id,
        name: detail.connection.name,
        providerType,
        isActive: detail.connection.isActive,
        authStatus: detail.connection.authStatus,
        authType: detail.connection.authType,
        accountEmail: detail.connection.accountEmail,
        accountPlan: detail.connection.accountPlan,
        lastAuthError: detail.connection.lastAuthError,
        authJson: detail.authJson,
        configToml: detail.configToml,
        rateLimits: detail.rateLimits,
        customApiKey: customSettings.apiKey,
        customBaseUrl: customSettings.baseUrl,
        customModel: customSettings.model,
    }
}

export function CodexConnectionsTab() {
    const t = useTranslations('settings.codex')
    const label = useCallback((key: string) => t(key as never), [t])
    const DRAFT_ENTRY_ID = '__draft__'
    const [connections, setConnections] = useState<CodexConnectionSummary[]>([])
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
    const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false)
    const [form, setForm] = useState<EditableConnection>(() =>
        createDraft('openai-official', label)
    )
    const [loadingList, setLoadingList] = useState(true)
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [authorizingType, setAuthorizingType] = useState<'chatgpt' | 'chatgptDeviceCode' | null>(null)
    const [deviceCodeLogin, setDeviceCodeLogin] = useState<{
        loginId: string
        verificationUrl: string
        userCode: string
    } | null>(null)
    const [copiedDeviceCode, setCopiedDeviceCode] = useState(false)
    const [fetchingCustomModels, setFetchingCustomModels] = useState(false)
    const [customModels, setCustomModels] = useState<CodexModel[]>([])
    const [showCustomApiKey, setShowCustomApiKey] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const pollTimerRef = useRef<number | null>(null)
    const detailRequestIdRef = useRef(0)
    const selectedEntryIdRef = useRef<string | null>(null)
    const detailCacheRef = useRef<Map<string, EditableConnection>>(new Map())

    const selectedSummary = useMemo(
        () =>
            selectedEntryId && selectedEntryId !== DRAFT_ENTRY_ID
                ? connections.find((connection) => connection.id === selectedEntryId) ?? null
                : null,
        [connections, selectedEntryId]
    )
    const currentRateLimits = form.rateLimits
    const isDraftSelected = selectedEntryId === DRAFT_ENTRY_ID
    const isSavedConnectionSelected =
        selectedEntryId !== null && selectedEntryId !== DRAFT_ENTRY_ID
    const isSavedDetailReady = isSavedConnectionSelected && form.id === selectedEntryId
    const showEditor = isDraftSelected || isSavedConnectionSelected || hasUnsavedDraft
    const customModelOptions = useMemo(() => {
        const seen = new Set<string>()
        const options: CodexModel[] = []

        const append = (model: CodexModel | null) => {
            if (!model || !model.id || seen.has(model.id)) return
            seen.add(model.id)
            options.push(model)
        }

        if (form.providerType === 'custom' && form.customModel) {
            append({ id: form.customModel, name: form.customModel })
        }

        for (const model of customModels) {
            append(model)
        }

        return options
    }, [customModels, form.customModel, form.providerType])

    const setSelectedEntry = useCallback((nextId: string | null) => {
        detailRequestIdRef.current += 1
        selectedEntryIdRef.current = nextId
        setSelectedEntryId(nextId)
        setDeviceCodeLogin(null)
        setCopiedDeviceCode(false)
        if (nextId === null) {
            setLoadingDetail(false)
        }
    }, [])

    const cacheDetail = useCallback((detail: EditableConnection) => {
        if (!detail.id) return
        detailCacheRef.current.set(detail.id, detail)
    }, [])

    const loadDetail = useCallback(async (id: string, options?: { silent?: boolean }) => {
        const requestId = ++detailRequestIdRef.current
        if (!options?.silent) {
            setLoadingDetail(true)
        }
        try {
            const detail = await codexApi.getConnection(id)
            if (detailRequestIdRef.current !== requestId || selectedEntryIdRef.current !== id) {
                return
            }
            const editable = fromDetail(detail)
            cacheDetail(editable)
            setForm(editable)
            setError(null)
        } catch (nextError) {
            if (detailRequestIdRef.current !== requestId || selectedEntryIdRef.current !== id) {
                return
            }
            setError(getErrorMessage(nextError, t('errors.loadFailed')))
        } finally {
            if (detailRequestIdRef.current === requestId) {
                setLoadingDetail(false)
            }
        }
    }, [cacheDetail, t])

    const loadConnections = useCallback(async (nextSelectedId?: string | null) => {
        setLoadingList(true)
        try {
            const items = await codexApi.listConnections()
            setConnections(items)

            const targetId =
                nextSelectedId && items.some((item) => item.id === nextSelectedId)
                    ? nextSelectedId
                    : null

            if (targetId) {
                setSelectedEntry(targetId)
            } else {
                setSelectedEntry(null)
                setForm(createDraft('openai-official', label))
            }
        } catch (nextError) {
            setError(getErrorMessage(nextError, t('errors.loadFailed')))
        } finally {
            setLoadingList(false)
        }
    }, [label, setSelectedEntry, t])

    useEffect(() => {
        void loadConnections()
        return () => stopPolling()
    }, [loadConnections])

    useEffect(() => {
        if (!selectedEntryId || selectedEntryId === DRAFT_ENTRY_ID) return
        const cached = detailCacheRef.current.get(selectedEntryId)
        if (cached) {
            setForm(cached)
            setLoadingDetail(false)
            void loadDetail(selectedEntryId, { silent: true })
            return
        }
        void loadDetail(selectedEntryId)
    }, [DRAFT_ENTRY_ID, loadDetail, selectedEntryId])

    useEffect(() => {
        if (form.providerType !== 'custom') {
            setCustomModels([])
            setShowCustomApiKey(false)
        }
    }, [form.providerType])

    function stopPolling() {
        if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
        }
    }

    async function copyDeviceCode() {
        if (!deviceCodeLogin) return
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(deviceCodeLogin.userCode)
        }
        setCopiedDeviceCode(true)
        window.setTimeout(() => {
            setCopiedDeviceCode(false)
        }, 1500)
    }

    function updateSummary(connection: CodexConnectionSummary) {
        setConnections((current) => {
            const index = current.findIndex((item) => item.id === connection.id)
            if (index < 0) return [...current, connection]
            const next = [...current]
            next[index] = connection
            return next
        })
    }

    function applyCustomSettings(
        current: EditableConnection,
        updates: Partial<Pick<EditableConnection, 'customApiKey' | 'customBaseUrl' | 'customModel'>>
    ) {
        const nextCustomApiKey = updates.customApiKey ?? current.customApiKey
        const nextCustomBaseUrl = updates.customBaseUrl ?? current.customBaseUrl
        const nextCustomModel = updates.customModel ?? current.customModel

        return {
            ...current,
            customApiKey: nextCustomApiKey,
            customBaseUrl: nextCustomBaseUrl,
            customModel: nextCustomModel,
            authJson: buildCustomCodexAuthJson({
                apiKey: nextCustomApiKey,
                baseUrl: nextCustomBaseUrl,
                model: nextCustomModel,
            }),
            configToml: buildCustomCodexConfigToml({
                apiKey: nextCustomApiKey,
                baseUrl: nextCustomBaseUrl,
                model: nextCustomModel,
            }),
        }
    }

    function syncCustomFieldsFromFiles(
        current: EditableConnection,
        overrides: Partial<Pick<EditableConnection, 'authJson' | 'configToml'>>
    ) {
        const nextAuthJson = overrides.authJson ?? current.authJson
        const nextConfigToml = overrides.configToml ?? current.configToml
        const nextSettings = parseCodexCustomSettingsFromFiles({
            authJson: nextAuthJson,
            configToml: nextConfigToml,
            fallback: {
                apiKey: current.customApiKey,
                baseUrl: current.customBaseUrl,
                model: current.customModel,
            },
        })

        return {
            ...current,
            authJson: nextAuthJson,
            configToml: nextConfigToml,
            customApiKey: nextSettings.apiKey,
            customBaseUrl: nextSettings.baseUrl,
            customModel: nextSettings.model,
        }
    }

    function startDraft(providerType: CodexConnectionProviderType) {
        stopPolling()
        setHasUnsavedDraft(true)
        setSelectedEntry(DRAFT_ENTRY_ID)
        setForm(createDraft(providerType, label))
        setCustomModels([])
        setError(null)
    }

    function clearDraft() {
        setHasUnsavedDraft(false)
        setForm(createDraft('openai-official', label))
        setCustomModels([])
    }

    function selectSavedConnection(connectionId: string) {
        stopPolling()
        if (hasUnsavedDraft) {
            clearDraft()
        }
        setCustomModels([])
        setSelectedEntry(connectionId)
        const cached = detailCacheRef.current.get(connectionId)
        if (cached) {
            setForm(cached)
            setLoadingDetail(false)
        }
    }

    async function saveCurrent() {
        setSaving(true)
        try {
            const payload = {
                name: form.name,
                providerType: form.providerType,
                isActive: form.isActive,
                authJson: form.authJson,
                configToml: form.configToml,
            }

            const detail = form.id
                ? await codexApi.updateConnection(form.id, payload)
                : await codexApi.createConnection(payload)

            const editable = fromDetail(detail)
            cacheDetail(editable)
            setForm(editable)
            setHasUnsavedDraft(false)
            setSelectedEntry(detail.connection.id)
            updateSummary(detail.connection)
            setError(null)
            return detail.connection.id
        } catch (nextError) {
            setError(getErrorMessage(nextError, t('errors.saveFailed')))
            return null
        } finally {
            setSaving(false)
        }
    }

    async function deleteCurrent() {
        if (!form.id) {
            clearDraft()
            const fallbackId = connections[0]?.id ?? null
            setSelectedEntry(fallbackId)
            return
        }

        if (!window.confirm(t('confirmDelete'))) return

        setDeleting(true)
        try {
            const deletedId = form.id
            await codexApi.deleteConnection(deletedId)
            stopPolling()
            detailCacheRef.current.delete(deletedId)
            const remaining = connections.filter((item) => item.id !== deletedId)
            setConnections(remaining)
            clearDraft()
            setSelectedEntry(null)
            setError(null)
        } catch (nextError) {
            setError(getErrorMessage(nextError, t('errors.deleteFailed')))
        } finally {
            setDeleting(false)
        }
    }

    async function activateConnection(connectionId: string) {
        try {
            const detail =
                form.id === connectionId
                    ? {
                        connection: {
                            id: connectionId,
                            name: form.name,
                            providerType: form.providerType,
                            isActive: form.isActive,
                            note: null,
                            authStatus: form.authStatus,
                            authType: form.authType,
                            accountEmail: form.accountEmail,
                            accountPlan: form.accountPlan,
                            lastAuthError: form.lastAuthError,
                            createdAt: '',
                            updatedAt: '',
                        },
                        authJson: form.authJson,
                        configToml: form.configToml,
                        rateLimits: form.rateLimits,
                    }
                    : await codexApi.getConnection(connectionId)

            const updated = await codexApi.updateConnection(connectionId, {
                name: detail.connection.name,
                providerType: detail.connection.providerType as CodexConnectionProviderType,
                isActive: true,
                authJson: detail.authJson,
                configToml: detail.configToml,
            })

            setConnections((current) =>
                current.map((item) =>
                    item.id === updated.connection.id
                        ? updated.connection
                        : { ...item, isActive: false }
                )
            )

            setForm((current) => {
                if (current.id === updated.connection.id) {
                    const editable = fromDetail(updated)
                    cacheDetail(editable)
                    return editable
                }
                if (current.id) {
                    return {
                        ...current,
                        isActive: false,
                    }
                }
                return current
            })

            setError(null)
        } catch (nextError) {
            setError(getErrorMessage(nextError, t('errors.saveFailed')))
        }
    }

    async function startOfficialAuthorization(type: 'chatgpt' | 'chatgptDeviceCode') {
        setAuthorizingType(type)
        try {
            const connectionId = form.id ?? (await saveCurrent())
            if (!connectionId) return

            const result = await codexApi.startOfficialAuth(connectionId, type)
            if (result.type === 'chatgptDeviceCode') {
                setDeviceCodeLogin({
                    loginId: result.loginId,
                    verificationUrl: result.verificationUrl,
                    userCode: result.userCode,
                })
                setCopiedDeviceCode(false)
            } else {
                setDeviceCodeLogin(null)
                setCopiedDeviceCode(false)
                window.open(result.authUrl, '_blank', 'noopener,noreferrer')
            }
            await pollAuthorizationStatus(connectionId, true)
            stopPolling()
            pollTimerRef.current = window.setInterval(() => {
                void pollAuthorizationStatus(connectionId, false)
            }, 2000)
        } catch (nextError) {
            setError(getErrorMessage(nextError, t('errors.authStartFailed')))
        } finally {
            setAuthorizingType(null)
        }
    }

    async function pollAuthorizationStatus(connectionId: string, refreshEditor: boolean) {
        try {
            const status = await codexApi.getOfficialAuthStatus(connectionId)
            updateSummary(status.connection)

            setForm((current) =>
                current.id === connectionId
                    ? {
                        ...current,
                        isActive: status.connection.isActive,
                        authStatus: status.connection.authStatus,
                        authType: status.connection.authType,
                        accountEmail: status.connection.accountEmail,
                        accountPlan: status.connection.accountPlan,
                        lastAuthError: status.connection.lastAuthError,
                        rateLimits: status.rateLimits,
                    }
                    : current
            )

            if (
                status.connection.authStatus !== 'authorizing' &&
                status.connection.authStatus !== 'unauthenticated'
            ) {
                stopPolling()
                setDeviceCodeLogin(null)
                setCopiedDeviceCode(false)
            }

            if (refreshEditor || status.connection.authStatus === 'authenticated') {
                const detail = await codexApi.getConnection(connectionId)
                const editable = fromDetail(detail)
                cacheDetail(editable)
                setForm(editable)
            }
        } catch (nextError) {
            stopPolling()
            setError(getErrorMessage(nextError, t('errors.authStatusFailed')))
        }
    }

    async function fetchAvailableCustomModels() {
        const apiKey = form.customApiKey.trim()
        if (!apiKey) {
            setError(t('errors.missingCustomApiKey'))
            return
        }

        setFetchingCustomModels(true)
        try {
            const response = await codexApi.fetchCustomModels({
                apiKey,
                baseUrl: form.customBaseUrl.trim(),
            })
            setCustomModels(response.models)
            setError(null)

            if (!form.customModel && response.models[0]?.id) {
                setForm((current) =>
                    current.providerType === 'custom'
                        ? applyCustomSettings(current, {
                            customModel: response.models[0].id,
                        })
                        : current
                )
            }
        } catch (nextError) {
            setError(getErrorMessage(nextError, t('errors.fetchModelsFailed')))
        } finally {
            setFetchingCustomModels(false)
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5" />
                        {t('connectionsTitle')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>{t('connectionsListTitle')}</Label>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => startDraft('openai-official')}
                                >
                                    <Plus className="h-4 w-4" />
                                    {t('newConnection')}
                                </Button>
                            </div>

                            <ScrollArea className="h-[440px] rounded-md border">
                                <div className="space-y-2 p-2">
                                    {hasUnsavedDraft ? (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedEntry(DRAFT_ENTRY_ID)}
                                            className={cn(
                                                'w-full rounded-md border px-3 py-3 text-left transition-colors',
                                                selectedEntryId === DRAFT_ENTRY_ID
                                                    ? 'border-primary bg-primary/5'
                                                    : 'hover:bg-muted/60'
                                            )}
                                        >
                                            <div className="italic font-medium text-muted-foreground">
                                                {t('draftTitle')}
                                            </div>
                                        </button>
                                    ) : null}

                                    {loadingList && connections.length === 0 && !hasUnsavedDraft ? (
                                        <div className="px-3 py-6 text-sm text-muted-foreground">
                                            {t('loading')}
                                        </div>
                                    ) : connections.length === 0 && !hasUnsavedDraft ? (
                                        <div className="px-3 py-6 text-sm text-muted-foreground">
                                            {t('noConnections')}
                                        </div>
                                    ) : (
                                        connections.map((connection) => (
                                            (() => {
                                                const isSelected = selectedEntryId === connection.id
                                                const isActive = connection.isActive

                                                return (
                                            <div
                                                key={connection.id}
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => {
                                                    selectSavedConnection(connection.id)
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault()
                                                        selectSavedConnection(connection.id)
                                                    }
                                                }}
                                                className={cn(
                                                    'w-full cursor-pointer rounded-md border px-3 py-3 transition-colors',
                                                    isSelected
                                                        ? 'border-blue-500 bg-blue-100 shadow-[0_0_0_2px_rgba(59,130,246,0.28)]'
                                                        : isActive
                                                            ? 'border-blue-300 bg-blue-50/50'
                                                            : 'hover:bg-muted/60'
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="truncate font-medium">
                                                            {connection.name}
                                                        </div>
                                                        <div className="mt-1 truncate text-xs text-muted-foreground">
                                                            {connection.providerType === 'openai-official'
                                                                ? t('providerTypes.openaiOfficial')
                                                                : t('providerTypes.custom')}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {isActive ? (
                                                            <span
                                                                aria-label={t('active')}
                                                                className="inline-flex h-2.5 w-2.5 rounded-full bg-blue-500"
                                                            />
                                                        ) : null}
                                                        <Badge
                                                            variant="outline"
                                                            className={getStatusClassName(connection.authStatus)}
                                                        >
                                                            {getStatusLabel(connection.authStatus, label)}
                                                        </Badge>
                                                        {!isActive ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    void activateConnection(connection.id)
                                                                }}
                                                                className="size-8 px-0"
                                                                aria-label={t('enable')}
                                                            >
                                                                <ArrowRight className="h-4 w-4" />
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                                )
                                            })()
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        {showEditor ? (
                        <div className="space-y-5">
                            {isDraftSelected ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomModels([])
                                            setForm(createDraft('openai-official', label))
                                        }}
                                        className={cn(
                                            'rounded-md border px-3 py-3 text-left transition-colors',
                                            form.providerType === 'openai-official'
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'hover:bg-muted/60'
                                        )}
                                    >
                                        <div className="font-medium">{t('providerTypes.openaiOfficial')}</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomModels([])
                                            setForm(createDraft('custom', label))
                                        }}
                                        className={cn(
                                            'rounded-md border px-3 py-3 text-left transition-colors',
                                            form.providerType === 'custom'
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'hover:bg-muted/60'
                                        )}
                                    >
                                        <div className="font-medium">{t('providerTypes.custom')}</div>
                                    </button>
                                </div>
                            ) : null}

                            {isSavedConnectionSelected && !isSavedDetailReady ? (
                                <div className="text-sm text-muted-foreground">{t('loadingDetail')}</div>
                            ) : (
                                <>
                                    <div className="grid gap-4 md:grid-cols-1">
                                        <div className="space-y-2">
                                            <Label htmlFor="codex-connection-name">{t('connectionName')}</Label>
                                            <Input
                                                id="codex-connection-name"
                                                value={form.name}
                                                onChange={(event) =>
                                                    setForm((current) => ({ ...current, name: event.target.value }))
                                                }
                                                placeholder={t('connectionNamePlaceholder')}
                                            />
                                        </div>
                                        {form.providerType === 'openai-official' ? (
                                            <div className="space-y-2">
                                                <Label htmlFor="codex-official-url">{t('officialUrl')}</Label>
                                                <Input
                                                    id="codex-official-url"
                                                    value="https://chatgpt.com/codex"
                                                    readOnly
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="space-y-2">
                                                    <Label htmlFor="codex-custom-base-url">{t('customBaseUrl')}</Label>
                                                    <Input
                                                        id="codex-custom-base-url"
                                                        value={form.customBaseUrl}
                                                        onChange={(event) =>
                                                            setForm((current) =>
                                                                current.providerType === 'custom'
                                                                    ? applyCustomSettings(current, {
                                                                        customBaseUrl: event.target.value,
                                                                    })
                                                                    : current
                                                            )
                                                        }
                                                        placeholder={t('customBaseUrlPlaceholder')}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="codex-custom-api-key">{t('customApiKey')}</Label>
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            id="codex-custom-api-key"
                                                            value={form.customApiKey}
                                                            type={showCustomApiKey ? 'text' : 'password'}
                                                            onChange={(event) =>
                                                                setForm((current) =>
                                                                    current.providerType === 'custom'
                                                                        ? applyCustomSettings(current, {
                                                                            customApiKey: event.target.value,
                                                                        })
                                                                        : current
                                                                )
                                                            }
                                                            placeholder={t('customApiKeyPlaceholder')}
                                                        />
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="outline"
                                                            onClick={() => setShowCustomApiKey((current) => !current)}
                                                            aria-label={
                                                                showCustomApiKey
                                                                    ? t('hideCustomApiKey')
                                                                    : t('showCustomApiKey')
                                                            }
                                                        >
                                                            {showCustomApiKey ? (
                                                                <EyeOff className="h-4 w-4" />
                                                            ) : (
                                                                <Eye className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <Label htmlFor="codex-custom-model">{t('customModel')}</Label>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => void fetchAvailableCustomModels()}
                                                            disabled={fetchingCustomModels}
                                                        >
                                                            {fetchingCustomModels ? (
                                                                <>
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                    {t('fetchingModels')}
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <RefreshCw className="h-4 w-4" />
                                                                    {t('fetchModels')}
                                                                </>
                                                            )}
                                                        </Button>
                                                    </div>
                                                    <Select
                                                        value={form.customModel}
                                                        onValueChange={(value) =>
                                                            setForm((current) =>
                                                                current.providerType === 'custom'
                                                                    ? applyCustomSettings(current, {
                                                                        customModel: value,
                                                                    })
                                                                    : current
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger
                                                            id="codex-custom-model"
                                                            className="w-full"
                                                        >
                                                            <SelectValue
                                                                placeholder={t('customModelPlaceholder')}
                                                            />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {customModelOptions.length === 0 ? (
                                                                <SelectItem value="__empty__" disabled>
                                                                    {t('noCustomModels')}
                                                                </SelectItem>
                                                            ) : (
                                                                customModelOptions.map((model) => (
                                                                    <SelectItem key={model.id} value={model.id}>
                                                                        {model.name}
                                                                    </SelectItem>
                                                                ))
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {form.providerType === 'openai-official' ? (
                                        <div className="space-y-3 rounded-lg border p-4">
                                            <div className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                                                    <div className="text-sm font-medium">{t('authStatus')}</div>
                                                    <Badge
                                                        variant="outline"
                                                        className={getStatusClassName(form.authStatus)}
                                                    >
                                                        {getStatusLabel(form.authStatus, label)}
                                                    </Badge>
                                                    {form.accountEmail ? (
                                                        <div className="text-sm text-muted-foreground">
                                                            {t('authorizedAs', {
                                                                email: form.accountEmail,
                                                                plan: form.accountPlan || t('unknownPlan'),
                                                            })}
                                                        </div>
                                                    ) : null}
                                                    {form.lastAuthError ? (
                                                        <div className="text-sm text-destructive">{form.lastAuthError}</div>
                                                    ) : null}
                                                </div>
                                            </div>

                                            <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                                                {t('officialAuthDeploymentHint')}
                                            </div>

                                            <div className="flex flex-wrap gap-3">
                                                <Button
                                                    onClick={() => void startOfficialAuthorization('chatgpt')}
                                                    disabled={saving || authorizingType !== null}
                                                >
                                                    {authorizingType === 'chatgpt' ? (
                                                        <>
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            {t('authorizing')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <ExternalLink className="h-4 w-4" />
                                                            {t('authorize')}
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => void startOfficialAuthorization('chatgptDeviceCode')}
                                                    disabled={saving || authorizingType !== null}
                                                >
                                                    {authorizingType === 'chatgptDeviceCode' ? (
                                                        <>
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            {t('authorizing')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <KeyRound className="h-4 w-4" />
                                                            {t('authorizeDeviceCode')}
                                                        </>
                                                    )}
                                                </Button>
                                            </div>

                                            {deviceCodeLogin ? (
                                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
                                                    <div className="space-y-1">
                                                        <div className="text-sm font-medium">{t('deviceCodeTitle')}</div>
                                                        <div className="font-mono text-2xl font-semibold tracking-normal">
                                                            {deviceCodeLogin.userCode}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Button variant="outline" onClick={() => void copyDeviceCode()}>
                                                            <Copy className="h-4 w-4" />
                                                            {copiedDeviceCode ? t('copiedDeviceCode') : t('copyDeviceCode')}
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            onClick={() =>
                                                                window.open(
                                                                    deviceCodeLogin.verificationUrl,
                                                                    '_blank',
                                                                    'noopener,noreferrer'
                                                                )
                                                            }
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                            {t('openDeviceCodeUrl')}
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    {form.providerType === 'openai-official' &&
                                    currentRateLimits &&
                                    hasMeaningfulCodexRateLimits(currentRateLimits) ? (
                                        <div className="rounded-lg border bg-muted/20 p-4">
                                            <div className="text-sm font-medium">{t('remainingQuota')}</div>
                                            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                                                {getCodexRateLimitSummary(currentRateLimits, t).map((summary, index) => (
                                                    <div key={`${summary}-${index}`}>{summary}</div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}

                                    <div className="space-y-2">
                                        <Label htmlFor="codex-auth-json">{t('authJson')}</Label>
                                        <Textarea
                                            id="codex-auth-json"
                                            value={form.authJson}
                                            onChange={(event) =>
                                                setForm((current) =>
                                                    current.providerType === 'custom'
                                                        ? syncCustomFieldsFromFiles(current, {
                                                            authJson: event.target.value,
                                                        })
                                                        : { ...current, authJson: event.target.value }
                                                )
                                            }
                                            className="min-h-[180px] font-mono text-sm"
                                            spellCheck={false}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor="codex-config-toml">{t('configToml')}</Label>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    setForm((current) =>
                                                        current.providerType === 'custom'
                                                            ? applyCustomSettings(current, {
                                                                customApiKey: getDefaultCodexCustomSettings().apiKey,
                                                                customBaseUrl: getDefaultCodexCustomSettings().baseUrl,
                                                                customModel: getDefaultCodexCustomSettings().model,
                                                            })
                                                            : {
                                                                ...current,
                                                                configToml: getDefaultCodexConfig('openai-official'),
                                                            }
                                                    )
                                                }
                                            >
                                                {t('resetConfig')}
                                            </Button>
                                        </div>
                                        <Textarea
                                            id="codex-config-toml"
                                            value={form.configToml}
                                            onChange={(event) =>
                                                setForm((current) =>
                                                    current.providerType === 'custom'
                                                        ? syncCustomFieldsFromFiles(current, {
                                                            configToml: event.target.value,
                                                        })
                                                        : { ...current, configToml: event.target.value }
                                                )
                                            }
                                            className="min-h-[180px] font-mono text-sm"
                                            spellCheck={false}
                                        />
                                    </div>

                                    {error ? <div className="text-sm text-destructive">{error}</div> : null}

                                    <div className="flex flex-wrap justify-end gap-3">
                                        <Button
                                            variant="destructive"
                                            onClick={() => void deleteCurrent()}
                                            disabled={deleting || saving}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            {t('deleteConnection')}
                                        </Button>
                                        <Button onClick={() => void saveCurrent()} disabled={saving || loadingDetail}>
                                            {saving ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {t('saving')}
                                                </>
                                            ) : (
                                                t(form.id ? 'save' : 'create')
                                            )}
                                        </Button>
                                    </div>

                                    {loadingDetail ? (
                                        <div className="text-sm text-muted-foreground">{t('loadingDetail')}</div>
                                    ) : null}
                                    {selectedSummary ? (
                                        <div className="text-xs text-muted-foreground">
                                            {t('lastUpdated', {
                                                value: new Date(selectedSummary.updatedAt).toLocaleString(),
                                            })}
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </div>
                        ) : (
                        <div />
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof ApiError) return error.message || fallback
    if (error instanceof Error) return error.message || fallback
    return fallback
}

function getStatusLabel(status: string, t: (key: string) => string) {
    switch (status) {
        case 'authenticated':
            return t('status.authenticated')
        case 'authorizing':
            return t('status.authorizing')
        case 'error':
            return t('status.error')
        default:
            return t('status.unauthenticated')
    }
}

function getStatusClassName(status: string) {
    switch (status) {
        case 'authenticated':
            return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
        case 'authorizing':
            return 'border-amber-500/40 bg-amber-500/10 text-amber-700'
        case 'error':
            return 'border-destructive/40 bg-destructive/10 text-destructive'
        default:
            return 'border-muted-foreground/30 bg-muted text-muted-foreground'
    }
}
