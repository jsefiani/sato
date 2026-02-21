type RateLimitCategory =
  | 'vps-provision'
  | 'vps-unlock'
  | 'billing'
  | 'vps-status'
  | 'telegram'
  | 'stripe-webhook'
  | 'auth'
  | 'chat'
  | 'personalization'

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

const RATE_LIMITS: Record<RateLimitCategory, RateLimitConfig> = {
  'vps-provision': { maxRequests: 3, windowMs: 10 * 60 * 1000 },
  'vps-unlock': { maxRequests: 30, windowMs: 60 * 1000 },
  billing: { maxRequests: 10, windowMs: 60 * 1000 },
  'vps-status': { maxRequests: 60, windowMs: 60 * 1000 },
  telegram: { maxRequests: 30, windowMs: 60 * 1000 },
  'stripe-webhook': { maxRequests: 100, windowMs: 60 * 1000 },
  auth: { maxRequests: 10, windowMs: 60 * 1000 },
  chat: { maxRequests: 30, windowMs: 60 * 1000 },
  personalization: { maxRequests: 10, windowMs: 60 * 1000 },
}

const store = new Map<string, Array<number>>()

const PRUNE_INTERVAL_MS = 5 * 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [key, timestamps] of store) {
    const filtered = timestamps.filter((t) => now - t < 10 * 60 * 1000)
    if (filtered.length === 0) {
      store.delete(key)
    } else {
      store.set(key, filtered)
    }
  }
}, PRUNE_INTERVAL_MS).unref()

function getClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const parts = forwardedFor.split(',')
    const lastEntry = parts[parts.length - 1]?.trim()
    if (lastEntry) return lastEntry
  }

  return '127.0.0.1'
}

export function assertRateLimit(
  request: Request,
  category: RateLimitCategory,
  userId?: string,
): Response | null {
  const config = RATE_LIMITS[category]
  const key = `${category}:${userId ?? getClientIp(request)}`
  const now = Date.now()

  const timestamps = store.get(key) ?? []
  const windowStart = now - config.windowMs
  const recent = timestamps.filter((t) => t > windowStart)

  if (recent.length >= config.maxRequests) {
    const oldestInWindow = recent[0]
    const retryAfterSeconds = Math.ceil(
      (oldestInWindow + config.windowMs - now) / 1000,
    )

    return Response.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    )
  }

  recent.push(now)
  store.set(key, recent)
  return null
}
