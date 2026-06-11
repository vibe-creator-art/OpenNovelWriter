'use client'

import { useTranslations } from 'next-intl'
import { RevisionHistoryDialog } from '@/components/editor/history/revision-history-dialog'
import type { RevisionHistoryItem } from '@/lib/revision-history'

type PromptHistoryDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentValue: string
    historyItems: RevisionHistoryItem[]
    onRestore: (value: string) => void
}

export function PromptHistoryDialog({
    open,
    onOpenChange,
    currentValue,
    historyItems,
    onRestore,
}: PromptHistoryDialogProps) {
    const t = useTranslations('prompts')

    return (
        <RevisionHistoryDialog
            open={open}
            onOpenChange={onOpenChange}
            currentValue={currentValue}
            historyItems={historyItems}
            onRestore={onRestore}
            title={t('history.title')}
            restoreLabel={t('history.restore')}
            closeLabel={t('history.close')}
            emptyLabel={t('history.empty')}
            editedByLabel={t('history.editedByYou')}
        />
    )
}

