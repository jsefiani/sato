import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { syncTelegramChannelConnection } from '@/lib/channel-connections'
import { connectTelegram } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

interface ConnectTelegramBody {
  token?: string
}

const TELEGRAM_BOT_TOKEN_REGEX = /^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/

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
        try {
          const session = await requireSession()
          const body = (await request.json()) as ConnectTelegramBody
          const token = body.token?.trim() ?? ''

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

          if (!instance.ipv4Address) {
            return Response.json(
              { error: 'VPS has no IP address yet' },
              { status: 409 },
            )
          }

          const provisioningError = telegramProvisioningError(instance.status)
          if (provisioningError) {
            return Response.json({ error: provisioningError }, { status: 409 })
          }

          const summary = await connectTelegram(instance.ipv4Address, token)
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
            connected,
            configured,
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
