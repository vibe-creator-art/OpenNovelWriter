import 'dotenv/config'

import { defineConfig } from 'prisma/config'
import { resolvePrismaSqliteUrl } from './src/lib/server/prisma-sqlite.cjs'

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: resolvePrismaSqliteUrl(process.env.DATABASE_URL, process.cwd()),
    },
})
