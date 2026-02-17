import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

const TOKEN_VERSION = 'v1'
const TOKEN_TTL_SECONDS = 30 * 60

interface BootstrapTokenPayload {
  requestId: string
  userId: string
  exp: number
}

function sign(value: string): string {
  return createHmac('sha256', env.APP_ENCRYPTION_KEY)
    .update(value)
    .digest('base64url')
}

function secureEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)

  if (aBuffer.length !== bBuffer.length) {
    return false
  }

  return timingSafeEqual(aBuffer, bBuffer)
}

export function createVpsBootstrapToken({
  requestId,
  userId,
}: {
  requestId: string
  userId: string
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const payload: BootstrapTokenPayload = {
    requestId,
    userId,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )
  const signedInput = `${TOKEN_VERSION}.${encodedPayload}`
  const signature = sign(signedInput)

  return `${signedInput}.${signature}`
}

export function verifyVpsBootstrapToken({
  token,
}: {
  token: string
}): { requestId: string; userId: string } | null {
  const [version, encodedPayload, signature, extra] = token.split('.')

  if (!version || !encodedPayload || !signature || extra) {
    return null
  }

  if (version !== TOKEN_VERSION) {
    return null
  }

  const signedInput = `${version}.${encodedPayload}`
  const expectedSignature = sign(signedInput)

  if (!secureEquals(signature, expectedSignature)) {
    return null
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const requestId = (payload as { requestId?: unknown }).requestId
  const userId = (payload as { userId?: unknown }).userId
  const exp = (payload as { exp?: unknown }).exp

  if (typeof requestId !== 'string' || requestId.length === 0) {
    return null
  }

  if (typeof userId !== 'string' || userId.length === 0) {
    return null
  }

  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null
  }

  if (exp < Math.floor(Date.now() / 1000)) {
    return null
  }

  return { requestId, userId }
}
