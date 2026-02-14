import { createFileRoute } from '@tanstack/react-router'
import { destroyUserServer } from '@/lib/provisioning'
import { requireSession } from '@/lib/session'

export const Route = createFileRoute('/api/vps/destroy')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const session = await requireSession()
          await destroyUserServer(session.user.id)
          return Response.json({ ok: true })
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
