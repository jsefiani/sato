import { createFileRoute } from '@tanstack/react-router'
import { createCheckoutSession } from '@/lib/billing'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/stripe/checkout')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const session = await requireSession()
          const checkoutUrl = await createCheckoutSession(
            session.user.id,
            session.user.email,
          )

          return Response.json({ checkoutUrl })
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
