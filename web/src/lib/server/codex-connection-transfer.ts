import Database from 'better-sqlite3'
import fs from 'fs/promises'
import { constants } from 'fs'
import path from 'path'

type Row = Record<string, unknown>

function quoted(name: string) {
    return `"${name.replaceAll('"', '""')}"`
}

async function stateDatabase(home: string, kind: 'state' | 'goals') {
    const entries = await fs.readdir(home)
    const files = entries.filter((name) => new RegExp(`^${kind}_\\d+\\.sqlite$`).test(name))
        .sort((a, b) => Number(b.split('_')[1].split('.')[0]) - Number(a.split('_')[1].split('.')[0]))
    if (!files[0]) throw new Error(`Codex ${kind} storage is missing. The connection has not been deleted.`)
    return path.join(home, files[0])
}

/** Copy saved threads and goal accounting without transferring connection credentials. */
export async function transferCodexConnectionThreads(sourceHome: string, targetHome: string, rootThreadIds: string[]) {
    if (rootThreadIds.length === 0) return
    const [sourceRoot, targetRoot] = await Promise.all([fs.realpath(sourceHome), fs.realpath(targetHome)])
    const [sourceState, sourceGoals, targetState, targetGoals] = await Promise.all([
        stateDatabase(sourceRoot, 'state'), stateDatabase(sourceRoot, 'goals'),
        stateDatabase(targetRoot, 'state'), stateDatabase(targetRoot, 'goals'),
    ])
    const db = new Database(targetState, { fileMustExist: true })
    try {
        db.pragma('foreign_keys = ON')
        db.prepare('ATTACH DATABASE ? AS source').run(sourceState)
        db.prepare('ATTACH DATABASE ? AS source_goals').run(sourceGoals)
        db.prepare('ATTACH DATABASE ? AS target_goals').run(targetGoals)

        const threadIds = new Set(rootThreadIds)
        const edges = db.prepare('SELECT * FROM source.thread_spawn_edges').all() as Row[]
        let expanded = true
        while (expanded) {
            expanded = false
            for (const edge of edges) {
                if (threadIds.has(String(edge.parent_thread_id)) && !threadIds.has(String(edge.child_thread_id))) {
                    threadIds.add(String(edge.child_thread_id))
                    expanded = true
                }
            }
        }
        const threads = [...threadIds].map((id) => {
            const row = db.prepare('SELECT * FROM source.threads WHERE id = ?').get(id) as Row | undefined
            if (!row) throw new Error(`Codex history for thread ${id} is missing. The connection has not been deleted.`)
            return row
        })
        for (const thread of threads) {
            const rollout = await fs.realpath(String(thread.rollout_path))
            const relative = path.relative(sourceRoot, rollout)
            if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
                throw new Error('Codex history is outside this connection’s storage. The connection has not been deleted.')
            }
            const destination = path.join(targetRoot, relative)
            await fs.mkdir(path.dirname(destination), { recursive: true })
            try {
                await fs.copyFile(rollout, destination, constants.COPYFILE_EXCL)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
                const [original, existing] = await Promise.all([fs.readFile(rollout), fs.readFile(destination)])
                if (!original.equals(existing)) throw new Error('The destination already has different Codex history. The connection has not been deleted.')
            }
            thread.rollout_path = destination
        }

        const copyRows = (table: string, rows: Row[], from = 'source', to = 'main', update = false) => {
            if (rows.length === 0) return
            const sourceColumns = db.prepare(`PRAGMA ${from}.table_info(${quoted(table)})`).all() as { name: string; pk: number }[]
            const targetColumns = db.prepare(`PRAGMA ${to}.table_info(${quoted(table)})`).all() as { name: string }[]
            const columns = sourceColumns.map((column) => column.name)
            if (columns.join('\0') !== targetColumns.map((column) => column.name).join('\0')) {
                throw new Error('Codex storage schemas differ. Update Codex before deleting this connection.')
            }
            const primary = sourceColumns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name)
            const conflict = update
                ? `ON CONFLICT (${primary.map(quoted).join(',')}) DO UPDATE SET ${columns.filter((name) => !primary.includes(name)).map((name) => `${quoted(name)} = excluded.${quoted(name)}`).join(',')}`
                : 'ON CONFLICT DO NOTHING'
            const statement = db.prepare(`INSERT INTO ${to}.${quoted(table)} (${columns.map(quoted).join(',')}) VALUES (${columns.map(() => '?').join(',')}) ${conflict}`)
            for (const row of rows) statement.run(...columns.map((name) => row[name]))
        }
        const selectRows = (table: string, column: string, ids: Set<string>, schema = 'source') => {
            const statement = db.prepare(`SELECT * FROM ${schema}.${quoted(table)} WHERE ${quoted(column)} = ?`)
            return [...ids].flatMap((id) => statement.all(id) as Row[])
        }
        db.transaction(() => {
            const projectIds = new Set(threads.flatMap((thread) => typeof thread.project_id === 'string' ? [thread.project_id] : []))
            const sectionIds = new Set(threads.flatMap((thread) => typeof thread.thread_section_id === 'string' ? [thread.thread_section_id] : []))
            copyRows('projects', selectRows('projects', 'id', projectIds))
            copyRows('project_roots', selectRows('project_roots', 'project_id', projectIds))
            copyRows('thread_sections', selectRows('thread_sections', 'id', sectionIds))
            copyRows('threads', threads, 'source', 'main', true)
            copyRows('thread_dynamic_tools', selectRows('thread_dynamic_tools', 'thread_id', threadIds), 'source', 'main', true)
            copyRows('thread_artifacts', selectRows('thread_artifacts', 'thread_id', threadIds), 'source', 'main', true)
            copyRows('thread_spawn_edges', edges.filter((edge) => threadIds.has(String(edge.parent_thread_id))), 'source', 'main', true)
            copyRows('thread_goals', selectRows('thread_goals', 'thread_id', threadIds, 'source_goals'), 'source_goals', 'target_goals', true)
            copyRows('thread_goal_continuation_deferrals', selectRows('thread_goal_continuation_deferrals', 'thread_id', threadIds, 'source_goals'), 'source_goals', 'target_goals')
        })()
    } finally {
        db.close()
    }
}
