import { isAstraCodexModelId } from '@/lib/codex-config'
import { sanitizeThirdPartyResponsesRequest } from './responses-sanitize'
import { CodexToolContext, normalizeCodexResponsesTools } from './tool-context'

export function prepareCodexResponsesRequest(body: Record<string, unknown>) {
    if (typeof body.model === 'string' && isAstraCodexModelId(body.model)) {
        return { body, context: null }
    }
    return {
        body: sanitizeThirdPartyResponsesRequest(normalizeCodexResponsesTools(body)),
        context: CodexToolContext.fromRequest(body),
    }
}
