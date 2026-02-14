import { createFileRoute } from '@tanstack/react-router'
import { createPortalSession } from '@/lib/billing'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/stripe/portal')({
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

          const portalUrl = await createPortalSession(session.user.id)
          return Response.json({ portalUrl })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
