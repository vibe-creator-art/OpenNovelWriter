'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { gptImageApi, type AiModel, type GptImageConnection } from '@/lib/api'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function OtherConnectionsTab() {
    const t = useTranslations('settings.other')
    const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
    const [apiKey, setApiKey] = useState('')
    const [hasApiKey, setHasApiKey] = useState(false)
    const [showApiKey, setShowApiKey] = useState(false)
    const [modelId, setModelId] = useState('')
    const [models, setModels] = useState<AiModel[]>([])
    const [loading, setLoading] = useState(true)
    const [fetchingModels, setFetchingModels] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        gptImageApi.getConnection()
            .then(({ connection }) => {
                if (cancelled || !connection) return
                applyConnection(connection)
            })
            .catch((nextError) => {
                if (!cancelled) setError(nextError instanceof Error ? nextError.message : t('errors.loadFailed'))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [t])

    function applyConnection(connection: GptImageConnection) {
        setBaseUrl(connection.baseUrl)
        setApiKey('')
        setHasApiKey(connection.hasApiKey)
        setModelId(connection.modelId)
        setModels(connection.models)
    }

    async function fetchModels() {
        setSaved(false)
        setError(null)
        if (!baseUrl.trim()) {
            setError(t('errors.missingBaseUrl'))
            return
        }
        if (!apiKey.trim() && !hasApiKey) {
            setError(t('errors.missingApiKey'))
            return
        }

        setFetchingModels(true)
        try {
            const result = await gptImageApi.fetchModels({
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim() || undefined,
            })
            setModels(result.models)
            if (!modelId) setModelId(result.models[0]?.id || '')
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : t('errors.fetchModelsFailed'))
        } finally {
            setFetchingModels(false)
        }
    }

    async function saveConnection() {
        setSaved(false)
        setError(null)
        if (!baseUrl.trim()) {
            setError(t('errors.missingBaseUrl'))
            return
        }
        if (!apiKey.trim() && !hasApiKey) {
            setError(t('errors.missingApiKey'))
            return
        }
        if (!modelId || !models.some((model) => model.id === modelId)) {
            setError(t('errors.missingModel'))
            return
        }

        setSaving(true)
        try {
            const result = await gptImageApi.saveConnection({
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim() || undefined,
                modelId,
                models,
            })
            applyConnection(result.connection)
            setShowApiKey(false)
            setSaved(true)
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : t('errors.saveFailed'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('loading')}
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="gpt-image-base-url">{t('baseUrl')}</Label>
                            <Input
                                id="gpt-image-base-url"
                                value={baseUrl}
                                onChange={(event) => {
                                    setBaseUrl(event.target.value)
                                    setSaved(false)
                                }}
                                placeholder={DEFAULT_BASE_URL}
                            />
                            <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="gpt-image-api-key">{t('apiKey')}</Label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        id="gpt-image-api-key"
                                        type={showApiKey ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        value={apiKey}
                                        onChange={(event) => {
                                            setApiKey(event.target.value)
                                            setSaved(false)
                                        }}
                                        placeholder={hasApiKey ? t('apiKeySavedPlaceholder') : t('apiKeyPlaceholder')}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowApiKey((value) => !value)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        aria-label={showApiKey ? t('hideApiKey') : t('showApiKey')}
                                    >
                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <Button type="button" variant="outline" onClick={() => void fetchModels()} disabled={fetchingModels}>
                                    {fetchingModels ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                    {fetchingModels ? t('fetchingModels') : t('fetchModels')}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
                        </div>

                        <div className="space-y-2">
                            <Label>{t('model')}</Label>
                            <Select value={modelId} onValueChange={(value) => {
                                setModelId(value)
                                setSaved(false)
                            }} disabled={models.length === 0}>
                                <SelectTrigger>
                                    <SelectValue placeholder={t('modelPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {models.map((model) => (
                                        <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">{t('modelHint')}</p>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}
                        {saved && (
                            <div className="flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                {t('saved')}
                            </div>
                        )}

                        <Button onClick={() => void saveConnection()} disabled={saving || fetchingModels}>
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {saving ? t('saving') : t('save')}
                        </Button>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
