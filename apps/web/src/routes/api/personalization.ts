import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { user } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'

const personalizationSchema = z.object({
  assistantName: z.string().min(1).max(50),
  communicationStyle: z.string().min(1).max(50),
  primaryUseCase: z.string().min(1).max(100),
  additionalContext: z.string().max(500).default(''),
})

export const Route = createFileRoute('/api/personalization')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrf = assertSameOrigin(request)
        if (csrf) return csrf

        try {
          const session = await requireSession()

          const rateLimited = assertRateLimit(
            request,
            'personalization',
            session.user.id,
          )
          if (rateLimited) return rateLimited

          const parsed = personalizationSchema.safeParse(await request.json())
          if (!parsed.success) {
            return Response.json({ error: 'Invalid input' }, { status: 400 })
          }

          await db
            .update(user)
            .set({
              assistantName: parsed.data.assistantName,
              communicationStyle: parsed.data.communicationStyle,
              primaryUseCase: parsed.data.primaryUseCase,
              additionalContext: parsed.data.additionalContext,
            })
            .where(eq(user.id, session.user.id))

          return Response.json({ ok: true })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
