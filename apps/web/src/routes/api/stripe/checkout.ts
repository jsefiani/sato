import { createFileRoute } from '@tanstack/react-router'
import {
  ACTIVE_OR_TRIALING_SUBSCRIPTION_EXISTS_MESSAGE,
  createCheckoutSession,
} from '@/lib/billing'
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

          const checkoutUrl = await createCheckoutSession({
            userId: session.user.id,
            email: session.user.email,
          })

          return Response.json({ checkoutUrl })
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === ACTIVE_OR_TRIALING_SUBSCRIPTION_EXISTS_MESSAGE
          ) {
            return Response.json(
              { error: ACTIVE_OR_TRIALING_SUBSCRIPTION_EXISTS_MESSAGE },
              { status: 409 },
            )
          }

          return safeApiResponse(error)
        }
      },
    },
  },
})
