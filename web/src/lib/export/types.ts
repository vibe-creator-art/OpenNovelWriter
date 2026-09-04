export const NOVEL_EXPORT_FORMATS = ['txt', 'docx'] as const
export type NovelExportFormat = (typeof NOVEL_EXPORT_FORMATS)[number]

export const NOVEL_EXPORT_SCENE_DIVIDERS = ['asterisks', 'headings', 'none'] as const
export type NovelExportSceneDivider = (typeof NOVEL_EXPORT_SCENE_DIVIDERS)[number]

export type NovelExportRequest = {
    chapterIds: string[]
    format: NovelExportFormat
    includeActTitles?: boolean
    numberedHeadings?: boolean
    sceneDivider?: NovelExportSceneDivider
}

export type ExportAct = {
    number: number
    title: string | null
}

export type ExportScene = {
    order: number
    content: string
}

export type ExportChapter = {
    id: string
    title: string
    actNumber: number
    order: number
    chapterNumber?: number
    scenes: ExportScene[]
}

export type AssembleOptions = {
    includeActTitles: boolean
    numberedHeadings: boolean
    sceneDivider: NovelExportSceneDivider
    language: string
}

export type ManuscriptBlock =
    | { type: 'act-title'; text: string }
    | { type: 'chapter-title'; text: string }
    | { type: 'scene-heading'; text: string }
    | { type: 'scene-divider' }
    | { type: 'paragraphs'; lines: string[] }
