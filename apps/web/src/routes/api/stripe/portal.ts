import { createFileRoute } from '@tanstack/react-router'
import { createPortalSession } from '@/lib/billing'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/stripe/portal')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const session = await requireSession()
          const portalUrl = await createPortalSession(session.user.id)
          return Response.json({ portalUrl })
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
