import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { safeApiResponse, sanitizeLastError } from '@/lib/api-error'
import { syncTelegramChannelConnection } from '@/lib/channel-connections'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { approveTelegramPairing } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

const PAIRING_CODE_REGEX = /^[A-Z2-9]{8}$/

const approveBodySchema = z.object({
  code: z.string().min(1, 'Pairing code is required').max(20),
})

function telegramProvisioningError(status: string): string | null {
  if (status === 'active') {
    return null
  }

  if (status === 'failed' || status === 'cleanup_pending') {
    return 'Assistant setup failed on this VPS. Re-run setup from the Launch step before approving Telegram pairing.'
  }

  if (
    status === 'pending' ||
    status === 'provisioning' ||
    status === 'bootstrapping'
  ) {
    return 'Assistant setup is still in progress. Wait for setup to finish before approving Telegram pairing.'
  }

  return `Assistant is not ready for Telegram pairing (status: ${status}).`
}

export const Route = createFileRoute('/api/vps/telegram/approve')({
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

          const parsed = approveBodySchema.safeParse(await request.json())
          if (!parsed.success) {
            return Response.json(
              { error: 'Pairing code is required' },
              { status: 400 },
            )
          }

          const code = parsed.data.code.trim().toUpperCase()

          if (!code) {
            return Response.json(
              { error: 'Pairing code is required' },
              { status: 400 },
            )
          }

          if (!PAIRING_CODE_REGEX.test(code)) {
            return Response.json(
              {
                error:
                  'Pairing code should be 8 uppercase letters/numbers (without 0/1).',
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

          const summary = await approveTelegramPairing(
            instance.tailscaleIp,
            code,
          )
          const setupState = await syncTelegramChannelConnection(
            session.user.id,
            summary,
            {
              approvedNow: true,
              vpsProvisionedAt: instance.provisionedAt,
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
