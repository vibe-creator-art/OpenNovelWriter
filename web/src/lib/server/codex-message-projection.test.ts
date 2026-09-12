import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codexMessageDetailVersion, projectCodexMessage, projectCodexRunEvent } from './codex-message-projection'
import { parseCodexSessionMessages, serializeCodexSession, serializeCodexSessionSummary, type CodexSessionMessage, type CodexSessionRecord } from './codex-session'
import { getLiveCodexMessages, registerLiveCodexMessages } from './codex-live-messages'

const tool: CodexSessionMessage = {
    id: 'tool-1', role: 'event', kind: 'tool', workStatus: 'completed',
    content: `opennovelwriter.query_story_state\n\n${'PRIVATE_RESULT'.repeat(30_000)}`,
    toolInput: 'PRIVATE_ARGUMENTS', createdAt: '2026-09-11T00:00:00.000Z',
}
const messages: CodexSessionMessage[] = [
    { id: 'user-1', role: 'user', content: 'Review the chapter', createdAt: tool.createdAt },
    tool,
    { id: 'reply-1', role: 'assistant', content: 'The chapter is ready.', attachments: ['/uploads/result.png'], createdAt: tool.createdAt },
]
const record = {
    id: 'session-1', category: 'general', title: 'Review', titleManuallyEdited: false,
    reviewLevel: 'user_review', modelId: 'gpt-6-astra', reasoningEffort: 'high', serviceTier: 'standard',
    composerMode: 'default', goalJson: null, codexThreadId: null, codexConnectionId: null,
    draftContent: 'Unsent draft', draftAttachmentsJson: '["/uploads/reference.png"]', draftArtifactsJson: '[]',
    status: 'idle', lastError: null, unreadCompletionAt: null, novelId: 'novel-1', ownerId: 'owner-1',
    createdAt: new Date(tool.createdAt), updatedAt: new Date(tool.createdAt), messagesJson: JSON.stringify(messages),
} satisfies CodexSessionRecord

test('list summaries contain previews and counts without any history or tool payload', () => {
    const summary = serializeCodexSessionSummary(record)
    assert.equal(summary.messageCount, 3)
    assert.equal(summary.previewTitle, 'Review the chapter')
    assert.equal(summary.previewText, 'The chapter is ready.')
    assert.equal('messages' in summary, false)
    assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 2_000)
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_RESULT|PRIVATE_ARGUMENTS/)
    assert.deepEqual(summary.draftAttachments, ['/uploads/reference.png'])
})

test('opening a session delivers replies and tool descriptors, keeping stored results intact', () => {
    const session = serializeCodexSession(record)
    assert.equal(session.historyLoaded, true)
    assert.equal(session.messages[0].content, messages[0].content)
    assert.equal(session.messages[2].content, messages[2].content)
    assert.deepEqual(session.messages[2].attachments, ['/uploads/result.png'])
    assert.equal(session.messages[1].content, 'opennovelwriter.query_story_state')
    assert.ok(session.messages[1].detailVersion)
    assert.ok(Buffer.byteLength(JSON.stringify(session)) < 3_000)
    assert.doesNotMatch(JSON.stringify(session), /PRIVATE_RESULT|PRIVATE_ARGUMENTS/)
    assert.equal(parseCodexSessionMessages(record.messagesJson)[1].content, tool.content)
})

test('live and persisted messages have the same detail version, which changes with the result', () => {
    assert.equal(codexMessageDetailVersion(tool), codexMessageDetailVersion(parseCodexSessionMessages(JSON.stringify([tool]))[0]))
    assert.notEqual(codexMessageDetailVersion(tool), codexMessageDetailVersion({ ...tool, content: `${tool.content}new` }))
    const event = { id: tool.id, kind: 'tool', workStatus: tool.workStatus, title: 'opennovelwriter.query_story_state', content: tool.content.split('\n\n')[1], toolInput: tool.toolInput, createdAt: tool.createdAt }
    const projected = projectCodexRunEvent(event)
    assert.equal(projected.detailVersion, projectCodexMessage(tool).detailVersion)
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_RESULT|PRIVATE_ARGUMENTS/)
})

test('scene edits retain their actionable hunks without the raw MCP envelope', () => {
    const result = { sceneId: 'scene-1', chapterId: 'chapter-1', actNumber: 1, applied: [{ id: 'edit-1', beforeText: 'Before', afterText: 'After' }], failedCount: 0 }
    const message = { ...tool, content: `opennovelwriter.edit_scene_content\n\n${JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }], extra: 'PRIVATE_RESULT' })}` }
    const projected = projectCodexMessage(message)
    assert.deepEqual(projected.sceneEdit, result)
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_RESULT|PRIVATE_ARGUMENTS/)
})

test('command, file, search and viewed-image details are deferred too', () => {
    for (const kind of ['command', 'file', 'web_search', 'image_view']) {
        const projected = projectCodexMessage({ ...tool, kind })
        assert.ok(projected.detailVersion)
        if (kind !== 'image_view') assert.doesNotMatch(projected.content, /PRIVATE_RESULT/)
    }
    const image = projectCodexMessage({ ...tool, kind: 'image_view', content: 'Viewed image\n\n/workspace/private/portrait.png' })
    assert.equal(image.content, 'Viewed image\n\nportrait.png')
})

test('replies, generated images and plan updates keep their display content', () => {
    for (const kind of ['image_generation', 'plan_update', 'reasoning']) {
        const event = { id: 'event-1', kind, title: 'Title', content: 'Content', attachments: ['/uploads/result.png'], createdAt: tool.createdAt }
        assert.equal(projectCodexRunEvent(event), event)
    }
})

test('live history is visible before persistence and removed when its run finishes', () => {
    const live = [...messages]
    const release = registerLiveCodexMessages('session-1', live)
    live.push({ ...tool, id: 'new-tool' })
    assert.equal(getLiveCodexMessages('session-1')?.at(-1)?.id, 'new-tool')
    const next = [tool]
    const releaseNext = registerLiveCodexMessages('session-1', next)
    release()
    assert.equal(getLiveCodexMessages('session-1'), next)
    releaseNext()
    assert.equal(getLiveCodexMessages('session-1'), undefined)
})
