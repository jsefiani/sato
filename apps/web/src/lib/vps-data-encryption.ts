import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { vpsDataEncryption } from '@/db/schema'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { env } from '@/lib/env'
import { createId } from '@/lib/ids'

const ACTIVE_STATE = 'active'
const DATA_KEY_VERSION = 1

function isRequestedAtWithinTtl({
  requestedAt,
  nowSeconds,
}: {
  requestedAt: number
  nowSeconds: number
}): boolean {
  return (
    Math.abs(nowSeconds - requestedAt) <= env.VPS_ENCRYPTION_KEY_TTL_SECONDS
  )
}

export async function createDataEncryptionForUser({
  userId,
}: {
  userId: string
}): Promise<{ unlockAuthSecret: string }> {
  const dataKey = randomBytes(32).toString('base64url')
  const unlockAuthSecret = randomBytes(32).toString('base64url')

  await db
    .insert(vpsDataEncryption)
    .values({
      id: createId(),
      userId,
      wrappedDataKey: encryptSecret(dataKey),
      unlockAuthSecret: encryptSecret(unlockAuthSecret),
      keyVersion: DATA_KEY_VERSION,
      state: ACTIVE_STATE,
      lastUnlockAt: null,
      lastUnlockIp: null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vpsDataEncryption.userId,
      set: {
        wrappedDataKey: encryptSecret(dataKey),
        unlockAuthSecret: encryptSecret(unlockAuthSecret),
        keyVersion: DATA_KEY_VERSION,
        state: ACTIVE_STATE,
        lastUnlockAt: null,
        lastUnlockIp: null,
      },
    })

  return {
    unlockAuthSecret,
  }
}

export async function resolveDataKeyForUnlock({
  userId,
  requestedAt,
  signature,
  sourceIp,
}: {
  userId: string
  requestedAt: number
  signature: string
  sourceIp: string | null
}): Promise<{ dataKey: string; keyVersion: number } | null> {
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (!isRequestedAtWithinTtl({ requestedAt, nowSeconds })) {
    return null
  }

  const row = await db.query.vpsDataEncryption.findFirst({
    where: eq(vpsDataEncryption.userId, userId),
    columns: {
      userId: true,
      wrappedDataKey: true,
      unlockAuthSecret: true,
      keyVersion: true,
      state: true,
    },
  })

  if (!row || row.state !== ACTIVE_STATE) {
    return null
  }

  const unlockAuthSecret = decryptSecret(row.unlockAuthSecret)
  const expectedSignature = createUnlockSignature({
    userId,
    requestedAt,
    unlockAuthSecret,
  })

  if (!secureEquals({ a: signature, b: expectedSignature })) {
    return null
  }

  const dataKey = decryptSecret(row.wrappedDataKey)

  await db
    .update(vpsDataEncryption)
    .set({
      lastUnlockAt: new Date(),
      lastUnlockIp: sourceIp,
    })
    .where(eq(vpsDataEncryption.userId, userId))

  return {
    dataKey,
    keyVersion: row.keyVersion,
  }
}

function secureEquals({ a, b }: { a: string; b: string }): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)

  if (aBuffer.length !== bBuffer.length) {
    return false
  }

  return timingSafeEqual(aBuffer, bBuffer)
}

function createUnlockSignature({
  userId,
  requestedAt,
  unlockAuthSecret,
}: {
  userId: string
  requestedAt: number
  unlockAuthSecret: string
}): string {
  return createHmac('sha256', unlockAuthSecret)
    .update(`${userId}:${requestedAt}`)
    .digest('base64url')
}
