export type PromptInputType = 'custom' | 'content_selection' | 'checkbox'

export type ContentSelectionTreatAs = 'full_text' | 'summary'

export type ContentSelectionTarget =
    | { kind: 'full_novel' }
    | { kind: 'act'; actNumber: number }
    | { kind: 'chapter'; chapterId: string }
    | { kind: 'act_outline'; actNumber: number }
    | { kind: 'chapter_outline'; chapterId: string }
    | { kind: 'scene'; sceneId: string }
    | { kind: 'snippet'; snippetId: string }
    | { kind: 'term'; termId: string }
    | { kind: 'label'; labelId: string }
    | { kind: 'term_tag'; tag: string }

export interface PromptDropdownOption {
    id: string
    label: string
    description: string | null
    content: string
    color: string | null
}

export interface PromptCustomInputDefinition {
    id: string
    type: 'custom'
    name: string
    description: string | null
    required: boolean
    collapsed: boolean
    custom: {
        text: { enabled: boolean; placeholder: string }
        dropdown: {
            enabled: boolean
            allowMultiple: boolean
            display: 'menu' | 'chips'
            options: PromptDropdownOption[]
        }
        defaultContent: {
            dropdownOptionIds: string[]
            text: string
        }
    }
}

export interface PromptContentSelectionInputDefinition {
    id: string
    type: 'content_selection'
    name: string
    description: string | null
    required: boolean
    collapsed: boolean
    contentSelection: {
        allowMultiple: boolean
        displayName: string
        options: {
            fullNovel: { enabled: boolean; treatAs: ContentSelectionTreatAs }
            act: { enabled: boolean; treatAs: ContentSelectionTreatAs }
            chapter: { enabled: boolean; treatAs: ContentSelectionTreatAs }
            scene: { enabled: boolean; treatAs: ContentSelectionTreatAs }
            snippet: { enabled: boolean }
            term: {
                enabled: boolean
                allowedTypes: {
                    characters: boolean
                    locations: boolean
                    items: boolean
                    lore: boolean
                    others: boolean
                }
            }
            label: { enabled: boolean; actTreatAs: ContentSelectionTreatAs; sceneTreatAs: ContentSelectionTreatAs }
            outline: {
                enabled: boolean
                act: { enabled: boolean; treatAs: ContentSelectionTreatAs }
                chapter: { enabled: boolean; treatAs: ContentSelectionTreatAs }
            }
            termTag: { enabled: boolean }
        }
    }
}

export interface PromptCheckboxInputDefinition {
    id: string
    type: 'checkbox'
    name: string
    description: string | null
    required: boolean
    collapsed: boolean
    checkbox: {
        displayName: string
        defaultChecked: boolean
    }
}

export type PromptInputDefinition =
    | PromptCustomInputDefinition
    | PromptContentSelectionInputDefinition
    | PromptCheckboxInputDefinition

export type PromptInputValue =
    | { kind: 'custom'; dropdownOptionIds: string[]; text: string }
    | { kind: 'content_selection'; selections: ContentSelectionTarget[] }
    | { kind: 'checkbox'; checked: boolean }

