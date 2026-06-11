'use client'

import { useEffect, useState } from 'react'
import { NextIntlClientProvider, AbstractIntlMessages } from 'next-intl'
import { useSettingsStore } from '@/lib/store'

interface I18nProviderProps {
    children: React.ReactNode
}

export function I18nProvider({ children }: I18nProviderProps) {
    const { locale, isHydrated } = useSettingsStore()
    const [messages, setMessages] = useState<AbstractIntlMessages | null>(null)

    useEffect(() => {
        // Load messages for current locale
        const loadMessages = async () => {
            try {
                const msgs = await import(`@/messages/${locale}.json`)
                setMessages(msgs.default)
            } catch (error) {
                console.error('Failed to load messages:', error)
                // Fallback to Chinese
                const fallback = await import('@/messages/zh.json')
                setMessages(fallback.default)
            }
        }

        if (isHydrated) {
            loadMessages()
        }
    }, [locale, isHydrated])

    // Show nothing while hydrating to avoid flash
    if (!isHydrated || !messages) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-lg">Loading...</div>
            </div>
        )
    }

    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
        </NextIntlClientProvider>
    )
}
