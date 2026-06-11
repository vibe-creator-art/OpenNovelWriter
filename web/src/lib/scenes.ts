import { parseLabelIdsJson } from '@/lib/labels'
import { parseTermIdsJson } from '@/lib/term-ids'

export function serializeScene<T extends { labelIdsJson: string; termIdsJson?: string | null }>(
    record: T
): Omit<T, 'labelIdsJson' | 'termIdsJson'> & { labelIds: string[]; termIds: string[] } {
    const { labelIdsJson, termIdsJson, ...rest } = record
    return {
        ...(rest as Omit<T, 'labelIdsJson' | 'termIdsJson'>),
        labelIds: parseLabelIdsJson(labelIdsJson),
        termIds: parseTermIdsJson(termIdsJson),
    }
}
