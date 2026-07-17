/**
 * Next.js instrumentation hook — runs once per server startup (`next dev` /
 * `next start`). We sweep orphan image files on boot and then on a slow
 * interval, so references dropped while the server is up (deleted chats /
 * codex sessions) are reclaimed without waiting for a restart.
 */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return

    const [{ sweepOrphanImages }, { migrateSkillStorageToOfficialFormat }] = await Promise.all([
        import('@/lib/server/image-gc'),
        import('@/lib/server/skill-storage-migration'),
    ])
    const skillMigration = await migrateSkillStorageToOfficialFormat()
    if (skillMigration.migrated > 0) {
        console.log(`[skill-storage] migrated ${skillMigration.migrated} skill folder(s) to the official format`)
    }
    if (skillMigration.renamed > 0) {
        console.log(`[skill-storage] renamed ${skillMigration.renamed} placeholder skill directory id(s)`)
    }
    const sweep = async (label: string) => {
        try {
            const result = await sweepOrphanImages()
            if (result.deleted > 0) {
                console.log(
                    `[image-gc] ${label} sweep removed ${result.deleted} orphan image(s) ` +
                        `(scanned ${result.scanned}, referenced ${result.referenced})`,
                )
            }
        } catch (error) {
            console.error(`[image-gc] ${label} sweep failed:`, error)
        }
    }

    await sweep('startup')
    setInterval(() => void sweep('periodic'), SWEEP_INTERVAL_MS).unref?.()
}
