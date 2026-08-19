import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { SCENE_ASTERISK_DIVIDER } from './labels'
import type { ManuscriptBlock } from './types'

function runsFromText(text: string, extras?: ConstructorParameters<typeof TextRun>[0]) {
    const lines = text.split('\n')
    return lines.flatMap((line, index) => {
        const run = new TextRun({
            ...(typeof extras === 'object' && extras ? extras : {}),
            text: line,
        })
        if (index === 0) return [run]
        return [new TextRun({ break: 1 }), run]
    })
}

function headingParagraph(text: string, heading: (typeof HeadingLevel)[keyof typeof HeadingLevel], before: number) {
    return new Paragraph({
        heading,
        spacing: { before, after: 200 },
        children: runsFromText(text, { bold: true }),
    })
}

export async function renderDocx(blocks: ManuscriptBlock[]) {
    const children: Paragraph[] = []

    for (const block of blocks) {
        switch (block.type) {
            case 'act-title':
                children.push(headingParagraph(block.text, HeadingLevel.HEADING_1, children.length === 0 ? 0 : 360))
                break
            case 'chapter-title':
                children.push(headingParagraph(block.text, HeadingLevel.HEADING_2, children.length === 0 ? 0 : 280))
                break
            case 'scene-heading':
                children.push(headingParagraph(block.text, HeadingLevel.HEADING_3, 200))
                break
            case 'scene-divider':
                children.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 240, after: 240 },
                    children: [new TextRun({ text: SCENE_ASTERISK_DIVIDER })],
                }))
                break
            case 'paragraphs':
                for (const line of block.lines) {
                    children.push(new Paragraph({
                        spacing: { after: 200 },
                        children: runsFromText(line),
                    }))
                }
                break
        }
    }

    const doc = new Document({
        sections: [{
            properties: {},
            children: children.length > 0 ? children : [new Paragraph('')],
        }],
    })

    return Packer.toBuffer(doc)
}
