import { createFileRoute } from '@tanstack/react-router'
import { processStripeEvent, verifyStripeWebhookSignature } from '@/lib/billing'
import { assertRateLimit } from '@/lib/rate-limit'

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
        const rateLimited = assertRateLimit(request, 'stripe-webhook')
        if (rateLimited) return rateLimited

        try {
          const signatureHeader = request.headers.get('stripe-signature')
          if (!signatureHeader) {
            return Response.json(
              { error: 'Invalid webhook signature' },
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

          const isSignatureError =
            message === 'Missing stripe-signature header' ||
            message === 'Invalid Stripe signature header' ||
            message === 'Invalid Stripe webhook signature' ||
            message === 'Stripe webhook timestamp too old'

          if (isSignatureError) {
            return Response.json(
              { error: 'Invalid webhook signature' },
              { status: 400 },
            )
          }

          console.error('[stripe-webhook] Processing failed:', message)
          return Response.json(
            { error: 'Webhook processing failed' },
            { status: 400 },
          )
        }
      },
    },
  },
})
