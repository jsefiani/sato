import { createFileRoute } from '@tanstack/react-router'
import { sql } from 'drizzle-orm'
import { db } from '@/db'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.execute(sql`SELECT 1`)
          return Response.json({ status: 'ok' })
        } catch {
          return Response.json({ status: 'error' }, { status: 503 })
        }
      },
    },
  },
})
