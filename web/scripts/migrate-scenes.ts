import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Starting migration: Creating default scenes for existing chapters...')

    // Find all chapters that don't have any scenes
    const chaptersWithoutScenes = await prisma.chapter.findMany({
        where: {
            scenes: {
                none: {}
            }
        }
    })

    console.log(`Found ${chaptersWithoutScenes.length} chapters without scenes`)

    // Create a default scene for each chapter
    for (const chapter of chaptersWithoutScenes) {
        await prisma.scene.create({
            data: {
                chapterId: chapter.id,
                order: 0,
                content: '',
                wordCount: chapter.wordCount,
            }
        })
        console.log(`Created scene for chapter "${chapter.title}" (${chapter.id})`)
    }

    console.log('Migration complete!')
}

main()
    .catch((e) => {
        console.error('Migration failed:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
