'use client'

export const ONW_WRITE_JUMP_EVENT = 'onw:write-jump'

export type OnwWriteJumpEventSource = 'sidebar' | 'scrollbar'

export type OnwWriteJumpEventDetail = {
    chapterId: string
    source: OnwWriteJumpEventSource
}

export function dispatchWriteJump(detail: OnwWriteJumpEventDetail) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<OnwWriteJumpEventDetail>(ONW_WRITE_JUMP_EVENT, { detail }))
}

