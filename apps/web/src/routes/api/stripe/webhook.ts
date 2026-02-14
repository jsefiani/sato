import { createFileRoute } from '@tanstack/react-router'
import { processStripeEvent, verifyStripeWebhookSignature } from '@/lib/billing'

interface StripeEvent {
  id: string
  type: string
  data: {
    object: Record<string, unknown>
  }
}

export const Route = createFileRoute('/api/stripe/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const signatureHeader = request.headers.get('stripe-signature')
          if (!signatureHeader) {
            return Response.json(
              { error: 'Missing stripe-signature header' },
              { status: 400 },
            )
          }

          const payload = await request.text()
          verifyStripeWebhookSignature(payload, signatureHeader)

          const event = JSON.parse(payload) as StripeEvent
          await processStripeEvent(event)

          return Response.json({ received: true })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          return Response.json({ error: message }, { status: 400 })
        }
      },
    },
  },
})
