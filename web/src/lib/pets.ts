export const DEFAULT_PET_ID = 'xixi' as const

export type PetManifest = {
    id: string
    displayName: string
    description: string
    spritesheetPath: string
}

export type PetSummary = PetManifest & {
    builtIn: boolean
    spriteUrl: string
}

export type PetAnimationName =
    | 'idle'
    | 'running-right'
    | 'running-left'
    | 'waving'
    | 'jumping'
    | 'failed'
    | 'waiting'
    | 'running'
    | 'review'

export const PET_ANIMATIONS: Record<PetAnimationName, { row: number; durations: readonly number[] }> = {
    idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
    'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
    'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
    waving: { row: 3, durations: [140, 140, 140, 280] },
    jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
    failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
    running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
    review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
}

export const BUILT_IN_PETS: PetSummary[] = [
    {
        id: DEFAULT_PET_ID,
        displayName: '西西',
        description: '蓝发金瞳的写作助手，陪你一起完成每一段故事。',
        spritesheetPath: 'spritesheet.webp',
        builtIn: true,
        spriteUrl: '/pets/xixi/spritesheet.webp',
    },
    {
        id: 'luoluo',
        displayName: '洛洛',
        description: '仙侠助手洛洛，和你一起经历故事的悲欢离合',
        spritesheetPath: 'spritesheet.png',
        builtIn: true,
        spriteUrl: '/pets/luoluo/spritesheet.png',
    },
]

export function isBuiltInPetId(petId: string) {
    return BUILT_IN_PETS.some((pet) => pet.id === petId)
}
