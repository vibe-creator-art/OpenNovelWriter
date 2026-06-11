'use client'

import { useTranslations } from 'next-intl'

export function LeftPanelSettings() {
    const t = useTranslations('editor')

    return (
        <div className="p-4 text-sm text-muted-foreground">
            {t('sidebar.settingsPlaceholder')}
        </div>
    )
}
