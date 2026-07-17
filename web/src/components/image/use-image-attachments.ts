'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadApi } from '@/lib/api'

/**
 * Composer image attachments shared by the chat and Codex panels.
 *
 * Files arrive via paste / drag-drop / file picker, upload immediately through
 * `uploadApi.image` (each becomes a managed `/uploads/...` URL), and show as a
 * pending strip above the input until the message is sent. Only formats every
 * supported vision model accepts are allowed — notably no GIF.
 */

export const ATTACHMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024 // matches /api/upload/image
export const ATTACHMENT_MAX_COUNT = 6

export type ImageAttachmentError = 'type' | 'size' | 'count' | 'disabled' | 'upload'

export type PendingImageAttachment = {
    id: string
    status: 'uploading' | 'ready'
    /** Managed `/uploads/...` URL once the upload completes. */
    url: string | null
    /** Object URL for instant local preview. */
    previewUrl: string
}

function createAttachmentId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `attachment_${crypto.randomUUID()}`
    }
    return `attachment_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function extractImageFiles(dataTransfer: DataTransfer | null): File[] {
    if (!dataTransfer) return []
    const files: File[] = []
    for (const file of Array.from(dataTransfer.files)) {
        if (file.type.startsWith('image/')) files.push(file)
    }
    return files
}

export function useImageAttachments(options: {
    disabled?: boolean
    onError?: (error: ImageAttachmentError) => void
    items?: PendingImageAttachment[]
    scopeId?: string | null
    onItemsChange?: (
        scopeId: string,
        updater: (current: PendingImageAttachment[]) => PendingImageAttachment[]
    ) => PendingImageAttachment[]
}) {
    const { disabled = false, onError, items: controlledItems, scopeId = null, onItemsChange } = options
    const [localItems, setLocalItems] = useState<PendingImageAttachment[]>([])
    const items = controlledItems ?? localItems
    const controlled = controlledItems !== undefined && onItemsChange !== undefined
    const itemsRef = useRef(items)

    useEffect(() => {
        itemsRef.current = items
    }, [items])

    const updateItems = useCallback(
        (
            updater: (current: PendingImageAttachment[]) => PendingImageAttachment[],
            targetScopeId: string | null = scopeId
        ) => {
            if (controlled) {
                if (!targetScopeId) return
                const nextItems = onItemsChange(targetScopeId, updater)
                if (targetScopeId === scopeId) itemsRef.current = nextItems
            } else {
                setLocalItems((current) => {
                    const nextItems = updater(current)
                    itemsRef.current = nextItems
                    return nextItems
                })
            }
        },
        [controlled, onItemsChange, scopeId]
    )

    // Locally owned previews end with the component. Controlled previews belong to their external
    // composer store and remain alive while the user switches panels or sessions.
    useEffect(() => {
        if (controlled) return
        return () => {
            for (const item of itemsRef.current) {
                if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
            }
        }
    }, [controlled])

    const addFiles = useCallback(
        (files: File[], scopeIdOverride?: string) => {
            if (files.length === 0) return
            if (disabled) {
                onError?.('disabled')
                return
            }

            const targetScopeId = scopeIdOverride ?? scopeId
            let pendingCount = itemsRef.current.length
            for (const file of files) {
                if (!ATTACHMENT_IMAGE_TYPES.has(file.type)) {
                    onError?.('type')
                    continue
                }
                if (file.size > ATTACHMENT_MAX_SIZE) {
                    onError?.('size')
                    continue
                }
                if (pendingCount >= ATTACHMENT_MAX_COUNT) {
                    onError?.('count')
                    return
                }

                const item: PendingImageAttachment = {
                    id: createAttachmentId(),
                    status: 'uploading',
                    url: null,
                    previewUrl: URL.createObjectURL(file),
                }
                pendingCount += 1
                updateItems((current) => [...current, item], targetScopeId)

                void uploadApi
                    .image(file)
                    .then((result) => {
                        updateItems((current) =>
                            current.map((entry) =>
                                entry.id === item.id ? { ...entry, status: 'ready', url: result.url } : entry
                            ),
                            targetScopeId
                        )
                    })
                    .catch(() => {
                        URL.revokeObjectURL(item.previewUrl)
                        updateItems((current) => current.filter((entry) => entry.id !== item.id), targetScopeId)
                        onError?.('upload')
                    })
            }
        },
        [disabled, onError, scopeId, updateItems]
    )

    const removeItem = useCallback((id: string) => {
        updateItems((current) => {
            const item = current.find((entry) => entry.id === id)
            if (item?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
            return current.filter((entry) => entry.id !== id)
        })
    }, [updateItems])

    const clear = useCallback(() => {
        updateItems((current) => {
            for (const item of current) {
                if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
            }
            return []
        })
    }, [updateItems])

    const handlePaste = useCallback(
        (event: { clipboardData: DataTransfer | null; preventDefault: () => void }) => {
            const files = extractImageFiles(event.clipboardData)
            if (files.length === 0) return
            event.preventDefault()
            addFiles(files)
        },
        [addFiles]
    )

    const handleDrop = useCallback(
        (event: { dataTransfer: DataTransfer | null; preventDefault: () => void; stopPropagation: () => void }) => {
            const files = extractImageFiles(event.dataTransfer)
            if (files.length === 0) return
            event.preventDefault()
            event.stopPropagation()
            addFiles(files)
        },
        [addFiles]
    )

    const handleDragOver = useCallback(
        (event: { dataTransfer: DataTransfer | null; preventDefault: () => void }) => {
            if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return
            event.preventDefault()
        },
        []
    )

    const readyUrls = items
        .filter((item): item is PendingImageAttachment & { url: string } => item.status === 'ready' && item.url !== null)
        .map((item) => item.url)
    const uploading = items.some((item) => item.status === 'uploading')

    return {
        items,
        readyUrls,
        uploading,
        addFiles,
        removeItem,
        clear,
        handlePaste,
        handleDrop,
        handleDragOver,
    }
}
