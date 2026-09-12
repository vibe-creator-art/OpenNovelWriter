import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomicallyIfChanged } from '@/lib/server/atomic-file-write'

function codexQuestionInstructions(enabled: boolean, asyncQuestions: boolean) {
    if (!enabled) return 'Clarification questions are disabled for this novel in every mode, including Plan mode. Do not use request_user_input or request_user_input_async, and do not ask clarification questions in chat. Proceed using reasonable assumptions and state material assumptions. If essential information is missing, explain the limitation without inventing it. This preference does not change permission or approval requirements.'
    const instructions = 'Clarification questions are enabled for this novel in both Default and Plan modes. Ask only when the answer would materially help.'
    return asyncQuestions
        ? `${instructions} Use request_user_input_async and continue independent work while awaiting a reply.`
        : `${instructions} Use request_user_input and wait for its response. If the user skips the question, continue with reasonable assumptions.`
}

export async function prepareCodexQuestionPolicy(input: {
    enabled: boolean
    modelId: string
    codexHome: string
    workspace: string
    config: Record<string, unknown>
}) {
    const source = typeof input.config.model_catalog_json === 'string'
        ? path.resolve(input.codexHome, input.config.model_catalog_json)
        : path.join(input.codexHome, 'models_cache.json')
    const catalog = JSON.parse(await fs.readFile(source, 'utf8')) as { models: Array<Record<string, unknown>> }
    const model = catalog.models.find((entry) => entry.slug === input.modelId)
    const asyncQuestions = Array.isArray(model?.experimental_supported_tools)
        && model.experimental_supported_tools.includes('send_user_message_async')
    const synchronousQuestions = input.enabled && !asyncQuestions
    const config: Record<string, unknown> = {
        'features.default_mode_request_user_input': synchronousQuestions,
        'tools.experimental_request_user_input.enabled': synchronousQuestions,
    }
    if (!input.enabled) {
        for (const model of catalog.models) {
            if (Array.isArray(model.experimental_supported_tools)) {
                model.experimental_supported_tools = model.experimental_supported_tools.filter((tool) => tool !== 'send_user_message_async')
            }
        }
        const target = path.join(input.workspace, '.codex-models-without-questions.json')
        await writeFileAtomicallyIfChanged(target, `${JSON.stringify({ models: catalog.models })}\n`, { mode: 0o600 })
        config.model_catalog_json = target
    }
    const originalInstructions = typeof input.config.developer_instructions === 'string' ? input.config.developer_instructions : ''
    return {
        config,
        developerInstructions: [originalInstructions, codexQuestionInstructions(input.enabled, asyncQuestions)].filter(Boolean).join('\n\n'),
    }
}
