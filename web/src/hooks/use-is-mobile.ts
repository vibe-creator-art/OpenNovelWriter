'use client'

import { useSyncExternalStore } from 'react'

/** Phones keep the mobile layout at every width; other devices switch at 768px. */
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
    return document.documentElement.hasAttribute('data-phone-layout')
        || window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

function getServerSnapshot() {
    return false
}

export function useIsMobile() {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
