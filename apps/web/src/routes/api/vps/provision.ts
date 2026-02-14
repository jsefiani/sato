import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getUserAccessState } from '@/lib/access-control'
import { safeApiResponse } from '@/lib/api-error'
import { getUserCreditState } from '@/lib/credits'
import { assertSameOrigin } from '@/lib/csrf'
import { provisionUserServer } from '@/lib/provisioning'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

const provisionBodySchema = z.object({
  region: z.string().max(100).optional(),
  serverType: z.string().max(100).optional(),
})

export const Route = createFileRoute('/api/vps/provision')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'vps-provision',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const access = await getUserAccessState(session.user.id)

          if (!access.hasAccess) {
            return Response.json(
              {
                error:
                  'Your free trial has expired or your subscription is inactive. Please subscribe to continue.',
              },
              { status: 402 },
            )
          }

          const credits = await getUserCreditState(session.user.id)
          if (credits.totalCreditsRemaining <= 0) {
            return Response.json(
              {
                error:
                  'You are out of credits. Buy a credit pack to keep using your assistant.',
              },
              { status: 402 },
            )
          }

          const parsed = provisionBodySchema.safeParse(await request.json())

          if (!parsed.success) {
            return Response.json(
              { error: 'Invalid request body' },
              { status: 400 },
            )
          }

          const result = await provisionUserServer({
            userId: session.user.id,
            region: parsed.data.region,
            serverType: parsed.data.serverType,
          })

          return Response.json(result)
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
