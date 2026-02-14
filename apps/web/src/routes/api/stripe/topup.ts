import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createTopupCheckoutSession } from '@/lib/billing'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

const topupBodySchema = z.object({
  packId: z.string().min(1, 'Missing top-up pack').max(100),
})

export const Route = createFileRoute('/api/stripe/topup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'billing',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const parsed = topupBodySchema.safeParse(await request.json())
          if (!parsed.success) {
            return Response.json(
              { error: 'Missing top-up pack' },
              { status: 400 },
            )
          }

          const checkoutUrl = await createTopupCheckoutSession(
            session.user.id,
            session.user.email,
            parsed.data.packId,
          )

          return Response.json({ checkoutUrl })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
