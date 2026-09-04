'use client'

import { useSyncExternalStore } from 'react'

/** Matches Tailwind `md` (768px). `< md` is the phone companion shell. */
export const MOBILE_BREAKPOINT_PX = 768
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`

function subscribe(onChange: () => void) {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY)
    media.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
        media.removeEventListener('change', onChange)
        window.removeEventListener('resize', onChange)
    }
}

function getSnapshot() {
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

function getServerSnapshot() {
    return false
}

/**
 * Phone vs desktop shell. SSR and the first client paint assume desktop so
 * `md+` layout never hydrates into the mobile chrome.
 */
export function useIsMobile() {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
