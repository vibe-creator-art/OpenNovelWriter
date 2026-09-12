import type { CodexRunEvent } from '@/lib/api'
import { createHash } from 'node:crypto'
import type { CodexSessionMessage } from '@/lib/server/codex-session'
import { getWorkEventBody, getWorkEventTitle } from '@/lib/codex-work-events'
import { findSceneEditPayload } from '@/lib/codex-scene-edit'

export function codexMessageDetailVersion(message: CodexSessionMessage) {
    return createHash('sha256').update(JSON.stringify([message.id, message.content, message.toolInput ?? null, message.workStatus ?? null, message.attachments ?? []])).digest('hex')
}

export function projectCodexMessage(message: CodexSessionMessage): CodexSessionMessage {
    if (message.role !== 'event' || !['tool', 'command', 'file', 'web_search', 'image_view'].includes(message.kind ?? '')) return message
    const title = getWorkEventTitle(message.content)
    const sceneEdit = message.kind === 'tool' && title.includes('edit_scene_content')
        ? findSceneEditPayload(getWorkEventBody(message.content))
        : null
    return {
        id: message.id,
        role: message.role,
        kind: message.kind,
        workStatus: message.workStatus,
        content: message.kind === 'image_view'
            ? `${title.slice(0, 240)}\n\n${getWorkEventBody(message.content).split(/[/\\]/u).at(-1) ?? ''}`
            : title.slice(0, 240),
        createdAt: message.createdAt,
        contextWindow: message.contextWindow,
        detailVersion: codexMessageDetailVersion(message),
        ...(sceneEdit ? { sceneEdit } : {}),
    }
}

export function projectCodexRunEvent(event: CodexRunEvent): CodexRunEvent {
    const message: CodexSessionMessage = {
        ...event,
        role: 'event',
        content: [event.title, event.content].filter(Boolean).join('\n\n'),
    }
    const projected = projectCodexMessage(message)
    if (projected === message) return event
    const separator = projected.content.indexOf('\n\n')
    return {
        id: event.id,
        kind: event.kind,
        title: separator < 0 ? projected.content : projected.content.slice(0, separator),
        content: separator < 0 ? '' : projected.content.slice(separator + 2),
        workStatus: projected.workStatus,
        detailVersion: projected.detailVersion,
        sceneEdit: projected.sceneEdit,
        createdAt: event.createdAt,
    }
}
