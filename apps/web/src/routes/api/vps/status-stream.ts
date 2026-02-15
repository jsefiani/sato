import { createFileRoute } from '@tanstack/react-router'
import { computeVpsProbeState } from './status'
import { safeApiResponse, safeErrorMessage } from '@/lib/api-error'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

const CHECK_INTERVAL_MS = 5_000
const KEEPALIVE_INTERVAL_MS = 30_000

export const Route = createFileRoute('/api/vps/status-stream')({
  ssr: false,
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

          const userId = session.user.id
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

              async function check() {
                try {
                  const { provisionedAt: _, ...payload } =
                    await computeVpsProbeState({ userId })
                  send(`data: ${JSON.stringify(payload)}\n\n`)
                } catch (error) {
                  send(
                    `event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error) })}\n\n`,
                  )
                }

                if (!abortSignal.aborted) {
                  checkTimer = setTimeout(check, CHECK_INTERVAL_MS)
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
