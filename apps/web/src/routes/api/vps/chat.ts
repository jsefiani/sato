import { createFileRoute } from '@tanstack/react-router'
import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, streamText } from 'ai'
import { eq } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { db } from '@/db'
import { vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'
import {
  ensureChatEndpointEnabled,
  injectPersonalization,
} from '@/lib/vps-personalization'

export const Route = createFileRoute('/api/vps/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(request, 'chat', session.user.id)
          if (rateLimited) return rateLimited

          const body = await request.json()
          const messages = body?.messages as Array<UIMessage> | undefined

          if (!Array.isArray(messages)) {
            return Response.json({ error: 'Invalid input' }, { status: 400 })
          }

          const rows = await db
            .select({
              tailscaleIp: vpsInstance.tailscaleIp,
              status: vpsInstance.status,
            })
            .from(vpsInstance)
            .where(eq(vpsInstance.userId, session.user.id))
            .limit(1)
          const instance = rows.at(0)

          if (!instance || !instance.tailscaleIp) {
            return Response.json(
              { error: 'Assistant is not ready' },
              { status: 409 },
            )
          }

          if (instance.status !== 'active') {
            return Response.json(
              { error: 'Assistant is not ready' },
              { status: 409 },
            )
          }

          await Promise.all([
            injectPersonalization({
              userId: session.user.id,
              tailscaleIp: instance.tailscaleIp,
            }),
            ensureChatEndpointEnabled(instance.tailscaleIp),
          ])

          const openclawGateway = createOpenAI({
            baseURL: `http://${instance.tailscaleIp}:18789/v1`,
            apiKey: 'openclaw',
          })

          const result = streamText({
            model: openclawGateway.chat('openclaw'),
            messages: await convertToModelMessages(messages),
          })

          return result.toUIMessageStreamResponse()
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
