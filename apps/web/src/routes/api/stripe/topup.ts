import { createFileRoute } from '@tanstack/react-router'
import { createTopupCheckoutSession } from '@/lib/billing'
import { requireSession } from '@/lib/session'

interface TopupBody {
  packId?: string
}

export const Route = createFileRoute('/api/stripe/topup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const session = await requireSession()
          const body = (await request.json()) as TopupBody

          if (!body.packId) {
            return Response.json(
              { error: 'Missing top-up pack' },
              { status: 400 },
            )
          }

          const checkoutUrl = await createTopupCheckoutSession(
            session.user.id,
            session.user.email,
            body.packId,
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
