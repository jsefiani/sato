import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { user, vpsInstance } from '@/db/schema'
import { safeApiResponse } from '@/lib/api-error'
import { assertSameOrigin } from '@/lib/csrf'
import {
  getModelValueByLabel,
  isValidModel,
  normalizeModel,
} from '@/lib/models'
import { assertRateLimit } from '@/lib/rate-limit'
import { requireSession } from '@/lib/session'
import { applyModelConfig } from '@/lib/vps-personalization'

const modelSchema = z.object({
  model: z.string().min(1, 'Unsupported model'),
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

          const modelInput = parsed.data.model.trim()
          const modelValue = getModelValueByLabel(modelInput) ?? modelInput
          if (!isValidModel(modelValue)) {
            return Response.json({ error: 'Invalid input' }, { status: 400 })
          }

          const normalizedModel = normalizeModel(modelValue)

          const instance = await db.query.vpsInstance.findFirst({
            where: eq(vpsInstance.userId, session.user.id),
            columns: { status: true, tailscaleIp: true },
          })

          if (instance?.status === 'active' && instance.tailscaleIp) {
            await applyModelConfig({
              tailscaleIp: instance.tailscaleIp,
              model: normalizedModel,
              waitForReady: false,
            })
          }

          await db
            .update(user)
            .set({ preferredModel: normalizedModel })
            .where(eq(user.id, session.user.id))

          return Response.json({ ok: true })
        } catch (error) {
          return safeApiResponse(error)
        }
      },
    },
  },
})
