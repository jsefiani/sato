import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'

const ALGORITHM = 'aes-256-gcm'

function resolveEncryptionKey(): Buffer {
  const raw = env.APP_ENCRYPTION_KEY
  const key = Buffer.from(raw, 'base64')

  if (key.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }

  return key
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, resolveEncryptionKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}.${encrypted.toString('base64')}.${authTag.toString('base64')}`
}

export function decryptSecret(cipherText: string): string {
  const parts = cipherText.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format')
  }

  const [ivRaw, encryptedRaw, authTagRaw] = parts
  if (!ivRaw || !encryptedRaw || !authTagRaw) {
    throw new Error('Invalid encrypted secret format')
  }

  const iv = Buffer.from(ivRaw, 'base64')
  const encrypted = Buffer.from(encryptedRaw, 'base64')
  const authTag = Buffer.from(authTagRaw, 'base64')

  const decipher = createDecipheriv(ALGORITHM, resolveEncryptionKey(), iv)
  decipher.setAuthTag(authTag)

  const plainText = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return plainText.toString('utf8')
}
