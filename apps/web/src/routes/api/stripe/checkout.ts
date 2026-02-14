import { createFileRoute } from '@tanstack/react-router'
import { createCheckoutSession } from '@/lib/billing'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/stripe/checkout')({
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

          const checkoutUrl = await createCheckoutSession(
            session.user.id,
            session.user.email,
          )

          return Response.json({ checkoutUrl })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
