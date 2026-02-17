import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { user, vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import { isValidModel, normalizeModel } from '@/lib/models'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'
import { applyModelConfig } from '@/lib/vps-personalization'

const modelSchema = z.object({
  model: z.string().refine(isValidModel, 'Unsupported model'),
})

export const Route = createFileRoute('/api/model')({
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

          const parsed = modelSchema.safeParse(await request.json())
          if (!parsed.success) {
            return Response.json({ error: 'Invalid input' }, { status: 400 })
          }

          const normalizedModel = normalizeModel(parsed.data.model)

          await db
            .update(user)
            .set({ preferredModel: normalizedModel })
            .where(eq(user.id, session.user.id))

          const instance = await db.query.vpsInstance.findFirst({
            where: eq(vpsInstance.userId, session.user.id),
            columns: { status: true, tailscaleIp: true },
          })

          if (instance?.status === 'active' && instance.tailscaleIp) {
            void applyModelConfig({
              tailscaleIp: instance.tailscaleIp,
              model: normalizedModel,
            }).catch(() => {})
          }

          return Response.json({ ok: true })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
