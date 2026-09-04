'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { AuthPageShell, authInputClassName, authLinkClassName, authSubmitButtonClassName } from '@/components/auth-page-shell'
import { authApi } from '@/lib/api'
import { registrationEnabled } from '@/lib/registration'
import { useAuthStore } from '@/lib/store'

export default function LoginPage() {
    const router = useRouter()
    const setAuth = useAuthStore((state) => state.setAuth)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const t = useTranslations('auth.login')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const response = await authApi.login({ username, password })
            setAuth(response.access_token, response.user)
            router.push('/bookshelf')
        } catch {
            setError(t('failed'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthPageShell>
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center">{t('title')}</CardTitle>
                    <CardDescription className="text-center">
                        {t('description')}
                    </CardDescription>
                </CardHeader>
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
                                className={authInputClassName}
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
                                className={authInputClassName}
                                required
                            />
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4 pt-4">
                        <Button type="submit" className={authSubmitButtonClassName} disabled={loading}>
                            {loading ? t('submitting') : t('submit')}
                        </Button>
                        <p className="text-sm text-center text-muted-foreground">
                            {registrationEnabled ? (
                                <>
                                    {t('noAccount')}{' '}
                                    <Link href="/register" className={authLinkClassName}>
                                        {t('register')}
                                    </Link>
                                    <span className="px-2">·</span>
                                </>
                            ) : null}
                            <Link href="/forgot-password" className={authLinkClassName}>
                                {t('forgotPassword')}
                            </Link>
                        </p>
                    </CardFooter>
                </form>
            </Card>
        </AuthPageShell>
    )
}
