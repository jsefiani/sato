import { env } from '@/lib/env'

export function assertSameOrigin(request: Request): Response | null {
  const appUrl = env.APP_URL
  const appOrigin = new URL(appUrl).origin

  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  const requestOrigin = origin ?? (referer ? new URL(referer).origin : null)

  if (!requestOrigin || requestOrigin !== appOrigin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}
