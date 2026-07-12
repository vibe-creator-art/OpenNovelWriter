#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const [, , inputArg, ...args] = process.argv
const listProfiles = args.includes('--list-profiles')
const profileFlagIndex = args.indexOf('--profile')
let profileArg = profileFlagIndex === -1 ? null : args[profileFlagIndex + 1]
const outputArg = args.find((arg, index) => arg !== '--profile' && index !== profileFlagIndex + 1 && arg !== '--list-profiles')

if (!inputArg || (!listProfiles && !outputArg) || (profileFlagIndex !== -1 && profileArg == null)) {
    console.error('Usage: extract-sillytavern-preset.mjs <input.json> --list-profiles')
    console.error('   or: extract-sillytavern-preset.mjs <input.json> <output.json> --profile <index>')
    process.exit(2)
}

const inputPath = path.resolve(inputArg)
const raw = await fs.readFile(inputPath, 'utf8')
let preset
try {
    preset = JSON.parse(raw)
} catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
}

if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
    throw new Error('SillyTavern preset must be a JSON object.')
}

const promptList = Array.isArray(preset.prompts) ? preset.prompts : []
const promptByIdentifier = new Map()
const prompts = promptList.map((rawPrompt, sourceIndex) => {
    const prompt = rawPrompt && typeof rawPrompt === 'object' ? rawPrompt : {}
    const identifier = asString(prompt.identifier) || `prompt-${sourceIndex + 1}`
    const content = asString(prompt.content)
    const normalized = {
        sourceIndex,
        identifier,
        name: asString(prompt.name) || identifier,
        role: normalizeRole(prompt.role),
        content,
        marker: prompt.marker === true,
        systemPrompt: prompt.system_prompt === true,
        injection: {
            position: numberOrNull(prompt.injection_position),
            depth: numberOrNull(prompt.injection_depth),
            order: numberOrNull(prompt.injection_order),
            trigger: Array.isArray(prompt.injection_trigger) ? prompt.injection_trigger : [],
        },
        macros: extractMacros(content),
    }
    if (!promptByIdentifier.has(identifier)) promptByIdentifier.set(identifier, normalized)
    return normalized
})

const rawOrders = Array.isArray(preset.prompt_order) ? preset.prompt_order : []
const profiles = rawOrders.map((rawProfile, profileIndex) => {
    const profile = rawProfile && typeof rawProfile === 'object' ? rawProfile : {}
    const order = Array.isArray(profile.order) ? profile.order : []
    const items = order.map((rawItem, orderIndex) => {
        const item = rawItem && typeof rawItem === 'object' ? rawItem : {}
        const identifier = asString(item.identifier)
        const prompt = promptByIdentifier.get(identifier) ?? null
        return {
            order: orderIndex,
            identifier,
            enabled: item.enabled === true,
            found: prompt !== null,
            ...(prompt ? {
                sourceIndex: prompt.sourceIndex,
                name: prompt.name,
                role: prompt.role,
                marker: prompt.marker,
                systemPrompt: prompt.systemPrompt,
                injection: prompt.injection,
                content: prompt.content,
                macros: prompt.macros,
            } : {}),
        }
    })
    return {
        index: profileIndex,
        characterId: profile.character_id ?? null,
        totalCount: items.length,
        enabledCount: items.filter((item) => item.enabled).length,
        items,
    }
})

const profileSummaries = profiles.map((profile) => ({
    index: profile.index,
    characterId: profile.characterId,
    totalCount: profile.totalCount,
    enabledCount: profile.enabledCount,
    missingCount: profile.items.filter((item) => !item.found).length,
}))

if (listProfiles) {
    console.log(JSON.stringify({
        schema: 'open-novel-writer/sillytavern-profile-summary',
        version: 1,
        source: {
            fileName: path.basename(inputPath),
            promptDefinitionCount: prompts.length,
            profileCount: profiles.length,
        },
        profiles: profileSummaries,
    }, null, 2))
    process.exit(0)
}

if (profileArg == null) {
    if (profiles.length === 1) {
        profileArg = '0'
    } else {
        throw new Error(`This preset has ${profiles.length} prompt profiles. Run --list-profiles, then pass --profile <index>.`)
    }
}

const selectedProfileIndex = Number(profileArg)
if (!Number.isInteger(selectedProfileIndex) || selectedProfileIndex < 0 || selectedProfileIndex >= profiles.length) {
    throw new Error(`Invalid --profile value "${profileArg}". Available indices: ${profiles.map((profile) => profile.index).join(', ')}.`)
}

const selectedProfile = profiles[selectedProfileIndex]
const selectedPrompts = selectedProfile.items
    .filter((item) => item.found)
    .map((item) => ({
        sourceIndex: item.sourceIndex,
        identifier: item.identifier,
        name: item.name,
        role: item.role,
        marker: item.marker,
        systemPrompt: item.systemPrompt,
        injection: item.injection,
        content: item.content,
        macros: item.macros,
    }))

