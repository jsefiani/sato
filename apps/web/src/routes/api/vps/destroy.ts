import { createFileRoute } from '@tanstack/react-router'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { destroyUserServer } from '@/lib/provisioning'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/vps/destroy')({
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

          await destroyUserServer(session.user.id)
          return Response.json({ ok: true })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
