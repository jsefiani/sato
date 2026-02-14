import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from './schema.ts'
import { env } from '@/lib/env'

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
})

export const db = drizzle(pool, { schema })
