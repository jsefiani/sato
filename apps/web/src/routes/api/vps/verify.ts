import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertRateLimit } from '@/lib/rate-limit'
import { verifyOpenClawHost } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/vps/verify')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'vps-status',
            session.user.id,
          )

          if (rateLimited) return rateLimited

          const rows = await db
            .select({
              ipv4Address: vpsInstance.ipv4Address,
              tailscaleIp: vpsInstance.tailscaleIp,
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

          if (!instance.tailscaleIp) {
            return Response.json(
              { error: 'VPS SSH is not ready yet' },
              { status: 409 },
            )
          }

          const result = await verifyOpenClawHost(instance.tailscaleIp)

          return Response.json({
            ...result,
            vpsStatus: instance.status,
            ipv4Address: instance.ipv4Address,
          })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
