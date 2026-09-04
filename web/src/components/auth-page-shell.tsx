import type { ReactNode } from 'react'

/** Full-width submit / outline actions on auth cards. `md+` matches the old h-9 text-sm buttons. */
export const authSubmitButtonClassName = 'h-11 w-full text-base md:h-9 md:text-sm'

/** Taller fields on the phone; `md+` stays the default h-9. */
export const authInputClassName = 'h-11 md:h-9'

/** 44px tap target on the phone; inline link on `md+`. */
export const authLinkClassName =
    'inline-flex min-h-11 items-center text-primary hover:underline md:inline md:min-h-0'

export function AuthPageShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-dvh overflow-y-auto bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900">
            <div className="onw-auth-frame">
                {children}
            </div>
        </div>
    )
}
