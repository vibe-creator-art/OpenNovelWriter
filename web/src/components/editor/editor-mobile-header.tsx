'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft, PanelLeft, PanelRight, Settings, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type MobileEditorPane = 'left' | 'middle' | 'right'

type NavTabItem = {
    id: string
    label: string
    icon: ReactNode
}

type EditorMobileHeaderProps = {
    onBack: () => void
    onSettings: () => void
    pane: MobileEditorPane
    onPaneChange: (pane: MobileEditorPane) => void
    navTabs: NavTabItem[]
    activeTab: string
    onActiveTabChange: (id: string) => void
    writeTools?: ReactNode
}

export function EditorMobileHeader({
    onBack,
    onSettings,
    pane,
    onPaneChange,
    navTabs,
    activeTab,
    onActiveTabChange,
    writeTools,
}: EditorMobileHeaderProps) {
    const t = useTranslations('editor.mobile')

    const panes: { id: MobileEditorPane; icon: ReactNode; label: string }[] = [
        { id: 'left', icon: <PanelLeft className="h-4 w-4" />, label: t('paneLeft') },
        { id: 'middle', icon: <Square className="h-4 w-4" />, label: t('paneMiddle') },
        { id: 'right', icon: <PanelRight className="h-4 w-4" />, label: t('paneRight') },
    ]

    return (
        <header className="shrink-0 border-b bg-card md:hidden">
            <div className="flex items-center gap-1 px-2 h-12 pt-[max(0.25rem,env(safe-area-inset-top,0px))]">
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onBack} aria-label={t('back')}>
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onSettings} aria-label={t('settings')}>
                    <Settings className="h-4 w-4" />
                </Button>
                <div className="ml-auto flex rounded-md border p-0.5">
                    {panes.map((item) => (
                        <Button
                            key={item.id}
                            type="button"
                            variant={pane === item.id ? 'default' : 'ghost'}
                            size="icon"
                            className="h-9 w-9"
                            aria-label={item.label}
                            aria-pressed={pane === item.id}
                            onClick={() => onPaneChange(item.id)}
                        >
                            {item.icon}
                        </Button>
                    ))}
                </div>
            </div>
            {pane === 'middle' && (
                <div className="flex gap-1 overflow-x-auto px-2 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {navTabs.map((tab) => (
                        <Button
                            key={tab.id}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(
                                'h-9 shrink-0 gap-1 px-2.5',
                                activeTab === tab.id
                                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                    : '',
                            )}
                            onClick={() => onActiveTabChange(tab.id)}
                        >
                            {tab.icon}
                            {tab.label}
                        </Button>
                    ))}
                    {writeTools ? (
                        <div className="ml-1 flex shrink-0 items-center gap-1 border-l pl-2">
                            {writeTools}
                        </div>
                    ) : null}
                </div>
            )}
        </header>
    )
}
