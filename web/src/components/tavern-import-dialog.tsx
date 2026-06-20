'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TavernMacroOptions } from '@/lib/sillytavern-import'

type TavernImportDialogProps = {
    open: boolean
    cardName: string
    hasCharMacro: boolean
    hasUserMacro: boolean
    onConfirm: (options: TavernMacroOptions) => void
    onOpenChange: (open: boolean) => void
}

export function TavernImportDialog({
    open,
    cardName,
    hasCharMacro,
    hasUserMacro,
    onConfirm,
    onOpenChange,
}: TavernImportDialogProps) {
    const t = useTranslations('bookshelf.tavernImport')
    const tCommon = useTranslations('common')

    // Fresh state per card: the parent remounts this dialog via `key`.
    const [charOption, setCharOption] = useState<'replace' | 'keep'>('replace')
    const [userOption, setUserOption] = useState<'replace' | 'keep'>('keep')
    const [userName, setUserName] = useState('')

    const confirmDisabled = userOption === 'replace' && !userName.trim()

    const handleConfirm = () => {
        onConfirm({
            char: hasCharMacro ? charOption : 'keep',
            user: hasUserMacro ? userOption : 'keep',
            userName: userName.trim() || undefined,
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    <DialogDescription>{t('dialogDescription', { name: cardName })}</DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    {hasCharMacro && (
                        <fieldset className="space-y-2">
                            <legend className="mb-1 text-sm font-medium">{t('charMacroLabel')}</legend>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="tavern-char-macro"
                                    className="mt-1"
                                    checked={charOption === 'replace'}
                                    onChange={() => setCharOption('replace')}
                                />
                                <span>{t('charReplace', { name: cardName })}</span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="tavern-char-macro"
                                    className="mt-1"
                                    checked={charOption === 'keep'}
                                    onChange={() => setCharOption('keep')}
                                />
                                <span>{t('charKeep')}</span>
                            </label>
                        </fieldset>
                    )}

                    {hasUserMacro && (
                        <fieldset className="space-y-2">
                            <legend className="mb-1 text-sm font-medium">{t('userMacroLabel')}</legend>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="tavern-user-macro"
                                    className="mt-1"
                                    checked={userOption === 'keep'}
                                    onChange={() => setUserOption('keep')}
                                />
                                <span>{t('userKeep')}</span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="tavern-user-macro"
                                    className="mt-1"
                                    checked={userOption === 'replace'}
                                    onChange={() => setUserOption('replace')}
                                />
                                <span>{t('userReplace')}</span>
                            </label>
                            {userOption === 'replace' && (
                                <Input
                                    autoFocus
                                    value={userName}
                                    onChange={(event) => setUserName(event.target.value)}
                                    placeholder={t('userNamePlaceholder')}
                                    className="ml-6 w-[calc(100%-1.5rem)]"
                                />
                            )}
                        </fieldset>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {tCommon('cancel')}
                    </Button>
                    <Button onClick={handleConfirm} disabled={confirmDisabled}>
                        {t('confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
