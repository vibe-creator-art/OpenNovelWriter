'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { AuthPageShell, authInputClassName, authLinkClassName, authSubmitButtonClassName } from '@/components/auth-page-shell'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function ForgotPasswordPage() {
    const router = useRouter()
    const setAuth = useAuthStore((state) => state.setAuth)
    const t = useTranslations('auth.forgotPassword')
    const tRegister = useTranslations('auth.register')
    const [username, setUsername] = useState('')
    const [code, setCode] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [codeSent, setCodeSent] = useState(false)
    const [error, setError] = useState('')
    const [info, setInfo] = useState('')
    const [requesting, setRequesting] = useState(false)
    const [resetting, setResetting] = useState(false)

    const errorMessage = (err: unknown) => {
        const detail = err instanceof Error ? err.message : ''
        if (detail === 'user_not_found') return t('userNotFound')
        if (detail === 'invalid_code') return t('invalidCode')
        if (detail === 'expired_code') return t('expiredCode')
        if (detail === 'password_too_short') return tRegister('passwordTooShort')
        if (detail === 'missing_fields') return t('missingFields')
        return t('failed')
    }

    const requestCode = async () => {
        setError('')
        setInfo('')
        if (!username.trim()) {
            setError(t('missingFields'))
            return
        }
        setRequesting(true)
        try {
            await authApi.forgotPassword({ username: username.trim() })
            setCodeSent(true)
            setInfo(t('codeSent'))
        } catch (err) {
            setError(errorMessage(err))
        } finally {
            setRequesting(false)
        }
    }

    const handleReset = async (event: FormEvent) => {
        event.preventDefault()
        setError('')
        setInfo('')
        if (password !== confirmPassword) {
            setError(tRegister('passwordMismatch'))
            return
        }
        if (password.length < 6) {
            setError(tRegister('passwordTooShort'))
            return
        }
        setResetting(true)
        try {
            const response = await authApi.resetPassword({
                username: username.trim(),
                code: code.trim(),
                password,
            })
            setAuth(response.access_token, response.user)
            router.push('/bookshelf')
        } catch (err) {
            setError(errorMessage(err))
        } finally {
            setResetting(false)
        }
    }

    return (
        <AuthPageShell>
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center">{t('title')}</CardTitle>
                    <CardDescription className="text-center">{t('description')}</CardDescription>
                </CardHeader>
                <form onSubmit={handleReset}>
                    <CardContent className="space-y-4">
                        {error && (
                            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md dark:bg-red-950/30 dark:text-red-300">
                                {error}
                            </div>
                        )}
                        {info && !error && (
                            <div className="p-3 text-sm text-emerald-700 bg-emerald-50 rounded-md dark:bg-emerald-950/30 dark:text-emerald-300">
                                {info}
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
                        <Button type="button" variant="outline" className={authSubmitButtonClassName} disabled={requesting} onClick={() => void requestCode()}>
                            {requesting ? t('requestingCode') : t('requestCode')}
                        </Button>
                        {codeSent && (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="code">{t('code')}</Label>
                                    <Input
                                        id="code"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        placeholder={t('codePlaceholder')}
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
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
                                        placeholder={tRegister('passwordPlaceholder')}
                                        className={authInputClassName}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">{tRegister('confirmPassword')}</Label>
                                    <Input
                                        id="confirmPassword"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder={tRegister('confirmPasswordPlaceholder')}
                                        className={authInputClassName}
                                        required
                                    />
                                </div>
                            </>
                        )}
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4 pt-4">
                        {codeSent && (
                            <Button type="submit" className={authSubmitButtonClassName} disabled={resetting || code.length !== 6}>
                                {resetting ? t('submitting') : t('submit')}
                            </Button>
                        )}
                        <p className="text-sm text-center text-muted-foreground">
                            <Link href="/login" className={authLinkClassName}>
                                {t('backToLogin')}
                            </Link>
                        </p>
                    </CardFooter>
                </form>
            </Card>
        </AuthPageShell>
    )
}
