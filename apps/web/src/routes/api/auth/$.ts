import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/auth'
import { assertRateLimit } from '@/lib/rate-limit'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const rateLimited = assertRateLimit(request, 'auth')
        if (rateLimited) return rateLimited
        return auth.handler(request)
      },
      POST: ({ request }) => {
        const rateLimited = assertRateLimit(request, 'auth')
        if (rateLimited) return rateLimited
        return auth.handler(request)
      },
    },
  },
})
