import { createHmac } from 'node:crypto'
import { env } from '@/lib/env'

function toBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function getGatewayAuthToken({ userId }: { userId: string }): string {
  const secret = env.OPENCLAW_GATEWAY_TOKEN_SECRET ?? env.APP_ENCRYPTION_KEY
  const digest = createHmac('sha256', secret).update(userId).digest()
  return `gw_${toBase64Url(digest)}`
}
