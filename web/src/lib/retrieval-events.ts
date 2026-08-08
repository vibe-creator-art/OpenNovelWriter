'use client'

import type { RetrievalStatusResponse } from '@/lib/api'

export const RETRIEVAL_STATUS_CHANGED_EVENT = 'onw:retrieval-status-changed'

export type RetrievalStatusChangedDetail = {
    novelId: string
    status: RetrievalStatusResponse
}

export function dispatchRetrievalStatusChanged(detail: RetrievalStatusChangedDetail) {
    window.dispatchEvent(new CustomEvent<RetrievalStatusChangedDetail>(RETRIEVAL_STATUS_CHANGED_EVENT, { detail }))
}
