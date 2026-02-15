import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import type { ChannelSetupState } from '@/lib/channel-connections'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import {
  safeApiResponse,
  safeErrorMessage,
  sanitizeLastError,
} from '@/lib/api-error'
import { syncTelegramChannelConnection } from '@/lib/channel-connections'
import { assertRateLimit } from '@/lib/rate-limit'
import { getTelegramStatus } from '@/lib/vps-openclaw'
import { requireSession } from '@/lib/session'

function telegramProvisioningError(status: string): string | null {
  if (status === 'active') return null

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

const CHECK_INTERVAL_MS = 5_000
const MAX_BACKOFF_MS = 60_000
const KEEPALIVE_INTERVAL_MS = 30_000

export const Route = createFileRoute('/api/vps/telegram/stream')({
  ssr: false,
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

          const abortSignal = request.signal

          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder()
              let checkTimer: ReturnType<typeof setTimeout> | null = null
              let keepaliveTimer: ReturnType<typeof setInterval> | null = null

              function send(event: string) {
                try {
                  controller.enqueue(encoder.encode(event))
                } catch {
                  cleanup()
                }
              }

              function cleanup() {
                if (checkTimer) {
                  clearTimeout(checkTimer)
                  checkTimer = null
                }
                if (keepaliveTimer) {
                  clearInterval(keepaliveTimer)
                  keepaliveTimer = null
                }
                try {
                  controller.close()
                } catch {
                  // already closed
                }
              }

              abortSignal.addEventListener('abort', cleanup, { once: true })

              let delay = CHECK_INTERVAL_MS

              async function check() {
                try {
                  if (!instance) {
                    return
                  }

                  const summary = await getTelegramStatus(instance.tailscaleIp!)

                  let setupState: ChannelSetupState = summary.configured
                    ? 'configuring'
                    : 'disconnected'
                  try {
                    setupState = await syncTelegramChannelConnection(
                      userId,
                      summary,
                      { vpsProvisionedAt: instance.provisionedAt },
                    )
                  } catch (syncError) {
                    const message =
                      syncError instanceof Error
                        ? syncError.message
                        : String(syncError)
                    console.warn(
                      `Failed to persist Telegram connection state for user ${userId}:`,
                      message,
                    )
                  }

                  const connected = setupState === 'connected'
                  const configured = connected || setupState === 'configuring'

                  const payload = {
                    ...summary,
                    lastError: sanitizeLastError(summary.lastError),
                    connected,
                    configured,
                    vpsStatus: instance.status,
                  }

                  send(`data: ${JSON.stringify(payload)}\n\n`)
                  delay = CHECK_INTERVAL_MS
                } catch (error) {
                  send(
                    `event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error) })}\n\n`,
                  )
                  delay = Math.min(delay * 2, MAX_BACKOFF_MS)
                }

                if (!abortSignal.aborted) {
                  checkTimer = setTimeout(check, delay)
                }
              }

              keepaliveTimer = setInterval(() => {
                if (abortSignal.aborted) {
                  cleanup()
                  return
                }
                send(':keepalive\n\n')
              }, KEEPALIVE_INTERVAL_MS)

              check()
            },
          })

          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