const extensions = preset.extensions && typeof preset.extensions === 'object' && !Array.isArray(preset.extensions)
    ? preset.extensions
    : {}
const regexes = extractRegexes(extensions)
const choiceGroupCandidates = detectChoiceGroups(selectedPrompts, [selectedProfile])

const output = {
    schema: 'open-novel-writer/sillytavern-extract',
    version: 2,
    source: {
        fileName: path.basename(inputPath),
        promptDefinitionCount: prompts.length,
        profileCount: profiles.length,
    },
    profileSummaries,
    selectedProfile: {
        index: selectedProfile.index,
        characterId: selectedProfile.characterId,
        totalCount: selectedProfile.totalCount,
        enabledCount: selectedProfile.enabledCount,
        items: selectedProfile.items,
    },
    prompts: selectedPrompts,
    choiceGroupCandidates,
    specialFields: collectSpecialFields(preset),
    regexes,
}

const outputPath = path.resolve(outputArg)
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
    outputPath,
    profile: selectedProfile.index,
    prompts: selectedPrompts.length,
    enabledPrompts: selectedProfile.enabledCount,
    choiceGroupCandidates: choiceGroupCandidates.length,
    regexes: regexes.length,
}))

function asString(value) {
    return typeof value === 'string' ? value : ''
}

function normalizeRole(value) {
    return value === 'system' || value === 'assistant' || value === 'model' ? value : 'user'
}

function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractMacros(content) {
    const matches = content.match(/\{\{(?:(?!\{\{|\}\})[\s\S])*\}\}/g) ?? []
    return [...new Set(matches)]
}

function titlePrefix(name) {
    const trimmed = name.trim()
    const match = trimmed.match(/^([^\p{L}\p{N}\s]{1,4})/u)
    return match?.[1] ?? ''
}

function detectChoiceGroups(allPrompts, allProfiles) {
    const profilePositions = new Map()
    for (const profile of allProfiles) {
        for (const item of profile.items) {
            const list = profilePositions.get(item.identifier) ?? []
            list.push({ profileIndex: profile.index, order: item.order, enabled: item.enabled })
            profilePositions.set(item.identifier, list)
        }
    }

    const byPrefix = new Map()
    for (const prompt of allPrompts) {
        if (prompt.marker || !prompt.content.trim()) continue
        const prefix = titlePrefix(prompt.name)
        if (!prefix) continue
        const list = byPrefix.get(prefix) ?? []
        list.push(prompt)
        byPrefix.set(prefix, list)
    }

    const candidates = []
    for (const [prefix, members] of byPrefix.entries()) {
        if (members.length < 2) continue
        const explicitChoice = members.some((item) => /(只能开一个|最多开一个|[二三四五六七八九十]选一|互斥|选一个)/.test(item.name + item.content))
        const closeInAProfile = allProfiles.some((profile) => {
            const positions = members
                .map((member) => profile.items.find((item) => item.identifier === member.identifier)?.order)
                .filter((value) => typeof value === 'number')
            return positions.length >= 2 && Math.max(...positions) - Math.min(...positions) <= members.length + 5
        })
        if (!explicitChoice && !closeInAProfile) continue

        candidates.push({
            key: prefix,
            reason: explicitChoice ? 'explicit-choice-language' : 'shared-icon-and-nearby-order',
            members: members.map((member) => ({
                identifier: member.identifier,
                name: member.name,
                content: member.content,
                positions: profilePositions.get(member.identifier) ?? [],
            })),
        })
    }
    return candidates
}

function extractRegexes(extensions) {
    const lists = []
    if (Array.isArray(extensions.regex_scripts)) lists.push(...extensions.regex_scripts)
    const bindingRegexes = extensions.SPreset?.RegexBinding?.regexes
    if (Array.isArray(bindingRegexes)) lists.push(...bindingRegexes)
    return lists.map((rawRegex, index) => {
        const regex = rawRegex && typeof rawRegex === 'object' ? rawRegex : {}
        return {
            index,
            id: asString(regex.id),
            name: asString(regex.scriptName) || asString(regex.name) || `regex-${index + 1}`,
            enabled: regex.disabled !== true,
            findRegex: asString(regex.findRegex),
            replaceString: asString(regex.replaceString),
            placement: Array.isArray(regex.placement) ? regex.placement : [],
            promptOnly: regex.promptOnly === true,
            markdownOnly: regex.markdownOnly === true,
            minDepth: numberOrNull(regex.minDepth),
            maxDepth: numberOrNull(regex.maxDepth),
        }
    })
}

function collectSpecialFields(source) {
    const keys = [
        'assistant_prefill',
        'assistant_impersonation',
        'continue_nudge_prompt',
        'continue_prefill',
        'continue_postfix',
        'impersonation_prompt',
        'new_chat_prompt',
        'new_group_chat_prompt',
        'new_example_chat_prompt',
        'send_if_empty',
        'squash_system_messages',
        'use_sysprompt',
        'wi_format',
        'scenario_format',
        'personality_format',
    ]
    return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]))
}
