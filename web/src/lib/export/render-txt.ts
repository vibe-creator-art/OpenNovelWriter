import { SCENE_ASTERISK_DIVIDER } from './labels'
import type { ManuscriptBlock } from './types'

export function renderTxt(blocks: ManuscriptBlock[]) {
    const parts: string[] = []

    for (const block of blocks) {
        switch (block.type) {
            case 'act-title':
            case 'chapter-title':
            case 'scene-heading':
                if (block.text) parts.push(block.text)
                break
            case 'scene-divider':
                parts.push(SCENE_ASTERISK_DIVIDER)
                break
            case 'paragraphs':
                if (block.lines.length > 0) parts.push(block.lines.join('\n\n'))
                break
        }
    }

    if (parts.length === 0) return ''
    return `${parts.join('\n\n')}\n`
}
