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
}) {
    const { disabled = false, onError } = options
    const [items, setItems] = useState<PendingImageAttachment[]>([])
    const itemsRef = useRef(items)

    useEffect(() => {
        itemsRef.current = items
    }, [items])

    // Revoke preview object URLs when the component unmounts.
    useEffect(() => {
        return () => {
            for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
        }
    }, [])

    const addFiles = useCallback(
        (files: File[]) => {
            if (files.length === 0) return
            if (disabled) {
                onError?.('disabled')
                return
            }

            for (const file of files) {
                if (!ATTACHMENT_IMAGE_TYPES.has(file.type)) {
                    onError?.('type')
                    continue
                }
                if (file.size > ATTACHMENT_MAX_SIZE) {
                    onError?.('size')
                    continue
                }
                if (itemsRef.current.length >= ATTACHMENT_MAX_COUNT) {
                    onError?.('count')
                    return
                }

                const item: PendingImageAttachment = {
                    id: createAttachmentId(),
                    status: 'uploading',
                    url: null,
                    previewUrl: URL.createObjectURL(file),
                }
                itemsRef.current = [...itemsRef.current, item]
                setItems(itemsRef.current)

                void uploadApi
                    .image(file)
                    .then((result) => {
                        setItems((current) =>
                            current.map((entry) =>
                                entry.id === item.id ? { ...entry, status: 'ready', url: result.url } : entry
                            )
                        )
                    })
                    .catch(() => {
                        URL.revokeObjectURL(item.previewUrl)
                        setItems((current) => current.filter((entry) => entry.id !== item.id))
                        onError?.('upload')
                    })
            }
        },
        [disabled, onError]
    )

    const removeItem = useCallback((id: string) => {
        setItems((current) => {
            const item = current.find((entry) => entry.id === id)
            if (item) URL.revokeObjectURL(item.previewUrl)
            return current.filter((entry) => entry.id !== id)
        })
    }, [])

    const clear = useCallback(() => {
        setItems((current) => {
            for (const item of current) URL.revokeObjectURL(item.previewUrl)
            return []
        })
    }, [])

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
