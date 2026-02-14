import { createFileRoute } from '@tanstack/react-router'
import { getUserAccessState } from '@/lib/access-control'
import { getUserCreditState } from '@/lib/credits'
import { provisionUserServer } from '@/lib/provisioning'
import { requireSession } from '@/lib/session'

interface ProvisionBody {
  region?: string
  serverType?: string
}

export const Route = createFileRoute('/api/vps/provision')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const session = await requireSession()
          const access = await getUserAccessState(session.user.id)

          if (!access.hasAccess) {
            return Response.json(
              {
                error:
                  'Your free trial has expired or your subscription is inactive. Please subscribe to continue.',
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

          const body = (await request.json()) as ProvisionBody
          const result = await provisionUserServer({
            userId: session.user.id,
            region: body.region,
            serverType: body.serverType,
          })

          return Response.json(result)
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
