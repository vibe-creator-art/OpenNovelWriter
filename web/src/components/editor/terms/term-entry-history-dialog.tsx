import { useTranslations } from 'next-intl'
import type { TermEntryHistoryItem } from '@/components/editor/terms/types'
import { RevisionHistoryDialog } from '@/components/editor/history/revision-history-dialog'

type TermEntryHistoryDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentValue: string
    historyItems: TermEntryHistoryItem[]
    onRestore: (value: string) => void
}

export function TermEntryHistoryDialog({
    open,
    onOpenChange,
    currentValue,
    historyItems,
    onRestore,
}: TermEntryHistoryDialogProps) {
    const t = useTranslations('editor')

    return (
        <RevisionHistoryDialog
            open={open}
            onOpenChange={onOpenChange}
            currentValue={currentValue}
            historyItems={historyItems}
            onRestore={onRestore}
            title={t('terms.panel.history.title')}
            restoreLabel={t('terms.panel.history.restore')}
            closeLabel={t('terms.panel.history.close')}
            emptyLabel={t('terms.panel.history.empty')}
            editedByLabel={t('terms.panel.history.editedByYou')}
        />
    )
}