function createId(prefix: string) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`
    }
    return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

export function createPromptInput(): PromptInputDefinition {
    return {
        id: createId('in'),
        type: 'custom',
        name: '',
        description: null,
        required: false,
        collapsed: false,
        custom: {
            text: { enabled: true, placeholder: '' },
            dropdown: {
                enabled: false,
                allowMultiple: true,
                display: 'chips',
                options: [],
            },
            defaultContent: {
                dropdownOptionIds: [],
                text: '',
            },
        },
    }
}

export function createPromptContentSelectionInput(): PromptContentSelectionInputDefinition {
    return {
        id: createId('in'),
        type: 'content_selection',
        name: '',
        description: null,
        required: false,
        collapsed: false,
        contentSelection: {
            allowMultiple: true,
            displayName: '',
            options: {
                fullNovel: { enabled: true, treatAs: 'summary' },
                act: { enabled: true, treatAs: 'summary' },
                chapter: { enabled: true, treatAs: 'full_text' },
                scene: { enabled: true, treatAs: 'full_text' },
                snippet: { enabled: true },
                term: {
                    enabled: true,
                    allowedTypes: {
                        characters: true,
                        locations: true,
                        items: true,
                        lore: true,
                        others: true,
                    },
                },
                label: { enabled: false, actTreatAs: 'summary', sceneTreatAs: 'full_text' },
                outline: {
                    enabled: false,
                    act: { enabled: true, treatAs: 'summary' },
                    chapter: { enabled: true, treatAs: 'full_text' },
                },
                termTag: { enabled: false },
            },
        },
    }
}

export function createPromptCheckboxInput(): PromptCheckboxInputDefinition {
    return {
        id: createId('in'),
        type: 'checkbox',
        name: '',
        description: null,
        required: false,
        collapsed: false,
        checkbox: {
            displayName: '',
            defaultChecked: false,
        },
    }
}

export function createPromptDropdownOption(): PromptDropdownOption {
    return {
        id: createId('opt'),
        label: '',
        description: null,
        content: '',
        color: null,
    }
}

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

function normalizePromptInputName(name: string) {
    return name.trim().toLocaleLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isContentSelectionTargetValue(value: unknown): value is ContentSelectionTarget {
    const record = asRecord(value)
    if (!record || typeof record.kind !== 'string') return false

    return [
        'full_novel',
        'act',
        'chapter',
        'act_outline',
        'chapter_outline',
        'scene',
        'snippet',
        'term',
        'label',
        'term_tag',
    ].includes(record.kind)
}

function normalizeContentSelectionTargets(value: unknown): ContentSelectionTarget[] {
    if (!Array.isArray(value)) return []
    return value.filter(isContentSelectionTargetValue)
}

export function getDefaultPromptInputValue(input: PromptInputDefinition): PromptInputValue {
    if (input.type === 'checkbox') {
        return { kind: 'checkbox', checked: input.checkbox.defaultChecked }
    }

    if (input.type === 'content_selection') {
        return { kind: 'content_selection', selections: [] }
    }

    return {
        kind: 'custom',
        dropdownOptionIds: [...(input.custom.defaultContent.dropdownOptionIds ?? [])],
        text: input.custom.defaultContent.text ?? '',
    }
}

export function normalizePromptInputValue(input: PromptInputDefinition, value: unknown): PromptInputValue {
    const defaultValue = getDefaultPromptInputValue(input)

    if (input.type === 'checkbox') {
        if (typeof value === 'boolean') return { kind: 'checkbox', checked: value }
        const record = asRecord(value)
        if (record && typeof record.checked === 'boolean') {
            return { kind: 'checkbox', checked: record.checked }
        }
        return defaultValue
    }

    if (input.type === 'content_selection') {
        if (Array.isArray(value)) return { kind: 'content_selection', selections: normalizeContentSelectionTargets(value) }
        const record = asRecord(value)
        if (record && record.kind === 'content_selection') {
            return { kind: 'content_selection', selections: normalizeContentSelectionTargets(record.selections) }
        }
        if (record && Array.isArray(record.selections)) {
            return { kind: 'content_selection', selections: normalizeContentSelectionTargets(record.selections) }
        }
        return defaultValue
    }

    if (typeof value === 'string') {
        return { kind: 'custom', dropdownOptionIds: [], text: value }
    }

    const record = asRecord(value)
    if (!record) return defaultValue

    const dropdownOptionIds = Array.isArray(record.dropdownOptionIds)
        ? record.dropdownOptionIds.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : []
    const text = typeof record.text === 'string' ? record.text : ''

    return { kind: 'custom', dropdownOptionIds, text }
}

export function isPromptInputValueFilled(input: PromptInputDefinition, value: unknown = undefined) {
    const normalizedValue = value === undefined ? getDefaultPromptInputValue(input) : normalizePromptInputValue(input, value)

    if (input.type === 'checkbox') {
        return normalizedValue.kind === 'checkbox' && normalizedValue.checked
    }

    if (input.type === 'content_selection') {
        return normalizedValue.kind === 'content_selection' && normalizedValue.selections.length > 0
    }

    if (normalizedValue.kind !== 'custom') return false

    const allowMultiple = input.custom.dropdown.allowMultiple
    const selectedIds = allowMultiple ? normalizedValue.dropdownOptionIds : normalizedValue.dropdownOptionIds.slice(0, 1)
    const options = input.custom.dropdown.options ?? []

    const hasSelectedOptionContent = selectedIds
        .map((id) => options.find((option) => option.id === id) ?? null)
        .filter((option): option is PromptDropdownOption => option !== null)
        .some((option) => Boolean(option.content?.trim() || option.label?.trim()))

    return hasSelectedOptionContent || Boolean(normalizedValue.text.trim())
}

export function buildDefaultPromptInputValues(inputs: PromptInputDefinition[]): Record<string, PromptInputValue> {
    const values: Record<string, PromptInputValue> = {}

    for (const input of inputs) {
        const name = input.name.trim()
        if (!name || name in values) continue
        values[name] = getDefaultPromptInputValue(input)
    }

    return values
}

export function getMissingRequiredPromptInputNames(
    inputs: PromptInputDefinition[],
    valuesByName?: Record<string, unknown>,
    options?: { untitledLabel?: string }
) {
    const missing: string[] = []
    const seen = new Set<string>()

    for (const input of inputs) {
        if (!input.required) continue

        const name = input.name.trim()
        const key = normalizePromptInputName(name)
        if (key && seen.has(key)) continue

        const rawValue = key
            ? valuesByName?.[name] ?? valuesByName?.[key]
            : undefined

        if (isPromptInputValueFilled(input, rawValue)) continue

        if (key) seen.add(key)
        missing.push(name || options?.untitledLabel || 'Untitled')
    }

    return missing
}

function normalizeDropdownOptions(input: unknown): PromptDropdownOption[] {
    if (!Array.isArray(input)) return []
    return input
        .map((raw) => {
            const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
            const id = asTrimmedString(obj.id) ?? createId('opt')
            const label = typeof obj.label === 'string' ? obj.label : ''
            const description = typeof obj.description === 'string' ? obj.description : null
            const content = typeof obj.content === 'string' ? obj.content : ''
            const color = typeof obj.color === 'string' ? obj.color : null
            return { id, label, description, content, color }
        })
        .filter((opt, idx, arr) => arr.findIndex((o) => o.id === opt.id) === idx)
}

function normalizeCustomInput(raw: unknown): PromptCustomInputDefinition | null {
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

    const typeRaw = asTrimmedString(obj.type) ?? 'custom'
    if (typeRaw !== 'custom') return null

    const id = asTrimmedString(obj.id) ?? createId('in')
    const name = typeof obj.name === 'string' ? obj.name : ''
    const description = typeof obj.description === 'string' ? obj.description : null
    const required = typeof obj.required === 'boolean' ? obj.required : false
    const collapsed = typeof obj.collapsed === 'boolean' ? obj.collapsed : false

    const customRaw = typeof obj.custom === 'object' && obj.custom !== null ? (obj.custom as Record<string, unknown>) : {}
    const textRaw = typeof customRaw.text === 'object' && customRaw.text !== null ? (customRaw.text as Record<string, unknown>) : {}
    const dropdownRaw = typeof customRaw.dropdown === 'object' && customRaw.dropdown !== null
        ? (customRaw.dropdown as Record<string, unknown>)
        : {}
    const defaultContentRaw =
        typeof customRaw.defaultContent === 'object' && customRaw.defaultContent !== null
            ? (customRaw.defaultContent as Record<string, unknown>)
            : {}

    const textEnabled = typeof textRaw.enabled === 'boolean' ? textRaw.enabled : true
    const dropdownEnabled = typeof dropdownRaw.enabled === 'boolean' ? dropdownRaw.enabled : false
    const allowMultiple = typeof dropdownRaw.allowMultiple === 'boolean' ? dropdownRaw.allowMultiple : true
    const displayRaw = asTrimmedString(dropdownRaw.display)
    const display = displayRaw === 'menu' || displayRaw === 'chips' ? displayRaw : 'chips'
    const options = normalizeDropdownOptions(dropdownRaw.options)
    const placeholder = typeof textRaw.placeholder === 'string' ? textRaw.placeholder : ''

    const rawDefaultDropdownIds = Array.isArray(defaultContentRaw.dropdownOptionIds)
        ? defaultContentRaw.dropdownOptionIds
        : []
    const defaultDropdownOptionIds = rawDefaultDropdownIds
        .map((item) => asTrimmedString(item))
        .filter((item): item is string => item !== null)
        .filter((id) => options.some((opt) => opt.id === id))
        .filter((id, idx, arr) => arr.indexOf(id) === idx)
    const defaultText = typeof defaultContentRaw.text === 'string' ? defaultContentRaw.text : ''

    const ensureTextEnabled = !textEnabled && !dropdownEnabled
    const normalizedTextEnabled = ensureTextEnabled ? true : textEnabled
    const normalizedDefaultDropdownOptionIds =
        allowMultiple ? defaultDropdownOptionIds : defaultDropdownOptionIds.slice(0, 1)

    return {
        id,
        type: 'custom',
        name,
        description,
        required,
        collapsed,
        custom: {
            text: { enabled: normalizedTextEnabled, placeholder },
            dropdown: {
                enabled: dropdownEnabled,
                allowMultiple,
                display,
                options,
            },
            defaultContent: {
                dropdownOptionIds: normalizedDefaultDropdownOptionIds,
                text: defaultText,
            },
        },
    }
}

function normalizeTreatAs(value: unknown, fallback: ContentSelectionTreatAs): ContentSelectionTreatAs {
    return value === 'full_text' || value === 'summary' ? value : fallback
}

function normalizeContentSelectionInput(raw: unknown): PromptContentSelectionInputDefinition | null {
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

    const typeRaw = asTrimmedString(obj.type) ?? 'custom'
    if (typeRaw !== 'content_selection') return null

    const id = asTrimmedString(obj.id) ?? createId('in')
    const name = typeof obj.name === 'string' ? obj.name : ''
    const description = typeof obj.description === 'string' ? obj.description : null
    const required = typeof obj.required === 'boolean' ? obj.required : false
    const collapsed = typeof obj.collapsed === 'boolean' ? obj.collapsed : false

    const contentSelectionRaw =
        typeof obj.contentSelection === 'object' && obj.contentSelection !== null
            ? (obj.contentSelection as Record<string, unknown>)
            : {}

    const allowMultiple =
        typeof contentSelectionRaw.allowMultiple === 'boolean' ? contentSelectionRaw.allowMultiple : true

    const displayName = typeof contentSelectionRaw.displayName === 'string' ? contentSelectionRaw.displayName : ''

    const optionsRaw =
        typeof contentSelectionRaw.options === 'object' && contentSelectionRaw.options !== null
            ? (contentSelectionRaw.options as Record<string, unknown>)
            : {}

    const fullNovelRaw =
        typeof optionsRaw.fullNovel === 'object' && optionsRaw.fullNovel !== null
            ? (optionsRaw.fullNovel as Record<string, unknown>)
            : {}
    const actRaw =
        typeof optionsRaw.act === 'object' && optionsRaw.act !== null ? (optionsRaw.act as Record<string, unknown>) : {}
    const chapterRaw =
        typeof optionsRaw.chapter === 'object' && optionsRaw.chapter !== null
            ? (optionsRaw.chapter as Record<string, unknown>)
            : {}
    const sceneRaw =
        typeof optionsRaw.scene === 'object' && optionsRaw.scene !== null
            ? (optionsRaw.scene as Record<string, unknown>)
            : {}
    const snippetRaw =
        typeof optionsRaw.snippet === 'object' && optionsRaw.snippet !== null
            ? (optionsRaw.snippet as Record<string, unknown>)
            : {}
    const termRaw =
        typeof optionsRaw.term === 'object' && optionsRaw.term !== null ? (optionsRaw.term as Record<string, unknown>) : {}
    const labelRaw =
        typeof optionsRaw.label === 'object' && optionsRaw.label !== null ? (optionsRaw.label as Record<string, unknown>) : {}
    const outlineRaw =
        typeof optionsRaw.outline === 'object' && optionsRaw.outline !== null
            ? (optionsRaw.outline as Record<string, unknown>)
            : {}
    const termTagRaw =
        typeof optionsRaw.termTag === 'object' && optionsRaw.termTag !== null
            ? (optionsRaw.termTag as Record<string, unknown>)
            : {}

    const fullNovelEnabled = typeof fullNovelRaw.enabled === 'boolean' ? fullNovelRaw.enabled : true
    const fullNovelTreatAs = normalizeTreatAs(fullNovelRaw.treatAs, 'summary')

    const actEnabled = typeof actRaw.enabled === 'boolean' ? actRaw.enabled : true
    const actTreatAs = normalizeTreatAs(actRaw.treatAs, 'summary')

    const chapterEnabled = typeof chapterRaw.enabled === 'boolean' ? chapterRaw.enabled : true
    const chapterTreatAs = normalizeTreatAs(chapterRaw.treatAs, 'full_text')

    const sceneEnabled = typeof sceneRaw.enabled === 'boolean' ? sceneRaw.enabled : true
    const sceneTreatAs = normalizeTreatAs(sceneRaw.treatAs, 'full_text')

    const snippetEnabled = typeof snippetRaw.enabled === 'boolean' ? snippetRaw.enabled : true

    const termEnabled = typeof termRaw.enabled === 'boolean' ? termRaw.enabled : true
    const termAllowedRaw =
        typeof termRaw.allowedTypes === 'object' && termRaw.allowedTypes !== null
            ? (termRaw.allowedTypes as Record<string, unknown>)
            : {}
    const termAllowedTypes = {
        characters: typeof termAllowedRaw.characters === 'boolean' ? termAllowedRaw.characters : true,
        locations: typeof termAllowedRaw.locations === 'boolean' ? termAllowedRaw.locations : true,
        items: typeof termAllowedRaw.items === 'boolean' ? termAllowedRaw.items : true,
        lore: typeof termAllowedRaw.lore === 'boolean' ? termAllowedRaw.lore : true,
        others: typeof termAllowedRaw.others === 'boolean' ? termAllowedRaw.others : true,
    }

    const labelEnabled = typeof labelRaw.enabled === 'boolean' ? labelRaw.enabled : false
    const labelActTreatAs = normalizeTreatAs(labelRaw.actTreatAs, 'summary')
    const labelSceneTreatAs = normalizeTreatAs(labelRaw.sceneTreatAs, 'full_text')

    const outlineEnabled = typeof outlineRaw.enabled === 'boolean' ? outlineRaw.enabled : false
    const outlineActRaw =
        typeof outlineRaw.act === 'object' && outlineRaw.act !== null ? (outlineRaw.act as Record<string, unknown>) : {}
    const outlineChapterRaw =
        typeof outlineRaw.chapter === 'object' && outlineRaw.chapter !== null
            ? (outlineRaw.chapter as Record<string, unknown>)
            : {}
    const outlineActEnabled = typeof outlineActRaw.enabled === 'boolean' ? outlineActRaw.enabled : true
    const outlineActTreatAs = normalizeTreatAs(outlineActRaw.treatAs, 'summary')
    const outlineChapterEnabled = typeof outlineChapterRaw.enabled === 'boolean' ? outlineChapterRaw.enabled : true
    const outlineChapterTreatAs = normalizeTreatAs(outlineChapterRaw.treatAs, 'full_text')

    const termTagEnabled = typeof termTagRaw.enabled === 'boolean' ? termTagRaw.enabled : false

    return {
        id,
        type: 'content_selection',
        name,
        description,
        required,
        collapsed,
        contentSelection: {
            allowMultiple,
            displayName,
            options: {
                fullNovel: { enabled: fullNovelEnabled, treatAs: fullNovelTreatAs },
                act: { enabled: actEnabled, treatAs: actTreatAs },
                chapter: { enabled: chapterEnabled, treatAs: chapterTreatAs },
                scene: { enabled: sceneEnabled, treatAs: sceneTreatAs },
                snippet: { enabled: snippetEnabled },
                term: { enabled: termEnabled, allowedTypes: termAllowedTypes },
                label: { enabled: labelEnabled, actTreatAs: labelActTreatAs, sceneTreatAs: labelSceneTreatAs },
                outline: {
                    enabled: outlineEnabled,
                    act: { enabled: outlineActEnabled, treatAs: outlineActTreatAs },
                    chapter: { enabled: outlineChapterEnabled, treatAs: outlineChapterTreatAs },
                },
                termTag: { enabled: termTagEnabled },
            },
        },
    }
}

function normalizeCheckboxInput(raw: unknown): PromptCheckboxInputDefinition | null {
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

    const typeRaw = asTrimmedString(obj.type) ?? 'custom'
    if (typeRaw !== 'checkbox') return null

    const id = asTrimmedString(obj.id) ?? createId('in')
    const name = typeof obj.name === 'string' ? obj.name : ''
    const description = typeof obj.description === 'string' ? obj.description : null
    const required = typeof obj.required === 'boolean' ? obj.required : false
    const collapsed = typeof obj.collapsed === 'boolean' ? obj.collapsed : false

    const checkboxRaw =
        typeof obj.checkbox === 'object' && obj.checkbox !== null ? (obj.checkbox as Record<string, unknown>) : {}
    const displayName = typeof checkboxRaw.displayName === 'string' ? checkboxRaw.displayName : ''
    const defaultChecked = typeof checkboxRaw.defaultChecked === 'boolean' ? checkboxRaw.defaultChecked : false

    return {
        id,
        type: 'checkbox',
        name,
        description,
        required,
        collapsed,
        checkbox: {
            displayName,
            defaultChecked,
        },
    }
}

export function normalizePromptInputs(input: unknown): PromptInputDefinition[] {
    if (!Array.isArray(input)) return []
    return input
        .map((item) => normalizeCustomInput(item) ?? normalizeContentSelectionInput(item) ?? normalizeCheckboxInput(item))
        .filter((item): item is PromptInputDefinition => item !== null)
        .filter((opt, idx, arr) => arr.findIndex((o) => o.id === opt.id) === idx)
}
