'use client'

import { useTranslations } from 'next-intl'
import { RevisionHistoryDialog } from '@/components/editor/history/revision-history-dialog'
import { htmlToText } from '@/lib/html-to-text'
import type { RevisionHistoryItem } from '@/lib/revision-history'

type SnippetHistoryDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentValue: string
    historyItems: RevisionHistoryItem[]
    onRestore: (value: string) => void
}

export function SnippetHistoryDialog({
    open,
    onOpenChange,
    currentValue,
    historyItems,
    onRestore,
}: SnippetHistoryDialogProps) {
    const t = useTranslations('editor')

    return (
        <RevisionHistoryDialog
            open={open}
            onOpenChange={onOpenChange}
            currentValue={currentValue}
            historyItems={historyItems}
            onRestore={onRestore}
            title={t('snippets.history.title')}
            restoreLabel={t('snippets.history.restore')}
            closeLabel={t('snippets.history.close')}
            emptyLabel={t('snippets.history.empty')}
            editedByLabel={t('snippets.history.editedByYou')}
            previewTransform={htmlToText}
        />
    )
}
