import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { safeApiResponse, sanitizeLastError } from '@/lib/api-error'
import { syncTelegramChannelConnection } from '@/lib/channel-connections'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { connectTelegram } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

const TELEGRAM_BOT_TOKEN_REGEX = /^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/

const connectBodySchema = z.object({
  token: z.string().min(1, 'Telegram bot token is required').max(100),
})

function telegramProvisioningError(status: string): string | null {
  if (status === 'active') {
    return null
  }

  if (status === 'failed' || status === 'cleanup_pending') {
    return 'Assistant setup failed on this VPS. Re-run setup from the Launch step before connecting Telegram.'
  }

  if (
    status === 'pending' ||
    status === 'provisioning' ||
    status === 'bootstrapping'
  ) {
    return 'Assistant setup is still in progress. Wait for setup to finish before connecting Telegram.'
  }

  return `Assistant is not ready for Telegram setup (status: ${status}).`
}

export const Route = createFileRoute('/api/vps/telegram/connect')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'telegram',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const parsed = connectBodySchema.safeParse(await request.json())
          if (!parsed.success) {
            return Response.json(
              { error: 'Telegram bot token is required' },
              { status: 400 },
            )
          }

          const token = parsed.data.token.trim()

          if (!token) {
            return Response.json(
              { error: 'Telegram bot token is required' },
              { status: 400 },
            )
          }

          if (!TELEGRAM_BOT_TOKEN_REGEX.test(token)) {
            return Response.json(
              {
                error:
                  'That token format looks invalid. Double-check the BotFather token and try again.',
              },
              { status: 400 },
            )
          }

          const rows = await db
            .select({
              ipv4Address: vpsInstance.ipv4Address,
              tailscaleIp: vpsInstance.tailscaleIp,
              status: vpsInstance.status,
              provisionedAt: vpsInstance.provisionedAt,
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

          const provisioningError = telegramProvisioningError(instance.status)
          if (provisioningError) {
            return Response.json({ error: provisioningError }, { status: 409 })
          }

          const summary = await connectTelegram(instance.tailscaleIp, token)
          const setupState = await syncTelegramChannelConnection(
            session.user.id,
            summary,
            {
              vpsProvisionedAt: instance.provisionedAt,
              resetConnectionApproval: true,
            },
          )

          const connected = setupState === 'connected'
          const configured = connected || setupState === 'configuring'

          return Response.json({
            ...summary,
            lastError: sanitizeLastError(summary.lastError),
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
