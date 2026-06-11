import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ExternalLink, Trash2 } from 'lucide-react'
import type { TermEntry } from '@/components/editor/terms/types'
import {
    createId,
    formatExternalUrlForDisplay,
    getExternalFaviconUrl,
    normalizeExternalUrl,
} from '@/components/editor/terms/utils'

type ResearchTab = 'notes' | 'external'

type TermEntryResearchTabProps = {
    entry: TermEntry
    activeTab: ResearchTab
    onTabChange: (tab: ResearchTab) => void
    onUpdate: (patch: Partial<TermEntry>) => void
}

function ExternalFavicon({ url }: { url: string }) {
    const normalized = normalizeExternalUrl(url)
    const candidates = useMemo(() => {
        if (!normalized) return [] as string[]
        try {
            const u = new URL(normalized.includes('://') ? normalized : `https://${normalized}`)
            const origin = u.origin
            const hostname = u.hostname

            // Prefer site-hosted icons first (often SVG/hi-res), then fall back to external services.
            const list: string[] = [
                `${origin}/favicon.svg`,
                `${origin}/favicon.ico`,
                `${origin}/favicon.png`,
                `${origin}/apple-touch-icon.png`,
                `${origin}/android-chrome-192x192.png`,
                `${origin}/android-chrome-512x512.png`,
                `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
            ]

            const google = getExternalFaviconUrl(url, 128)
            if (google) list.push(google)
            return list
        } catch {
            const google = getExternalFaviconUrl(url, 128)
            return google ? [google] : []
        }
    }, [normalized, url])

    const [candidateIndex, setCandidateIndex] = useState(0)
    const src = candidates[candidateIndex] ?? null

    if (!src) {
        return (
            <div className="h-10 w-10 rounded-md border bg-background flex items-center justify-center text-muted-foreground">
                <ExternalLink className="h-5 w-5" />
            </div>
        )
    }

    return (
        <div className="h-10 w-10 rounded-md border bg-background flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                alt=""
                src={src}
                className="h-6 w-6 object-contain"
                onError={() => setCandidateIndex((prev) => prev + 1)}
            />
        </div>
    )
}

export function TermEntryResearchTab({ entry, activeTab, onTabChange, onUpdate }: TermEntryResearchTabProps) {
    const t = useTranslations('editor')
    const [externalDraft, setExternalDraft] = useState('')
    const [externalError, setExternalError] = useState<string | null>(null)

    const externalReferences = entry.externalReferences ?? []

    const handleAddExternal = () => {
        const normalized = normalizeExternalUrl(externalDraft)
        if (!normalized) {
            setExternalError(t('terms.panel.research.external.invalidUrl'))
            return
        }

        if (externalReferences.some((ref) => normalizeExternalUrl(ref.url) === normalized)) {
            setExternalError(t('terms.panel.research.external.duplicate'))
            return
        }

        onUpdate({
            externalReferences: [...externalReferences, { id: createId(), url: normalized }],
        })
        setExternalDraft('')
        setExternalError(null)
    }

    return (
        <div className="p-4 space-y-6">
            <div className="flex items-center gap-2 border-b">
                {(
                    [
                        { id: 'notes' as const, label: t('terms.panel.research.tabs.notes') },
                        { id: 'external' as const, label: t('terms.panel.research.tabs.external') },
                    ] as const
                ).map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={cn(
                            'text-sm px-2 py-2 border-b-2 -mb-px transition-colors',
                            activeTab === tab.id
                                ? 'border-foreground text-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'notes' ? (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Label htmlFor="term-panel-research-notes">{t('terms.panel.research.notes.label')}</Label>
                    </div>
                    <div className="text-xs text-muted-foreground">{t('terms.panel.research.notes.help')}</div>
                    <Textarea
                        id="term-panel-research-notes"
                        value={entry.researchNotes ?? ''}
                        placeholder={t('terms.panel.research.notes.placeholder')}
                        className="min-h-80"
                        onChange={(e) => onUpdate({ researchNotes: e.target.value || undefined })}
                    />
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="space-y-1">
                        <div className="text-sm font-medium">{t('terms.panel.research.external.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('terms.panel.research.external.help')}</div>
                    </div>

                    <div className="space-y-2">
                        {externalReferences.length === 0 ? (
                            <div className="text-sm text-muted-foreground">{t('terms.panel.research.external.empty')}</div>
                        ) : (
                            externalReferences.map((ref) => {
                                const display = formatExternalUrlForDisplay(ref.url)
                                const href = normalizeExternalUrl(ref.url) ?? ref.url
                                return (
                                    <div key={ref.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                                        <ExternalFavicon url={ref.url} />
                                        <a
                                            href={href}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="min-w-0 flex-1 truncate text-sm hover:underline"
                                            title={href}
                                        >
                                            {display}
                                        </a>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={() =>
                                                onUpdate({
                                                    externalReferences: externalReferences.filter((x) => x.id !== ref.id),
                                                })
                                            }
                                            aria-label={t('terms.panel.research.external.delete')}
                                            title={t('terms.panel.research.external.delete')}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Input
                                value={externalDraft}
                                onChange={(e) => {
                                    setExternalDraft(e.target.value)
                                    if (externalError) setExternalError(null)
                                }}
                                placeholder={t('terms.panel.research.external.placeholder')}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleAddExternal()
                                }}
                            />
                            <Button onClick={handleAddExternal}>{t('terms.panel.research.external.add')}</Button>
                        </div>
                        {externalError && <div className="text-sm text-destructive">{externalError}</div>}
                    </div>
                </div>
            )}
        </div>
    )
}
