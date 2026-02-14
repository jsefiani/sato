import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import type { ChannelSetupState } from '@/lib/channel-connections'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { syncTelegramChannelConnection } from '@/lib/channel-connections'
import { assertRateLimit } from '@/lib/rate-limit'
import { getTelegramStatus } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

function telegramProvisioningError(status: string): string | null {
  if (status === 'active') {
    return null
  }

  if (status === 'failed' || status === 'cleanup_pending') {
    return 'Assistant setup failed on this VPS. Re-run setup from the Launch step before checking Telegram status.'
  }

  if (
    status === 'pending' ||
    status === 'provisioning' ||
    status === 'bootstrapping'
  ) {
    return 'Assistant setup is still in progress. Wait for setup to finish before checking Telegram status.'
  }

  return `Assistant is not ready for Telegram status checks (status: ${status}).`
}

export const Route = createFileRoute('/api/vps/telegram/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'telegram',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const userId = session.user.id

          const rows = await db
            .select({
              ipv4Address: vpsInstance.ipv4Address,
              tailscaleIp: vpsInstance.tailscaleIp,
              status: vpsInstance.status,
              provisionedAt: vpsInstance.provisionedAt,
            })
            .from(vpsInstance)
            .where(eq(vpsInstance.userId, userId))
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

          const provisioningError = telegramProvisioningError(instance.status)
          if (provisioningError) {
            return Response.json({ error: provisioningError }, { status: 409 })
          }

          const summary = await getTelegramStatus(instance.tailscaleIp)

          let setupState: ChannelSetupState = summary.configured
            ? 'configuring'
            : 'disconnected'
          try {
            setupState = await syncTelegramChannelConnection(userId, summary, {
              vpsProvisionedAt: instance.provisionedAt,
            })
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            console.warn(
              `Failed to persist Telegram connection state for user ${userId}:`,
              message,
            )
          }

          const connected = setupState === 'connected'
          const configured = connected || setupState === 'configuring'

          return Response.json({
            ...summary,
            connected,
            configured,
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
