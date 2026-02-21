import { createFileRoute } from '@tanstack/react-router'
import { getUserAccessState } from '@/lib/access-control'
import { safeApiResponse } from '@/lib/api-error'
import { getUserCreditState } from '@/lib/credits'
import { assertSameOrigin } from '@/lib/csrf'
import { provisionUserServer } from '@/lib/provisioning'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9:_-]{8,128}$/

export const Route = createFileRoute('/api/vps/provision')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireSession()
          const idempotencyKeyRaw = request.headers.get('idempotency-key')
          const idempotencyKey = idempotencyKeyRaw?.trim() || null

          if (idempotencyKey && !IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
            return Response.json(
              { error: 'Invalid Idempotency-Key header' },
              { status: 400 },
            )
          }

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
                  'Your trial has expired or your subscription is inactive. Please subscribe to continue.',
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

          const result = await provisionUserServer({
            userId: session.user.id,
            idempotencyKey,
          })

          return Response.json({ ok: result.status === 'bootstrapping' })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
