import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { MaintenanceAction } from '@/lib/vps-maintenance'
import { db } from '@/db'
import { auditLog, vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { createId } from '@/lib/ids'
import { requireAdminSession } from '@/lib/session'
import { maintenanceActions } from '@/lib/vps-maintenance'

const maintainBodySchema = z.object({
  userId: z.string().min(1),
  action: z.enum([
    'update-openclaw',
    'enable-unattended-upgrades',
    'update-os',
  ] as const satisfies ReadonlyArray<MaintenanceAction>),
})

export const Route = createFileRoute('/api/admin/vps/maintain')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireAdminSession()

          const parsed = maintainBodySchema.safeParse(await request.json())

          if (!parsed.success) {
            return Response.json(
              { error: 'Invalid request body' },
              { status: 400 },
            )
          }

          const { userId, action } = parsed.data

          const instance = await db.query.vpsInstance.findFirst({
            where: eq(vpsInstance.userId, userId),
            columns: {
              status: true,
              tailscaleIp: true,
            },
          })

          if (!instance) {
            return Response.json(
              { error: 'No VPS instance found for this user' },
              { status: 404 },
            )
          }

          if (instance.status !== 'active') {
            return Response.json(
              { error: `VPS is not active (status: ${instance.status})` },
              { status: 409 },
            )
          }

          if (!instance.tailscaleIp) {
            return Response.json(
              { error: 'VPS has no Tailscale IP' },
              { status: 409 },
            )
          }

          const host = instance.tailscaleIp
          const actionFn = maintenanceActions[action]

          try {
            const result = await actionFn({ host })

            if (action === 'update-openclaw') {
              const dbUpdates: Record<string, unknown> = {}

              const detail = result.detail as {
                toVersion?: string | null
              }
              if (detail.toVersion) {
                dbUpdates.openclawVersion = detail.toVersion
              }
              dbUpdates.lastUpdatedAt = new Date()

              await db
                .update(vpsInstance)
                .set(dbUpdates)
                .where(eq(vpsInstance.userId, userId))
            }

            await db.insert(auditLog).values({
              id: createId(),
              userId: session.user.id,
              action: 'vps.maintenance_succeeded',
              metadata: JSON.stringify({
                targetUserId: userId,
                maintenanceAction: action,
                durationMs: result.durationMs,
                detail: result.detail,
              }),
              createdAt: new Date(),
            })

            return Response.json({
              ok: true,
              action,
              durationMs: result.durationMs,
              detail: result.detail,
            })
          } catch (actionError) {
            const errorMessage =
              actionError instanceof Error
                ? actionError.message
                : 'Unknown error'

            await db.insert(auditLog).values({
              id: createId(),
              userId: session.user.id,
              action: 'vps.maintenance_failed',
              metadata: JSON.stringify({
                targetUserId: userId,
                maintenanceAction: action,
                error: errorMessage,
              }),
              createdAt: new Date(),
            })

            return Response.json(
              { error: 'Maintenance action failed' },
              { status: 502 },
            )
          }
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
