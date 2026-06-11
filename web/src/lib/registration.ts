function isFalsyEnvValue(value: string | undefined) {
    return value === 'false' || value === '0'
}

export const registrationEnabled = !isFalsyEnvValue(process.env.NEXT_PUBLIC_ALLOW_REGISTER)

export function isRegistrationEnabled() {
    if (process.env.ALLOW_REGISTER !== undefined) {
        return !isFalsyEnvValue(process.env.ALLOW_REGISTER)
    }

    return registrationEnabled
}
