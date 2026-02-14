import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { verifyOpenClawHost } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/vps/verify')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const session = await requireSession()

          const rows = await db
            .select({
              ipv4Address: vpsInstance.ipv4Address,
              status: vpsInstance.status,
            })
            .from(vpsInstance)
            .where(eq(vpsInstance.userId, session.user.id))
            .limit(1)
          const instance = rows.at(0)

          if (!instance) {
            return Response.json(
              { error: 'No VPS instance found' },
              { status: 404 },
            )
          }

          if (!instance.ipv4Address) {
            return Response.json(
              { error: 'VPS has no IP address yet' },
              { status: 409 },
            )
          }

          const result = await verifyOpenClawHost(instance.ipv4Address)

          return Response.json({
            ...result,
            vpsStatus: instance.status,
            ipv4Address: instance.ipv4Address,
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          if (message === 'Unauthorized') {
            return Response.json({ error: message }, { status: 401 })
          }
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
