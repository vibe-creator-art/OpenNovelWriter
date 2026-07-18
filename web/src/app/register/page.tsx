'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { registrationEnabled } from '@/lib/registration'
import { useAuthStore } from '@/lib/store'

export default function RegisterPage() {
    const router = useRouter()
    const setAuth = useAuthStore((state) => state.setAuth)
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const t = useTranslations('auth.register')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        if (password !== confirmPassword) {
            setError(t('passwordMismatch'))
            return
        }

        if (password.length < 6) {
            setError(t('passwordTooShort'))
            return
        }

        setLoading(true)

        try {
            const response = await authApi.register({ username, email, password })
            setAuth(response.access_token, response.user)
            router.push('/bookshelf')
        } catch (err) {
            setError(err instanceof Error ? err.message : t('failed'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center">{t('title')}</CardTitle>
                    <CardDescription className="text-center">
                        {registrationEnabled ? t('description') : t('closed')}
                    </CardDescription>
                </CardHeader>
                {registrationEnabled ? (
                    <form onSubmit={handleSubmit}>
                        <CardContent className="space-y-4">
                            {error && (
                                <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md dark:bg-red-950/30 dark:text-red-300">
                                    {error}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="username">{t('username')}</Label>
                                <Input
                                    id="username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder={t('usernamePlaceholder')}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">{t('email')}</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={t('emailPlaceholder')}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">{t('password')}</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t('passwordPlaceholder')}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder={t('confirmPasswordPlaceholder')}
                                    required
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col space-y-4 pt-3">
                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? t('submitting') : t('submit')}
                            </Button>
                            <p className="text-sm text-center text-muted-foreground">
                                {t('hasAccount')}{' '}
                                <Link href="/login" className="text-primary hover:underline">
                                    {t('login')}
                                </Link>
                            </p>
                        </CardFooter>
                    </form>
                ) : (
                    <CardFooter className="flex flex-col space-y-4 pt-3">
                        <div className="w-full rounded-md bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
                            {t('closed')}
                        </div>
                        <Link href="/login" className="text-sm text-primary hover:underline">
                            {t('login')}
                        </Link>
                    </CardFooter>
                )}
            </Card>
        </div>
    )
}
