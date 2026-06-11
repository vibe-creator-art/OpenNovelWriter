'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useSettingsStore, Locale } from '@/lib/store'
import { Key, Settings, Globe, Bot } from 'lucide-react'
import { AIConnectionsTab } from '@/components/settings/ai-connections-tab'
import { CodexConnectionsTab } from '@/components/settings/codex-connections-tab'

type SettingsTab = 'codex-connections' | 'ai-connections' | 'general'

interface SettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
    const [activeTab, setActiveTab] = useState<SettingsTab>('codex-connections')
    const t = useTranslations('settings')

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[980px] p-0 gap-0 max-h-[85vh] overflow-y-auto">
                <DialogHeader className="px-6 pt-6 pb-4">
                    <DialogTitle className="text-xl font-semibold">{t('title')}</DialogTitle>
                </DialogHeader>

                {/* Tabs */}
                <div className="border-b px-6">
                    <div className="flex gap-1">
                        <TabButton
                            active={activeTab === 'codex-connections'}
                            onClick={() => setActiveTab('codex-connections')}
                            icon={<Bot className="h-4 w-4" />}
                            label={t('tabs.codexConnections')}
                        />
                        <TabButton
                            active={activeTab === 'ai-connections'}
                            onClick={() => setActiveTab('ai-connections')}
                            icon={<Key className="h-4 w-4" />}
                            label={t('tabs.aiConnections')}
                        />
                        <TabButton
                            active={activeTab === 'general'}
                            onClick={() => setActiveTab('general')}
                            icon={<Settings className="h-4 w-4" />}
                            label={t('tabs.general')}
                        />
                    </div>
                </div>

                {/* Content */}
                <div className="px-6 py-6 min-h-[300px]">
                    {activeTab === 'codex-connections' && <CodexConnectionsTab />}
                    {activeTab === 'ai-connections' && <AIConnectionsTab />}
                    {activeTab === 'general' && <GeneralTab />}
                </div>
            </DialogContent>
        </Dialog>
    )
}

interface TabButtonProps {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium
                border-b-2 transition-colors
                ${active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                }
            `}
        >
            {icon}
            {label}
        </button>
    )
}

function GeneralTab() {
    const { locale, setLocale } = useSettingsStore()
    const t = useTranslations('settings.general')

    const languages: { value: Locale; label: string }[] = [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
    ]

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    {t('language')}
                </Label>
                <div className="flex gap-2">
                    {languages.map((lang) => (
                        <Button
                            key={lang.value}
                            variant={locale === lang.value ? 'default' : 'outline'}
                            onClick={() => setLocale(lang.value)}
                            className="flex-1"
                        >
                            {lang.label}
                        </Button>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                    {t('languageHint')}
                </p>
            </div>
        </div>
    )
}
