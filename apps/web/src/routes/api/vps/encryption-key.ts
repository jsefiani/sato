import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { auditLog, vpsInstance } from '@/db/schema'
import { createId } from '@/lib/ids'
import { assertRateLimit } from '@/lib/rate-limit'
import { resolveDataKeyForUnlock } from '@/lib/vps-data-encryption'

const unlockBodySchema = z.object({
  userId: z.string().min(1),
  requestedAt: z.coerce.number().int(),
  signature: z.string().min(1),
})

function getSourceIp({ request }: { request: Request }): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')

  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) {
      return first
    }
  }

  return null
}

function isUnlockAllowedStatus(status: string): boolean {
  return status === 'bootstrapping' || status === 'active'
}

export const Route = createFileRoute('/api/vps/encryption-key')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rateLimited = assertRateLimit(request, 'vps-unlock')
        if (rateLimited) {
          return rateLimited
        }

        const body = (await request.json().catch(() => null)) as unknown
        const parsed = unlockBodySchema.safeParse(body)

        if (!parsed.success) {
          return Response.json({ error: 'Invalid input' }, { status: 400 })
        }

        const { userId, requestedAt, signature } = parsed.data
        const sourceIp = getSourceIp({ request })

        const instance = await db.query.vpsInstance.findFirst({
          where: eq(vpsInstance.userId, userId),
          columns: {
            status: true,
          },
        })

        if (!instance || !isUnlockAllowedStatus(instance.status)) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }

        const resolved = await resolveDataKeyForUnlock({
          userId,
          requestedAt,
          signature,
          sourceIp,
        })

        if (!resolved) {
          await db.insert(auditLog).values({
            id: createId(),
            userId,
            action: 'vps.data_volume_unlock_denied',
            metadata: JSON.stringify({
              sourceIp,
            }),
            createdAt: new Date(),
          })

          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }

        await db.insert(auditLog).values({
          id: createId(),
          userId,
          action: 'vps.data_volume_unlocked',
          metadata: JSON.stringify({
            sourceIp,
            keyVersion: resolved.keyVersion,
          }),
          createdAt: new Date(),
        })

        return Response.json({
          key: resolved.dataKey,
          keyVersion: resolved.keyVersion,
        })
      },
    },
  },
})
