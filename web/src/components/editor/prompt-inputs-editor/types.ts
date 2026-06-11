import type { ContentSelectionTarget } from '@/lib/prompt-inputs'
import type { DefaultTermCategoryId } from '@/components/editor/terms/types'

export type InputId = string
export type OptionId = string

export type TranslationFn = (key: string, values?: Record<string, string | number | Date>) => string

export type CustomPreviewState = { dropdownOptionIds: string[]; text: string }

export type ContentSelectionPreviewState = { selections: ContentSelectionTarget[] }

export type AllowedSettingsOpenState = { text: boolean; dropdown: boolean }

export type TermPickerCategoryFilter = 'all' | DefaultTermCategoryId | 'others'

