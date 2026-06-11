'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
    Bot,
    Eye,
    FolderOpen,
    MessageSquare,
    PanelRightClose,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useInfoPanelStore } from '@/components/editor/info-panel-store'
import { RightPanelPreview } from '@/components/editor/right-panel-preview'
import { RightPanelChat } from '@/components/editor/right-panel-chat'
import { RightPanelCodex } from '@/components/editor/right-panel-codex'
import { RightPanelMaterials } from '@/components/editor/right-panel-materials'
import { type WriteNavTarget } from '@/components/editor/plan-view'

interface RightPanelProps {
    novelId?: string
    width: number
    onClose: () => void
    onWidthChange: (width: number) => void
    onNavigateToWrite?: (target: WriteNavTarget) => void
}

export function RightPanel({
    novelId,
    width,
    onClose,
    onWidthChange,
    onNavigateToWrite,
}: RightPanelProps) {
    const t = useTranslations('editor')
    const isResizingRight = useRef(false)
    const activeTab = useInfoPanelStore((s) => s.activeTab)
    const setActiveTab = useInfoPanelStore((s) => s.setActiveTab)
    const isCompact = width < 260
    const [chatTweakOpen, setChatTweakOpen] = useState(false)

    const handleStartResize = (e: React.MouseEvent) => {
        e.preventDefault()
        isResizingRight.current = true
        const startX = e.clientX
        const startWidth = width

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isResizingRight.current) return
            const delta = startX - moveEvent.clientX // Reversed because right sidebar
            const newWidth = Math.max(180, Math.min(520, startWidth + delta))
            onWidthChange(newWidth)
        }

        const handleMouseUp = () => {
            isResizingRight.current = false
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    return (
        <>
            {/* Right resize handle */}
            <div
                className="w-1 hover:bg-primary/20 cursor-col-resize shrink-0 transition-colors"
                onMouseDown={handleStartResize}
            />

            {/* Right sidebar */}
	            <aside
	                className="bg-background/80 border-l flex flex-col shrink-0"
	                style={{ width }}
	            >
	                <div className="border-b">
	                    <div className="grid grid-cols-4">
                        <Button
                            variant="ghost"
                            size="sm"
	                            className={cn(
	                                'w-full rounded-none text-xs gap-1 px-1 border-b-2',
	                                activeTab === 'preview' ? 'border-primary' : 'border-transparent'
	                            )}
	                            onClick={() => setActiveTab('preview')}
	                            title={t('infoPanel.tabs.preview')}
	                        >
	                            <Eye className="h-4 w-4" />
	                            {!isCompact && <span className="truncate">{t('infoPanel.tabs.preview')}</span>}
	                        </Button>

	                        <Button
	                            variant="ghost"
	                            size="sm"
	                            className={cn(
	                                'w-full rounded-none text-xs gap-1 px-1 border-b-2',
	                                activeTab === 'codex' ? 'border-primary' : 'border-transparent'
	                            )}
	                            onClick={() => setActiveTab('codex')}
	                            title={t('infoPanel.tabs.codex')}
	                        >
	                            <Bot className="h-4 w-4" />
	                            {!isCompact && <span className="truncate">{t('infoPanel.tabs.codex')}</span>}
	                        </Button>

	                        <Button
	                            variant="ghost"
	                            size="sm"
	                            className={cn(
	                                'w-full rounded-none text-xs gap-1 px-1 border-b-2',
	                                activeTab === 'chat' ? 'border-primary' : 'border-transparent'
	                            )}
	                            onClick={() => setActiveTab('chat')}
	                            title={t('infoPanel.tabs.chat')}
	                        >
	                            <MessageSquare className="h-4 w-4" />
	                            {!isCompact && <span className="truncate">{t('infoPanel.tabs.chat')}</span>}
                        </Button>

	                        <Button
	                            variant="ghost"
	                            size="sm"
	                            className={cn(
	                                'w-full rounded-none text-xs gap-1 px-1 border-b-2',
	                                activeTab === 'materials' ? 'border-primary' : 'border-transparent'
	                            )}
	                            onClick={() => setActiveTab('materials')}
	                            title={t('infoPanel.tabs.materials')}
	                        >
	                            <FolderOpen className="h-4 w-4" />
	                            {!isCompact && <span className="truncate">{t('infoPanel.tabs.materials')}</span>}
	                        </Button>

	                        <Button
	                            variant="ghost"
	                            size="icon-sm"
	                            className="w-full rounded-none"
	                            onClick={onClose}
	                            title={t('infoPanel.hide')}
	                            aria-label={t('infoPanel.hide')}
	                        >
	                            <PanelRightClose className="h-4 w-4" />
	                        </Button>

	                        <div className="h-8 w-full" />
	                        <div className="h-8 w-full" />
	                        <div className="h-8 w-full" />
	                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                    {activeTab === 'preview' ? (
                        <RightPanelPreview />
                    ) : activeTab === 'codex' ? (
                        <RightPanelCodex novelId={novelId} onNavigateToWrite={onNavigateToWrite} />
                    ) : activeTab === 'materials' ? (
                        <RightPanelMaterials novelId={novelId} />
                    ) : (
                        <RightPanelChat
                            novelId={novelId}
                            tweakOpen={chatTweakOpen}
                            onTweakOpenChange={setChatTweakOpen}
                        />
                    )}
                </div>
            </aside>
        </>
    )
}
